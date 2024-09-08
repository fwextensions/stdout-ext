![icon](./extension/img/icon-128.png)

# stdout-ext

> A simple Chrome extension for console-logging *other* Chrome extensions


## Why?

Seeing console log output can be crucial for debugging Chrome extensions, especially when they use a manifest V3 service worker to respond to user-generated events, like a tab opening, the focus changing, etc.  Sure, you can inspect the service worker console, but leaving that devtools window open keeps the service worker active.  So you'll never see your extension go through the transition from active to inactive and back again &mdash; which is often where bugs sneak in.

`stdout-ext` provides an easy way to send console output from your service worker or other extension pages *without* keeping your background scripts active.


## Installation

```shell
npm install --save-dev stdout-ext
```

After installing the package, you'll need to add the unpacked `stdout` extension to Chrome.  To do so, drag the `extension` folder from `node_modules/stdout-ext/` into the Extensions window in Chrome (`chrome://extensions`).

Once `stdout` is running, click its <u>service worker</u> link to open the devtools window.  This is where any console output from your extension will be displayed.


## Usage

To send logs from your extension, import `stdout()` from the package and call it with the `stdout` extension ID, which you can get from the Chrome Extensions window.  (The exact ID will be unique to your local installation.)

```js
// service-worker.js
import stdout from "stdout-ext";

stdout("<ID for the unpacked stdout extension>");
console.log("my important message", { hello: "world" });
```

By default, the global `console` object will be wrapped with methods that forward all calls to the `stdout` extension, so anything passed to `console.log()`, `console.error()`, etc. in your extension will also be displayed in the `stdout` service worker's console.

Call `stdout()` once from each "page" in your extension from which you want to send console output: the service worker, the popup, content scripts, etc.  If you pass an empty string or `null` for the ID, `stdout()` will silently do nothing, so you can use an environment variable or something similar to enable log forwarding in development mode but disable it in production.


## Options

Instead of passing a plain string ID to `stdout()`, you can also pass an object that contains the `id` and other options.


### `wrapConsole`

If you don't want to wrap the global `console` object, set `wrapConsole` to `false`.  In that case, `stdout()` will return an object with the standard console methods that you can call when you want to send console output to the `stdout` extension:

```js
const { log, error } = stdout({ id: "...", wrapConsole: false });

console.log("this message will not be sent to stdout");
log("this message will be logged locally *and* sent to stdout", { hello: "world" });
error("so will this error", new Error("something went wrong"));
```


### `filename`

In the `stdout` devtools window, the filename of your extension page is prefixed to each line of output, since different parts of your extension can all send messages to that console.  By default, this filename is extracted from `location.pathname`, but you can specify a custom name by passing a `filename` field in the options object:

```js
// service-worker.js
stdout({ id: "...", filename: "background" });

// popup.html
stdout({ id: "...", filename: "toolbar" });
```


## License

[MIT](./LICENSE) © [John Dunning](https://github.com/fwextensions)
