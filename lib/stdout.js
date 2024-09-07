const _console = console;

/**
 * Wrap the local `console` object with methods that forward all calls to the
 * `stdout` extension.  This lets you view the console output in the `stdout`
 * devtools window without having to keep your own extension's devtools active.
 * The output will also be sent to your extension's console, in case it's open.
 *
 * @param {string?} id - The id of the `stdout` extension (like `"obca..."`),
 * which will depend on where the unpacked extension is installed on your system.
 * Passing an empty string or nothing will not wrap the `console` object, so you
 * can use an environment variable or something similar to sometimes enable log
 * forwarding and sometimes not.
 *
 * @returns {void}
 */
export default function stdout(
	id)
{
	if (!id || typeof id !== "string") {
		return;
	}

		// provide a noop handler for the response from the stdout extension
	const noop = () => {};
	const filename = location.pathname.split("/").pop();

		// wrap all the console methods in the local extension to send the arguments
		// passed to them onto the stdout extension, where they can be viewed in the
		// service worker console
	globalThis.console = Object.keys(console)
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
}
