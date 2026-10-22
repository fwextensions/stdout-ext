import { createServer } from "node:http";
import { once } from "node:events";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpServer } from "../mcp/tools.js";

const Modern = { mode: { pin: "2026-07-28" } };
let cancelCount = 0;
	// a store whose waits never finish on their own
const store = {
	wait: () => ({ promise: new Promise(() => {}), cancel: () => cancelCount++ }),
};
let server;

async function connect(
	versionNegotiation)
{
	const client = new Client({ name: "test", version: "1.0.0" }, { versionNegotiation });

	await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`)));

	return client;
}

async function waitForCancel(
	count)
{
	for (let i = 0; i < 40 && cancelCount < count; i++) {
		await new Promise((resolve) => setTimeout(resolve, 50));
	}

	assert.equal(cancelCount, count);
}

before(async () => {
	const handle = toNodeHandler(createMcpHandler(() => createMcpServer({ store, getStatus: () => ({}) })));

	server = createServer((req, res) => handle(req, res)).listen(0, "127.0.0.1");
	await once(server, "listening");
});

after(() => {
	server.closeAllConnections();
	server.close();
});

test("stops waiting for a log when the call is cancelled", async () => {
	const client = await connect(Modern);
	const controller = new AbortController();
	const call = client.callTool({ name: "wait_for_log", arguments: { pattern: "never" } }, { signal: controller.signal });

	await new Promise((resolve) => setTimeout(resolve, 200));
	controller.abort();
	await assert.rejects(call);
	await waitForCancel(1);
	await client.close();
});

for (const [era, versionNegotiation] of [["2026-07-28", Modern], ["2025", undefined]]) {
	test(`stops waiting for a log when a ${era} client goes away`, async () => {
		const count = cancelCount;
		const client = await connect(versionNegotiation);
		const call = client.callTool({ name: "wait_for_log", arguments: { pattern: "never" } });

		call.catch(() => {});
		await new Promise((resolve) => setTimeout(resolve, 200));
		await client.close();
		await waitForCancel(count + 1);
	});
}
