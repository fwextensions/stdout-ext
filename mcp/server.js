#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { BaseURL, Port } from "./constants.js";
import { getCodeVersion } from "./version.js";

	// the tools run in the daemon, which keeps the logs and is shared by every
	// agent session.  this process just starts the daemon if needed and relays
	// MCP messages between the agent and the daemon, so it rarely needs to change.
const DaemonPath = fileURLToPath(new URL("./daemon.js", import.meta.url));
const DaemonStartTimeout = 5000;
const DaemonStopTimeout = 5000;

async function getHealth()
{
	try {
		const response = await fetch(`${BaseURL}/health`, { signal: AbortSignal.timeout(1000) });

		return response.ok ? await response.json() : null;
	} catch {
		return null;
	}
}

async function poll(
	check,
	timeout)
{
	const deadline = Date.now() + timeout;

	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 100));

		const result = await check();

		if (result) {
			return result;
		}
	}

	return null;
}

async function startDaemon()
{
		// run the daemon on its own, so it keeps the logs it has received after this
		// agent session ends and can be shared by other sessions
	spawn(process.execPath, [DaemonPath], {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	}).unref();

	const health = await poll(getHealth, DaemonStartTimeout);

	if (!health) {
		throw new Error(`Couldn't start the stdout log server on port ${Port}. Is something else using that port?`);
	}

	return health;
}

async function ensureDaemon(
	checkVersion)
{
	let health = await getHealth();

	if (checkVersion && health && health.codeVersion !== getCodeVersion()) {
			// the daemon was started from older code.  replacing it loses the logs it
			// holds, but the extension resends them within about a minute.
		try {
			process.kill(health.pid);
		} catch {
				// it already exited
		}

		await poll(async () => !(await getHealth()), DaemonStopTimeout);
		health = null;
	}

	return health ?? startDaemon();
}

const agent = new StdioServerTransport();
const daemon = new StreamableHTTPClientTransport(new URL(`${BaseURL}/mcp`));

let ensuringDaemon = null;

function ensureDaemonOnce(
	checkVersion)
{
	ensuringDaemon ??= ensureDaemon(checkVersion).finally(() => ensuringDaemon = null);

	return ensuringDaemon;
}

agent.onmessage = async (message) => {
	try {
		if (message.method === "initialize") {
				// only check the daemon's code when a session starts.  sessions that
				// are already open will use whichever daemon is running, so they
				// can't keep replacing one another's.
			await ensureDaemonOnce(true);
		}

		try {
			await daemon.send(message);
		} catch (error) {
				// fetch() throws a TypeError when it can't connect, such as after the
				// daemon exited for being idle, so start it and try again
			if (!(error instanceof TypeError)) {
				throw error;
			}

			await ensureDaemonOnce(false);
			await daemon.send(message);
		}
	} catch (error) {
			// answer the request, so the agent isn't left waiting for a response
		if (message.id !== undefined) {
			await agent.send({
				jsonrpc: "2.0",
				id: message.id,
				error: { code: -32603, message: error.message },
			});
		}
	}
};
daemon.onmessage = (message) => agent.send(message);
	// errors from sending are handled above, and the daemon doesn't stream
	// anything else
daemon.onerror = () => {};
process.stdin.on("end", () => process.exit(0));

await daemon.start();
await agent.start();
