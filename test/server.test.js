import { request } from "node:http";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client } from "@modelcontextprotocol/client";
import { STDOUT_ID } from "../lib/stdout.js";

const port = 40000 + Math.floor(Math.random() * 10000);
const baseURL = `http://127.0.0.1:${port}`;
const extensionOrigin = `chrome-extension://${STDOUT_ID}`;
let client;
let legacyClient;

function ingest(
	body,
	origin = extensionOrigin)
{
	return fetch(`${baseURL}/ingest`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: origin },
		body: JSON.stringify({ bufferId: "test", ...body }),
	});
}

async function callTool(
	name,
	args = {})
{
	const result = await client.callTool({ name, arguments: args });

	return result.content[0].text;
}

const entry = (seq, args, method = "log", extra = {}) => ({
	seq,
	time: Date.now(),
	extensionId: "abcdefghijklmnopabcdefghijklmnop",
	extensionName: "Test Extension",
	filename: "sw.js",
	method,
	args,
	...extra,
});

function connect(
	options)
{
	const newClient = new Client({ name: "test", version: "1.0.0" }, options);

	return newClient.connect(new StdioClientTransport({
		command: process.execPath,
		args: ["mcp/server.js"],
		env: { ...process.env, STDOUT_MCP_PORT: String(port) },
	})).then(() => newClient);
}

before(async () => {
	client = await connect({ versionNegotiation: { mode: { pin: "2026-07-28" } } });
		// clients default to the 2025 protocol
	legacyClient = await connect();
});

after(async () => {
	const health = await fetch(`${baseURL}/health`).then((response) => response.json(), () => null);

	await client.close();
	await legacyClient.close();

	if (health) {
		process.kill(health.pid);
	}
});

test("lists the tools", async () => {
	const { tools } = await client.listTools();

	assert.equal(client.getNegotiatedProtocolVersion(), "2026-07-28");
	assert.deepEqual(tools.map(({ name }) => name).sort(), ["get_logs", "list_sources", "mark", "wait_for_log"]);
});

test("serves clients using the 2025 protocol", async () => {
	const { tools } = await legacyClient.listTools();
	const result = await legacyClient.callTool({ name: "list_sources", arguments: {} });

	assert.equal(legacyClient.getNegotiatedProtocolVersion(), "2025-11-25");
	assert.equal(tools.length, 4);
	assert.match(result.content[0].text, /Log server started/);
});

test("starts the daemon and reports that the extension hasn't connected", async () => {
	const text = await callTool("get_logs");

	assert.match(text, /No matching log entries/);
	assert.match(text, /hasn't sent anything/);
});

test("only accepts entries from the stdout extension", async () => {
	assert.equal((await ingest({ afterSeq: 0, entries: [] }, "chrome-extension://someoneelse")).status, 403);
	assert.equal((await ingest({ afterSeq: 0, entries: [] }, "https://example.com")).status, 403);
	assert.equal((await fetch(`${baseURL}/health`, { headers: { Origin: "https://example.com" } })).status, 403);

		// fetch() won't let us change the Host header, which is what a DNS rebinding
		// attack would send
	const status = await new Promise((resolve, reject) => {
		request(`${baseURL}/health`, { headers: { Host: "evil.example" } }, (response) => {
			response.resume();
			resolve(response.statusCode);
		}).on("error", reject).end();
	});

	assert.equal(status, 403);
});

test("returns ingested logs with a cursor", async () => {
	let response = await ingest({ afterSeq: null, entries: [] });

	assert.deepEqual(await response.json(), { maxSeq: 0 });
	response = await ingest({
		afterSeq: 0,
		entries: [
			entry(1, ["%s started", "worker"]),
			entry(2, ["request failed", { __type: "Error", name: "TypeError", message: "boom", stack: "TypeError: boom\n    at foo (sw.js:1:1)" }], "error"),
		],
	});
	assert.deepEqual(await response.json(), { maxSeq: 2 });

	const text = await callTool("get_logs");

	assert.match(text, /^--- \d{4}-\d\d-\d\d, times in UTC[+-]\d\d:\d\d ---\n#1 \d\d:\d\d:\d\d\.\d{3} \[log\] Test Extension\/sw\.js: worker started/);
	assert.match(text, /#2 \S+ \+\d+ms \[error\] Test Extension\/sw\.js: request failed TypeError: boom\n {8}at foo/);
	assert.match(text, /cursor: 2/);
	assert.doesNotMatch(text, /Note:/);
	assert.match(await callTool("get_logs", { levels: ["error"] }), /^#2 /m);
	assert.match(await callTool("get_logs", { after: 2 }), /No matching log entries/);
	assert.match(await callTool("list_sources"), /Test Extension \(abcdefghijklmnopabcdefghijklmnop\): 2 entries.*files: sw\.js \(2\)/);
});

test("waits for a new matching log", async () => {
	const waiting = callTool("wait_for_log", { pattern: "ready$", timeoutSeconds: 10 });

	await new Promise((resolve) => setTimeout(resolve, 200));
	await ingest({ afterSeq: 2, entries: [entry(3, ["not ready yet!"]), entry(4, ["now ready"])] });

	const text = await waiting;

	assert.match(text, /^#4 .*now ready/m);
	assert.doesNotMatch(text, /#3/);
	assert.match(text, /cursor: 4/);
	assert.match(
		await callTool("wait_for_log", { pattern: "never", timeoutSeconds: 1 }),
		/No matching log entry within 1 seconds/
	);
});

test("reports bad patterns as tool errors", async () => {
	const result = await client.callTool({ name: "get_logs", arguments: { search: "(" } });

	assert.equal(result.isError, true);
	assert.match(result.content[0].text, /Invalid regular expression/);
});

test("marks the log and shows page loads and time deltas", async () => {
	const time = Date.now();
	const marked = await callTool("mark", { label: "repro start" });

	assert.match(marked, /Added this line:\n--- .* ---\n#5 \S+ --- mark: repro start ---/);
	assert.match(marked, /cursor: 5/);
	await ingest({
		afterSeq: 4,
		entries: [
			{ ...entry(5, ["first"], "log", { loadId: "load1" }), time },
			{ ...entry(6, ["second"], "log", { loadId: "load1" }), time: time + 1500 },
		],
	});

	const text = await callTool("get_logs", { after: 5 });

	assert.match(text, /^--- Test Extension\/sw\.js loaded ---\n#6 \S+ \[log\] .*first\n#7 \S+ \+1\.5s \[log\] .*second/m);
		// times of day are local, like in the stdout console
	assert.match(text, new RegExp(`#6 ${new Date(time).toTimeString().slice(0, 8)}\.`));
	assert.match(await callTool("get_logs", { around: 5, limit: 3 }), /^#4 .*\n#5 .*mark: repro start.*\n--- .*loaded ---\n#6 /m);
	assert.match(await callTool("get_logs", { since: "1m", search: "second" }), /#5 .*mark.*\n#7 /);
	assert.equal((await client.callTool({ name: "get_logs", arguments: { since: "soon" } })).isError, true);
});
