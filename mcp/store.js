import { formatArgs } from "./format.js";

const DefaultMaxEntries = 20000;

/**
 * @typedef {object} LogFilter
 * @property {string[]} [levels]  Console methods to include, like "error".
 * @property {string} [extension]  Extension ID or name.
 * @property {string} [filename]  Substring of the page or script filename.
 * @property {string} [search]  Case-insensitive regular expression to match
 * against the formatted message.
 * @property {number} [since]  Only include entries logged at or after this time.
 */

function createMatcher(
	{ levels, extension, filename, search, since } = {},
	includeMarks = true)
{
	const levelSet = levels?.length ? new Set(levels) : null;
	const extensionLower = extension?.toLowerCase();
	const pattern = search ? new RegExp(search, "i") : null;

	return (entry) => {
		if (since && !(entry.time >= since)) {
			return false;
		}

		if (entry.mark) {
				// marks bracket a repro, so show them whatever the other filters are
			return includeMarks;
		}

		return (!levelSet || levelSet.has(entry.method))
			&& (!extensionLower || entry.extensionId === extension
				|| entry.extensionName?.toLowerCase() === extensionLower)
			&& (!filename || entry.filename?.includes(filename))
			&& (!pattern || pattern.test(entry.text));
	};
}

/**
 * Holds a copy of the log entries buffered by the stdout extension, which sends
 * them in order of their sequence numbers.  Entries are renumbered as they
 * arrive, so that marks added by an agent can go between them.
 */
export class LogStore
{
	constructor(
		{ maxEntries = DefaultMaxEntries } = {})
	{
		this.maxEntries = maxEntries;
		this.bufferId = null;
		this.lastIngestAt = 0;
		this.waiters = new Set();
		this.reset();
	}

	reset(
		bufferId = null)
	{
		this.bufferId = bufferId;
		this.entries = [];
			// the last sequence number in the extension's buffer that we have
		this.extensionSeq = 0;
			// the last sequence number we've assigned
		this.maxSeq = 0;
		this.sources = new Map();
		this.loadIds = new Set();
	}

	add(
		entry)
	{
		const stored = { ...entry, seq: ++this.maxSeq };

		this.entries.push(stored);

		if (this.entries.length > this.maxEntries) {
			this.entries.splice(0, this.entries.length - this.maxEntries);
		}

		return stored;
	}

	/**
	 * Accept a batch of entries from the extension, if it continues from the last
	 * one we have.  Otherwise, the returned `maxSeq` tells the extension where to
	 * resend from.  It's the extension's sequence number, not ours.
	 *
	 * @param {{ bufferId: string, afterSeq: number|null, entries: object[] }} batch
	 * @returns {{ maxSeq: number }}
	 */
	ingest(
		{ bufferId, afterSeq, entries })
	{
		if (bufferId !== this.bufferId) {
				// the extension's buffer was recreated, so its sequence numbers
				// started over
			this.reset(bufferId);
		}

		this.lastIngestAt = Date.now();

		if (afterSeq !== this.extensionSeq || !Array.isArray(entries)) {
			return { maxSeq: this.extensionSeq };
		}

		const added = [];

		for (const { seq, ...entry } of entries.filter(Boolean)) {
			if (Number.isInteger(seq) && seq > this.extensionSeq && Array.isArray(entry.args)) {
				const { loadId } = entry;
					// the first entry from each page load, so a restarted service
					// worker or reopened popup is easy to spot
				const newLoad = typeof loadId === "string" && !this.loadIds.has(loadId);
				const stored = this.add({ ...entry, newLoad, text: formatArgs(entry.args) });

				this.extensionSeq = seq;
				this.loadIds.add(loadId);
				this.addSource(stored);
				added.push(stored);
			}
		}

		if (added.length) {
			for (const waiter of this.waiters) {
				waiter(added);
			}
		}

		return { maxSeq: this.extensionSeq };
	}

	/**
	 * Add a line that an agent can use to bracket a repro.
	 *
	 * @param {string} label
	 * @returns {object} The new entry.
	 */
	addMark(
		label)
	{
		return this.add({ mark: true, time: Date.now(), method: "mark", text: label });
	}

	addSource(
		{ extensionId, extensionName, filename, time })
	{
		let source = this.sources.get(extensionId);

		if (!source) {
			source = { extensionId, extensionName, count: 0, lastTime: 0, filenames: {} };
			this.sources.set(extensionId, source);
		}

		source.extensionName = extensionName ?? source.extensionName;
		source.count++;
		source.lastTime = Math.max(source.lastTime, time ?? 0);
		source.filenames[filename] = (source.filenames[filename] ?? 0) + 1;
	}

	/**
	 * With `around`, returns up to `limit` matching entries centered on that one.
	 *
	 * @param {{ after?: number, around?: number, limit?: number, filter?: LogFilter, includeMarks?: boolean }} query
	 * @returns {{ entries: object[], maxSeq: number, cursorReset: boolean }}
	 */
	query(
		{ after, around, limit = 100, filter, includeMarks = true } = {})
	{
		const matches = createMatcher(filter, includeMarks);

		if (typeof around === "number") {
			return { entries: this.around(around, limit, matches), maxSeq: this.maxSeq, cursorReset: false };
		}

			// a cursor past the end means the buffer was reset since the caller got
			// it, so fall back to returning the latest entries
		const cursorReset = typeof after === "number" && after > this.maxSeq;

		if (typeof after === "number" && !cursorReset) {
			const start = this.entries.findIndex((entry) => entry.seq > after);
			const entries = [];

			for (let i = start; i !== -1 && i < this.entries.length && entries.length < limit; i++) {
				if (matches(this.entries[i])) {
					entries.push(this.entries[i]);
				}
			}

			return { entries, maxSeq: this.maxSeq, cursorReset };
		}

		const entries = [];

		for (let i = this.entries.length - 1; i >= 0 && entries.length < limit; i--) {
			if (matches(this.entries[i])) {
				entries.unshift(this.entries[i]);
			}
		}

		return { entries, maxSeq: this.maxSeq, cursorReset };
	}

	around(
		seq,
		limit,
		matches)
	{
		let center = this.entries.findIndex((entry) => entry.seq >= seq);

		if (center === -1) {
			center = this.entries.length;
		}

		const before = [];
		const after = [];
		const beforeLimit = Math.floor((limit - 1) / 2);

			// the entry asked about is included even if it doesn't match the filter
		if (this.entries[center]?.seq === seq) {
			after.push(this.entries[center++]);
		}

		for (let i = center - 1 - (after.length ? 1 : 0); i >= 0 && before.length < beforeLimit; i--) {
			if (matches(this.entries[i])) {
				before.unshift(this.entries[i]);
			}
		}

		for (let i = center; i < this.entries.length && before.length + after.length < limit; i++) {
			if (matches(this.entries[i])) {
				after.push(this.entries[i]);
			}
		}

		return [...before, ...after];
	}

	/**
	 * Wait for entries after `after` that match the filter.
	 *
	 * @param {{ after?: number, limit?: number, filter?: LogFilter, timeoutMs: number }} options
	 * @returns {{ promise: Promise<{ entries: object[], timedOut: boolean }>, cancel: () => void }}
	 */
	wait(
		{ after = this.maxSeq, limit = 100, filter, timeoutMs })
	{
			// a mark isn't something the extension logged, so it shouldn't end the wait
		const matches = createMatcher(filter, false);
		const existing = this.query({ after, limit, filter, includeMarks: false }).entries;

		if (existing.length) {
			return { promise: Promise.resolve({ entries: existing, timedOut: false }), cancel() {} };
		}

		let cancel;
		const promise = new Promise((resolve) => {
			const finish = (result) => {
				clearTimeout(timer);
				this.waiters.delete(waiter);
				resolve(result);
			};
			const waiter = (added) => {
				const entries = added.filter(matches).slice(0, limit);

				if (entries.length) {
					finish({ entries, timedOut: false });
				}
			};
			const timer = setTimeout(() => finish({ entries: [], timedOut: true }), timeoutMs);

			this.waiters.add(waiter);
			cancel = () => finish({ entries: [], timedOut: true });
		});

		return { promise, cancel };
	}

	getSources()
	{
		return [...this.sources.values()];
	}
}
