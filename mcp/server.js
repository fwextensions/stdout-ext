#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BaseURL, Port } from "./constants.js";

const DaemonPath = fileURLToPath(new URL("./daemon.js", import.meta.url));
const DaemonStartTimeout = 5000;
	// the extension's alarm syncs once a minute while agent mode is on
const SyncStaleTime = 150 * 1000;
const Instructions = `\
Reads console output from Chrome extensions under development. The extension \
being debugged forwards its console calls to the "stdout" helper extension, \
which stores them even when no agent is connected, so logs from before this \
session started are available.

Start with get_logs to see recent output, or list_sources to see which \
extensions and pages have logged. Every result includes a cursor; pass it as \
\`after\` to get only newer entries. After asking the user to reproduce a \
problem, use wait_for_log to wait for a specific message.

If the tools report that the stdout extension hasn't sent anything, ask the \
user to click the stdout extension's toolbar icon in Chrome so it shows an MCP \
badge. That turns on agent mode, which lets the extension send logs here.`;

const filterShape = {
	levels: z.array(z.string()).optional()
		.describe('Console methods to include, like ["error", "warn"]. Defaults to all.'),
	extension: z.string().optional()
		.describe("Only include logs from this extension, by ID or exact name."),
	filename: z.string().optional()
		.describe('Only include logs from pages or scripts whose filename contains this, like "popup".'),
	search: z.string().optional()
		.describe("Case-insensitive regular expression to match against the message text."),
};

async function request(
	path,
	body,
	timeout = 5000)
{
	const response = await fetch(BaseURL + path, {
		...(body && {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
		signal: AbortSignal.timeout(timeout),
	});
	const result = await response.json();

	if (!response.ok) {
		throw new Error(result.error ?? `HTTP ${response.status}`);
	}

	return result;
}

async function getHealth()
{
	try {
		return await request("/health", undefined, 1000);
	} catch {
		return null;
	}
}

let startingDaemon = null;

async function startDaemon()
{
		// run the daemon on its own, so it keeps the logs it has received after this
		// agent session ends and can be shared by other sessions
	spawn(process.execPath, [DaemonPath], {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	}).unref();

	const deadline = Date.now() + DaemonStartTimeout;

	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 100));

		const health = await getHealth();

		if (health) {
			return health;
		}
	}

	throw new Error(`Couldn't start the stdout log server on port ${Port}. Is something else using that port?`);
}

async function ensureDaemon()
{
	const health = await getHealth();

	if (health) {
		return health;
	}

	startingDaemon ??= startDaemon().finally(() => startingDaemon = null);

	return startingDaemon;
}

function formatTime(
	time)
{
	return time ? new Date(time).toISOString() : "unknown time";
}

function formatAge(
	time)
{
	const seconds = Math.round((Date.now() - time) / 1000);

	return seconds < 120 ? `${seconds} seconds ago` : `${Math.round(seconds / 60)} minutes ago`;
}

function formatEntry(
	{ seq, time, method, extensionId, extensionName, filename, text })
{
	const source = `${extensionName ?? extensionId}/${filename}`;
		// indent continuation lines, like stack traces, under the entry
	const body = text.replaceAll("\n", "\n    ");

	return `#${seq} ${formatTime(time)} [${method}] ${source}: ${body}`;
}

function getConnectionNote(
	{ lastIngestAt, startedAt })
{
	if (!lastIngestAt) {
		return `Note: the stdout extension hasn't sent anything since the log server started ${formatAge(startedAt)}. `
			+ "If agent mode is on (the stdout toolbar icon in Chrome shows an MCP badge), its stored logs will arrive within about a minute. "
			+ "Otherwise, ask the user to click the stdout toolbar icon to turn on agent mode.";
	}

	if (Date.now() - lastIngestAt > SyncStaleTime) {
		return `Note: the stdout extension last checked in ${formatAge(lastIngestAt)}, so agent mode may have been turned off, or Chrome may be closed. `
			+ "Newer logs may be missing.";
	}

	return "";
}

function textResult(
	...parts)
{
	return {
		content: [{ type: "text", text: parts.filter(Boolean).join("\n\n") }],
	};
}

function errorResult(
	error)
{
	return {
		content: [{ type: "text", text: error.message }],
		isError: true,
	};
}

function validateSearch(
	pattern)
{
	if (pattern) {
		try {
			new RegExp(pattern, "i");
		} catch (error) {
			throw new Error(`Invalid regular expression: ${error.message}`);
		}
	}
}

const server = new McpServer(
	{ name: "stdout-ext", version: "0.1.0" },
	{ instructions: Instructions }
);

server.registerTool(
	"get_logs",
	{
		title: "Get extension logs",
		description: "Get console output from Chrome extensions that use the stdout-ext library, "
			+ "including output from before this session started. Without `after`, returns the most "
			+ "recent matching entries. With `after`, returns the entries following that cursor, "
			+ "oldest first.",
		inputSchema: {
			after: z.number().int().optional()
				.describe("Cursor from a previous result. Only entries after it are returned."),
			limit: z.number().int().min(1).max(1000).optional()
				.describe("Maximum number of entries to return. Defaults to 100."),
			...filterShape,
		},
		annotations: { readOnlyHint: true },
	},
	async ({ after, limit = 100, ...filter }) => {
		try {
			validateSearch(filter.search);
			await ensureDaemon();

			const result = await request("/query", { after, limit, filter });
			const lines = result.entries.map(formatEntry);
				// paging forward stops at the limit, so continue from the last entry.
				// otherwise, every entry up to maxSeq has been considered.
			const hasMore = after !== undefined && !result.cursorReset && lines.length === limit;
			const cursor = hasMore ? result.entries.at(-1).seq : result.maxSeq;

			return textResult(
				result.cursorReset && "The stdout extension's log buffer was reset, so the cursor no longer applies. These are the latest entries.",
				lines.length ? lines.join("\n") : "No matching log entries.",
				hasMore && "There may be more entries after these.",
				`cursor: ${cursor} (pass as \`after\` to get only newer entries)`,
				getConnectionNote(result)
			);
		} catch (error) {
			return errorResult(error);
		}
	}
);

server.registerTool(
	"wait_for_log",
	{
		title: "Wait for an extension log",
		description: "Wait until a Chrome extension logs a message matching a pattern, such as after "
			+ "asking the user to reproduce a problem or reload the extension. By default, only "
			+ "entries logged after this call starts are considered.",
		inputSchema: {
			pattern: z.string()
				.describe("Case-insensitive regular expression to match against the message text."),
			after: z.number().int().optional()
				.describe("Cursor from a previous result. Defaults to the latest entry, so only new logs match."),
			timeoutSeconds: z.number().min(1).max(120).optional()
				.describe("How long to wait. Defaults to 30."),
			levels: filterShape.levels,
			extension: filterShape.extension,
			filename: filterShape.filename,
		},
		annotations: { readOnlyHint: true },
	},
	async ({ pattern, after, timeoutSeconds = 30, ...filter }) => {
		try {
			validateSearch(pattern);
			await ensureDaemon();

			const timeoutMs = timeoutSeconds * 1000;
			const result = await request(
				"/wait",
				{ after, limit: 100, timeoutMs, filter: { ...filter, search: pattern } },
				timeoutMs + 5000
			);
			const cursor = result.entries.at(-1)?.seq ?? result.maxSeq;

			return textResult(
				result.timedOut
					? `No matching log entry within ${timeoutSeconds} seconds.`
					: result.entries.map(formatEntry).join("\n"),
				`cursor: ${cursor} (pass as \`after\` to get only newer entries)`,
				getConnectionNote(result)
			);
		} catch (error) {
			return errorResult(error);
		}
	}
);

server.registerTool(
	"list_sources",
	{
		title: "List log sources",
		description: "List the Chrome extensions and pages that have sent logs, and whether the "
			+ "stdout extension is currently connected.",
		inputSchema: {},
		annotations: { readOnlyHint: true },
	},
	async () => {
		try {
			await ensureDaemon();

			const result = await request("/sources");
			const status = `Log server started ${formatAge(result.startedAt)} and holds ${result.entryCount} entries. `
				+ (result.lastIngestAt
					? `The stdout extension last checked in ${formatAge(result.lastIngestAt)}.`
					: "The stdout extension hasn't checked in yet.");
			const sources = result.sources.map(({ extensionId, extensionName, count, lastTime, filenames }) => {
				const files = Object.entries(filenames)
					.map(([filename, fileCount]) => `${filename} (${fileCount})`)
					.join(", ");

				return `- ${extensionName ?? "unnamed extension"} (${extensionId}): ${count} entries, `
					+ `last at ${formatTime(lastTime)}; files: ${files}`;
			});

			return textResult(
				status,
				sources.length ? `Extensions:\n${sources.join("\n")}` : "No extensions have sent logs yet.",
				getConnectionNote(result)
			);
		} catch (error) {
			return errorResult(error);
		}
	}
);

await server.connect(new StdioServerTransport());
