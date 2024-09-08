const _console = console;
const noop = () => {};
let methods;

/**
 * @typedef {object} StdoutOptions
 *
 * @property {string?} id  The id of the `stdout` extension (like `"obca..."`),
 * which will depend on where the unpacked extension is installed on your system.
 * Passing an empty or undefined ID will cause `stdout()` to silently do nothing,
 * so you can use an environment variable or something similar to sometimes
 * enable log forwarding and sometimes not.
 *
 * @property {boolean?} wrapConsole  Whether to wrap the global `console` object
 * with methods that forward all calls to the `stdout` extension.
 *
 * @property {string?} filename  The name of the current extension page.  Defaults
 * to the last segment of `location.pathname`.
 */

/**
 * Wrap the local `console` object with methods that forward all calls to the
 * `stdout` extension.  This lets you view the console output in the `stdout`
 * devtools window without having to keep your own extension's devtools active.
 * The output will also be sent to your extension's console, in case it's open.
 *
 * @param {(string|StdoutOptions)?} options - Either the ID of the `stdout`
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

		// wrap all the console methods in the local extension to send the arguments
		// passed to them onto the stdout extension, where they can be viewed in the
		// service worker console
	methods = Object.keys(console)
		.filter((key) => typeof console[key] === "function")
		.reduce((result, method) => ({
			...result,
			[method](...args) {
				const payload = { method, filename, args };

				chrome.runtime.sendMessage(id, payload)
						// suppress any runtime.lastError messages, such as when
						// the stdout extension is not installed
					.then(noop, noop)

					// log the message locally as well
				_console[method](...args);
			}
		}), {});

	if (wrapConsole) {
		globalThis.console = methods;
	}

	return methods;
}
