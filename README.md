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

You can also let a coding agent read the output directly.  See [Reading logs from a coding agent](#reading-logs-from-a-coding-agent).


## Usage

To send logs from your extension, import `stdout()` from the package and call it with the `stdout` extension ID.  The ID is fixed by the extension's manifest, so it's always `lnkfeennpkaoelponfafleomlmgjfjok`, which the package exports as `STDOUT_ID`.  (Versions before 0.1.0 had no fixed ID, so if you upgrade, replace the ID you used before.)

```js
// service-worker.js
import stdout, { STDOUT_ID } from "stdout-ext";

stdout(STDOUT_ID);
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


## Reading logs from a coding agent

The package includes an [MCP](https://modelcontextprotocol.io) server, `stdout-ext-mcp`, that lets a coding agent like Claude Code read your extension's console output.  It needs no other changes to your extension.

The `stdout` extension stores the last 10,000 log messages it receives, whether or not an agent is connected.  So when you notice something going wrong and start an agent session, the agent can see what was logged beforehand.


### Setup

Add the server to your agent's MCP configuration.  For Claude Code, run this in your extension's project:

```shell
claude mcp add stdout -- npx stdout-ext-mcp
```

Or add it to the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "stdout": {
      "command": "npx",
      "args": ["stdout-ext-mcp"]
    }
  }
}
```

The agent starts the server when it needs it.  The server starts a small background process on port 47321 that holds the logs and is shared by all agent sessions.  It exits after two hours without use.


### Agent mode

To let `stdout` send its logs to the server, click the `stdout` icon in Chrome's toolbar.  (You may need to pin it from the Extensions menu first.)  The icon shows an **MCP** badge while agent mode is on.  The badge is green when the server has received the logs and gray while `stdout` is waiting for a server to start.

While agent mode is on, `stdout` sends new log messages to the server as they arrive.  It also checks for the server once a minute, so a newly started agent session gets the stored logs within about a minute.  These checks wake the `stdout` service worker briefly but don't keep it running.

Click the icon again to turn agent mode off.  The logs are still stored and shown in the `stdout` console, but nothing is sent to the server.


### Tools

| Tool | Description |
|------|-------------|
| `get_logs` | Returns the most recent log messages, the messages after a cursor from a previous call, or the messages around a given one.  Can filter by level, extension, filename, a regular expression, or how recent the messages are, like `10m`. |
| `wait_for_log` | Waits for a new log message that matches a regular expression, such as after the agent asks you to reproduce a problem. |
| `mark` | Adds a line to the log, such as before the agent asks you to reproduce a problem, so the messages that follow are easy to find. |
| `list_sources` | Lists the extensions and pages that have sent logs, and when `stdout` last connected. |

Each message shows the time since the previous one, like `+251ms`.  A `loaded` line marks the first message from each page load, so you can see when a service worker restarted or a popup was reopened.  These lines need the version of `stdout-ext` that sends a page-load ID.


## License

[MIT](./LICENSE) © [John Dunning](https://github.com/fwextensions)
