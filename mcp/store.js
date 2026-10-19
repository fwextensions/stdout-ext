import { formatArgs } from "./format.js";

const DefaultMaxEntries = 20000;

/**
 * @typedef {object} LogFilter
 * @property {string[]} [levels]  Console methods to include, like "error".
 * @property {string} [extension]  Extension ID or name.
 * @property {string} [filename]  Substring of the page or script filename.
 * @property {string} [search]  Case-insensitive regular expression to match
 * against the formatted message.
 */

function createMatcher(
	{ levels, extension, filename, search } = {})
{
	const levelSet = levels?.length ? new Set(levels) : null;
	const extensionLower = extension?.toLowerCase();
	const pattern = search ? new RegExp(search, "i") : null;

	return (entry) => (!levelSet || levelSet.has(entry.method))
		&& (!extensionLower || entry.extensionId === extension
			|| entry.extensionName?.toLowerCase() === extensionLower)
		&& (!filename || entry.filename?.includes(filename))
		&& (!pattern || pattern.test(entry.text));
}

/**
 * Holds a copy of the log entries buffered by the stdout extension, which sends
 * them in order of their sequence numbers.
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
		this.maxSeq = 0;
		this.sources = new Map();
	}

	/**
	 * Accept a batch of entries from the extension, if it continues from the last
	 * one we have.  Otherwise, the returned `maxSeq` tells the extension where to
	 * resend from.
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

		if (afterSeq !== this.maxSeq || !Array.isArray(entries)) {
			return { maxSeq: this.maxSeq };
		}

		const added = [];

		for (const entry of entries) {
			if (Number.isInteger(entry?.seq) && entry.seq > this.maxSeq && Array.isArray(entry.args)) {
				const stored = { ...entry, text: formatArgs(entry.args) };

				this.entries.push(stored);
				this.maxSeq = entry.seq;
				this.addSource(stored);
				added.push(stored);
			}
		}

		if (this.entries.length > this.maxEntries) {
			this.entries.splice(0, this.entries.length - this.maxEntries);
		}

		if (added.length) {
			for (const waiter of this.waiters) {
				waiter(added);
			}
		}

		return { maxSeq: this.maxSeq };
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
	 * @param {{ after?: number, limit?: number, filter?: LogFilter }} query
	 * @returns {{ entries: object[], maxSeq: number, cursorReset: boolean }}
	 */
	query(
		{ after, limit = 100, filter } = {})
	{
		const matches = createMatcher(filter);
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

	/**
	 * Wait for entries after `after` that match the filter.
	 *
	 * @param {{ after?: number, limit?: number, filter?: LogFilter, timeoutMs: number }} options
	 * @returns {{ promise: Promise<{ entries: object[], timedOut: boolean }>, cancel: () => void }}
	 */
	wait(
		{ after = this.maxSeq, limit = 100, filter, timeoutMs })
	{
		const matches = createMatcher(filter);
		const existing = this.query({ after, limit, filter }).entries;

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
