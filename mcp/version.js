// @ts-check
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

const McpDir = new URL("./", import.meta.url);

/**
 * Hash the code that the daemon runs, so an MCP server can tell whether a
 * running daemon was started from older code and needs to be replaced.
 *
 * @returns {string}
 */
export function getCodeVersion()
{
	const files = readdirSync(McpDir)
		.filter((name) => name.endsWith(".js"))
		.sort()
		.map((name) => new URL(name, McpDir));
	const hash = createHash("sha256");

		// constants.js gets the extension ID from the library
	files.push(new URL("../lib/stdout.js", McpDir));

	for (const file of files) {
		hash.update(readFileSync(file));
	}

	return hash.digest("hex").slice(0, 12);
}
