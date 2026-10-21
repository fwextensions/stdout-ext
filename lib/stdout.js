/**
 * The ID of the unpacked `stdout` extension.  It's fixed by the `key` in the
 * extension's manifest, so it's the same wherever the extension is installed.
 */
export const STDOUT_ID = "lnkfeennpkaoelponfafleomlmgjfjok";

const _console = console;
const noop = () => {};
let methods;

const MaxDepth = 8;
const MaxStringLength = 10000;
const MaxItems = 500;

function truncateString(
	value)
{
	if (value.length <= MaxStringLength) {
		return value;
	}

	return `${value.slice(0, MaxStringLength)}… [${value.length - MaxStringLength} more chars]`;
}

/**
 * Convert a value into one that survives being sent to the stdout extension.
 * Extension messages are serialized as JSON, so values JSON can't represent
 * (undefined, bigints, Maps, Errors, cycles, etc.) become objects with a `__type`
 * field, which the stdout extension and MCP server know how to display.  Very
 * long strings, big collections and deep nesting are truncated.
 *
 * @param {any} value
 * @param {number} [depth]
 * @param {WeakSet<object>} [ancestors]
 * @returns {any}
 */
export function toJSONSafe(
	value,
	depth = 0,
	ancestors = new WeakSet())
{
	switch (typeof value) {
		case "string":
			return truncateString(value);

		case "boolean":
			return value;

		case "number":
			return Number.isFinite(value)
				? value
				: { __type: "number", value: String(value) };

		case "undefined":
			return { __type: "undefined" };

		case "bigint":
			return { __type: "bigint", value: String(value) };

		case "symbol":
		case "function":
			return { __type: typeof value, value: String(value) };
	}

	if (value === null) {
		return null;
	}

	if (ancestors.has(value)) {
		return { __type: "Circular" };
	}

	if (depth >= MaxDepth) {
		return { __type: "Truncated" };
	}

	const convert = (child) => toJSONSafe(child, depth + 1, ancestors);

		// only track the current path through the object graph, so that an object
		// referenced twice from different branches isn't reported as circular
	ancestors.add(value);

	try {
		if (value instanceof Error) {
			const { name, message, stack, ...rest } = value;

			return {
				...Object.fromEntries(Object.entries(rest).map(([key, child]) => [key, convert(child)])),
				__type: "Error",
				name: name ?? value.constructor?.name ?? "Error",
				message: truncateString(String(message ?? "")),
				stack: typeof stack === "string" ? truncateString(stack) : undefined,
			};
		}

		if (value instanceof Date) {
			return {
				__type: "Date",
				value: Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString(),
			};
		}

		if (value instanceof RegExp) {
			return { __type: "RegExp", value: String(value) };
		}

		if (value instanceof Map) {
			return {
				__type: "Map",
				size: value.size,
				entries: [...value].slice(0, MaxItems).map(([key, child]) => [convert(key), convert(child)]),
			};
		}

		if (value instanceof Set) {
			return {
				__type: "Set",
				size: value.size,
				values: [...value].slice(0, MaxItems).map(convert),
			};
		}

		if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
			return { __type: value.constructor.name, byteLength: value.byteLength };
		}

		if (Array.isArray(value)) {
			const result = value.slice(0, MaxItems).map(convert);

			if (value.length > MaxItems) {
				result.push({ __type: "More", count: value.length - MaxItems });
			}

			return result;
		}

		const entries = Object.entries(value);
		const result = Object.fromEntries(entries.slice(0, MaxItems).map(([key, child]) => [key, convert(child)]));

		if (entries.length > MaxItems) {
			result["…"] = { __type: "More", count: entries.length - MaxItems };
		}

		return result;
	} finally {
		ancestors.delete(value);
	}
}

/**
 * @typedef {object} StdoutOptions
 *
 * @property {string} [id]  The id of the `stdout` extension (like `"obca..."`),
 * which will depend on where the unpacked extension is installed on your system.
 * Passing an empty or undefined ID will cause `stdout()` to silently do nothing,
 * so you can use an environment variable or something similar to sometimes
 * enable log forwarding and sometimes not.
 *
 * @property {boolean} [wrapConsole]  Whether to wrap the global `console` object
 * with methods that forward all calls to the `stdout` extension.
 *
 * @property {string} [filename]  The name of the current extension page.  Defaults
 * to the last segment of `location.pathname`.
 */

/**
 * Wrap the local `console` object with methods that forward all calls to the
 * `stdout` extension.  This lets you view the console output in the `stdout`
 * devtools window without having to keep your own extension's devtools active.
 * The output will also be sent to your extension's console, in case it's open.
 *
 * @param {string|StdoutOptions} [options] - Either the ID of the `stdout`
 * extension or an options object that contains the `id` and other options.
 *
 * @returns {typeof console}
 */
export default function stdout(
	options)
{
	if (!options || (typeof options !== "string" && !options.id)) {
		return _console;
	}

	if (methods) {
			// only generate the methods once, even if we're called multiple times
		return methods;
	}

	if (typeof options === "string") {
		options = { id: options };
	}

	const {
		id,
		filename = location.pathname.split("/").pop(),
		wrapConsole = true,
	} = options;
		// identify this extension in the logs that coding agents read
	const name = chrome.runtime.getManifest?.().name;
		// identify this page load, so agents can tell when a service worker restarts
		// or a popup is reopened.  crypto.randomUUID() isn't available to content
		// scripts on http: pages.
	const loadId = Date.now().toString(36) + Math.random().toString(36).slice(2);

		// wrap all the console methods in the local extension to send the arguments
		// passed to them onto the stdout extension, where they can be viewed in the
		// service worker console
	methods = Object.keys(console)
		.filter((key) => typeof console[key] === "function")
		.reduce((result, method) => ({
			...result,
			[method](...args) {
				try {
					const payload = {
						method,
						filename,
						name,
						loadId,
						time: Date.now(),
						args: args.map((arg) => toJSONSafe(arg)),
					};

					chrome.runtime.sendMessage(id, payload)
							// suppress any runtime.lastError messages, such as when
							// the stdout extension is not installed
						.then(noop, noop);
				} catch {
						// don't let a value that can't be sent, like an object with a
						// throwing getter, break the caller's logging
				}

					// log the message locally as well
				_console[method](...args);
			}
		}), {});

	if (wrapConsole) {
		globalThis.console = methods;
	}

	return methods;
}
