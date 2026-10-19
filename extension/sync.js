import { getBufferId, getEntriesAfter } from "./buffer.js";

	// the stdout-ext-mcp server listens on this port by default
export const ServerURL = "http://127.0.0.1:47321";

const AlarmName = "stdout-sync";
	// alarms wake the service worker briefly to send any logs the server doesn't
	// have yet, such as after a new agent session starts the server.  they don't
	// keep the worker alive in between.
const AlarmPeriodMinutes = 1;
const FlushDelay = 250;
const BatchSize = 500;
const MaxBatchesPerFlush = 50;
	// after a failed request, leave retries to the alarm instead of trying again
	// on every new log message
const RetryDelay = 30 * 1000;

const BadgeColors = {
	connected: "#2e7d32",
	waiting: "#888",
};

	// the highest sequence number the server has from this buffer, or null if we
	// haven't asked it yet since the service worker started
let serverSeq = null;
let flushTimer = null;
let flushing = null;
let flushAgain = false;
let lastFailure = 0;

export async function isAgentMode()
{
	const { agentMode = false } = await chrome.storage.local.get("agentMode");

	return agentMode;
}

async function updateBadge(
	agentMode,
	status = "waiting")
{
	await Promise.all([
		chrome.action.setBadgeText({ text: agentMode ? "MCP" : "" }),
		chrome.action.setBadgeBackgroundColor({ color: BadgeColors[status] }),
		chrome.action.setTitle({
			title: !agentMode
				? "stdout: click to let coding agents read the logs"
				: status === "connected"
					? "stdout: agents can read the logs (click to stop)"
					: "stdout: waiting for the stdout-ext-mcp server (click to stop)"
		}),
	]);
}

/**
 * Turn agent mode on or off.  When it's on, logs are sent to the local MCP server
 * so coding agents can read them.  They're stored in the extension either way.
 * The change is applied by handleStorageChange().
 */
export async function toggleAgentMode()
{
	await chrome.storage.local.set({ agentMode: !(await isAgentMode()) });
}

export async function handleStorageChange(
	changes,
	areaName)
{
	if (areaName !== "local" || !changes.agentMode) {
		return;
	}

	if (changes.agentMode.newValue) {
		await chrome.alarms.create(AlarmName, { periodInMinutes: AlarmPeriodMinutes });
		await updateBadge(true);
		lastFailure = 0;
		flush();
	} else {
		await chrome.alarms.clear(AlarmName);
		await updateBadge(false);
		serverSeq = null;
	}
}

/**
 * Restore the alarm and badge after the browser restarts, since neither is
 * guaranteed to persist.
 */
export async function restoreAgentMode()
{
	const agentMode = await isAgentMode();

	if (agentMode && !(await chrome.alarms.get(AlarmName))) {
		await chrome.alarms.create(AlarmName, { periodInMinutes: AlarmPeriodMinutes });
	}

	await updateBadge(agentMode);
}

export function handleAlarm(
	alarm)
{
	if (alarm.name === AlarmName) {
		lastFailure = 0;
		flush();
	}
}

/**
 * Send new entries to the server shortly, batching up bursts of log calls.
 */
export function scheduleFlush()
{
	if (!flushTimer && Date.now() - lastFailure > RetryDelay) {
		flushTimer = setTimeout(() => {
			flushTimer = null;
			flush();
		}, FlushDelay);
	}
}

export function flush()
{
	if (flushing) {
		flushAgain = true;
	} else {
		flushing = sendEntries()
			.finally(() => {
				flushing = null;

				if (flushAgain) {
					flushAgain = false;
					flush();
				}
			});
	}

	return flushing;
}

async function sendEntries()
{
	const agentMode = await isAgentMode();

	if (!agentMode) {
		return;
	}

	try {
		const bufferId = await getBufferId();

		for (let i = 0; i < MaxBatchesPerFlush; i++) {
				// the first request after the worker starts just asks the server what
				// it already has
			const entries = serverSeq === null
				? []
				: await getEntriesAfter(serverSeq, BatchSize);
			const response = await fetch(`${ServerURL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ bufferId, afterSeq: serverSeq, entries }),
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const { maxSeq } = await response.json();
				// the server only accepts a batch that continues from what it already
				// has.  if it restarted or we were out of date, it returns its actual
				// position and we resend from there.
			const accepted = serverSeq !== null
				&& maxSeq === (entries.at(-1)?.seq ?? serverSeq);

			serverSeq = maxSeq;

			if (accepted && entries.length < BatchSize) {
				break;
			}
		}

		await updateBadge(true, "connected");
	} catch {
			// the server isn't running, which is the normal state when no agent is
			// using it
		serverSeq = null;
		lastFailure = Date.now();
		await updateBadge(true, "waiting");
	}
}
