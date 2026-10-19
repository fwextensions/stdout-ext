import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { ExtensionOrigin, IdleTimeout, Port } from "./constants.js";
import { LogStore } from "./store.js";

	// the stdout extension sends up to 500 entries per request
const MaxBodySize = 16 * 1024 * 1024;
const MaxWaitTime = 120 * 1000;

const store = new LogStore();
const bootId = randomUUID();
const startedAt = Date.now();
const allowedHosts = new Set([`127.0.0.1:${Port}`, `localhost:${Port}`]);
let lastActivity = Date.now();
let activeWaits = 0;

class HTTPError extends Error
{
	constructor(
		status,
		message)
	{
		super(message);
		this.status = status;
	}
}

function readJSON(
	req)
{
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;

		req.on("data", (chunk) => {
			size += chunk.length;

			if (size > MaxBodySize) {
				reject(new HTTPError(413, "Request body too large"));
				req.destroy();
			} else {
				chunks.push(chunk);
			}
		});
		req.on("end", () => {
			try {
				resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
			} catch {
				reject(new HTTPError(400, "Invalid JSON"));
			}
		});
		req.on("error", reject);
	});
}

function getStatus()
{
	return {
		status: "ok",
		pid: process.pid,
		bootId,
		startedAt,
		lastIngestAt: store.lastIngestAt,
		maxSeq: store.maxSeq,
		entryCount: store.entries.length,
	};
}

async function route(
	req,
	res)
{
	const { method, url } = req;
	const { origin } = req.headers;

		// reject requests addressed to some other host name, which is how a web page
		// could reach us through DNS rebinding
	if (!allowedHosts.has(req.headers.host)) {
		throw new HTTPError(403, "Forbidden host");
	}

	if (method === "POST" && url === "/ingest") {
		if (origin !== ExtensionOrigin) {
			throw new HTTPError(403, "Forbidden origin");
		}

		return store.ingest(await readJSON(req));
	}

		// browsers always send an Origin with cross-origin requests, so this keeps
		// web pages from reading the logs.  the MCP servers that query us don't
		// send one.
	if (origin && origin !== ExtensionOrigin) {
		throw new HTTPError(403, "Forbidden origin");
	}

	lastActivity = Date.now();

	if (method === "GET" && url === "/health") {
		return getStatus();
	}

	if (method === "GET" && url === "/sources") {
		return { ...getStatus(), sources: store.getSources() };
	}

	if (method === "POST" && url === "/query") {
		const { after, limit, filter } = await readJSON(req);

		return { ...getStatus(), ...store.query({ after, limit, filter }) };
	}

	if (method === "POST" && url === "/wait") {
		const { after, limit, filter, timeoutMs = 30000 } = await readJSON(req);
		const { promise, cancel } = store.wait({
			after,
			limit,
			filter,
			timeoutMs: Math.min(Math.max(timeoutMs, 0), MaxWaitTime),
		});

		activeWaits++;
		res.on("close", cancel);

		try {
			return { ...await promise, ...getStatus() };
		} finally {
			activeWaits--;
			lastActivity = Date.now();
		}
	}

	throw new HTTPError(404, "Not found");
}

const server = createServer(async (req, res) => {
	let status = 200;
	let body;

	try {
		body = await route(req, res);
	} catch (error) {
			// a bad search pattern throws a SyntaxError from the RegExp constructor
		status = error.status ?? (error instanceof SyntaxError ? 400 : 500);
		body = { error: error.message };
	}

	if (!res.destroyed) {
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(body));
	}
});

server.on("error", (error) => {
		// another copy of the daemon is already running, so let it handle things
	process.exit(error.code === "EADDRINUSE" ? 0 : 1);
});

server.listen(Port, "127.0.0.1");

setInterval(() => {
	if (!activeWaits && Date.now() - lastActivity > IdleTimeout) {
		process.exit(0);
	}
}, Math.min(IdleTimeout, 60 * 1000));
