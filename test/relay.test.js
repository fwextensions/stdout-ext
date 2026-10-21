import { spawn } from "node:child_process";
import { once } from "node:events";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getCodeVersion } from "../mcp/version.js";

const port = 40000 + Math.floor(Math.random() * 10000);
const baseURL = `http://127.0.0.1:${port}`;
	// stands in for a daemon started from older code
const OldDaemon = `
	require("node:http").createServer((req, res) => {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ status: "ok", pid: process.pid, codeVersion: "old" }));
	}).listen(${port}, "127.0.0.1", () => console.log("listening"));
`;
let client;

after(async () => {
	const health = await fetch(`${baseURL}/health`).then((response) => response.json(), () => null);

	await client?.close();

	if (health) {
		process.kill(health.pid);
	}
});

test("replaces a daemon that was started from older code", async () => {
	const oldDaemon = spawn(process.execPath, ["-e", OldDaemon], { stdio: ["ignore", "pipe", "inherit"] });
	const exited = once(oldDaemon, "exit");

	await once(oldDaemon.stdout, "data");

	client = new Client({ name: "test", version: "1.0.0" });
	await client.connect(new StdioClientTransport({
		command: process.execPath,
		args: ["mcp/server.js"],
		env: { ...process.env, STDOUT_MCP_PORT: String(port) },
	}));

	const result = await client.callTool({ name: "list_sources", arguments: {} });

	assert.match(result.content[0].text, /Log server started \d+ seconds ago/);
	await exited;

	const health = await fetch(`${baseURL}/health`).then((response) => response.json());

	assert.equal(health.codeVersion, getCodeVersion());
	assert.notEqual(health.pid, oldDaemon.pid);
});

test("restarts the daemon if it exits during a session", async () => {
	const { pid } = await fetch(`${baseURL}/health`).then((response) => response.json());

	process.kill(pid);

	while (await fetch(`${baseURL}/health`).then(() => true, () => false)) {
		await new Promise((resolve) => setTimeout(resolve, 50));
	}

	const result = await client.callTool({ name: "list_sources", arguments: {} });

	assert.match(result.content[0].text, /Log server started \d+ seconds ago/);
	assert.notEqual((await fetch(`${baseURL}/health`).then((response) => response.json())).pid, pid);
});
