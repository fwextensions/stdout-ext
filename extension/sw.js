import { addEntry } from "./buffer.js";
import { fromJSONSafe } from "./deserialize.js";
import { handleAlarm, handleStorageChange, restoreAgentMode, scheduleFlush, toggleAgentMode } from "./sync.js";

const FilenameStyle = "color: light-dark(#aaa, #888)";
const ResetStyle = "color: initial";
	// ignore %%, which escapes the % character
const SubstitutionPattern = /%[^%]/;

const senderIDs = new Set();

function handleMessage(
	message,
	sender,
	sendResponse)
{
	const { method, filename, args, time = Date.now(), name, loadId } = message;

	senderIDs.add(sender.id);

	if (!Array.isArray(args)) {
		sendResponse(false);

		return;
	}

		// store every message, whether or not agent mode is on, so that an agent
		// can see what happened before it connected.  the args arrive as JSON, so
		// they can be stored and sent on as is.
	addEntry({
		time,
		extensionId: sender.id,
		extensionName: name,
		filename,
		loadId,
		method,
		args,
	})
		.then(scheduleFlush)
		.catch((error) => console.error("stdout: couldn't store log entry", error));

	if (typeof console[method] === "function") {
		const [firstArg, ...rest] = args;
		const senderInfo = (senderIDs.size > 1 ? sender.id.slice(0, 4) + " " : "") + filename;
		let outputArgs = ["%c%s", FilenameStyle, senderInfo, ...args.map(fromJSONSafe)];

		if (SubstitutionPattern.test(firstArg) && rest.length) {
				// firstArg contains a string substitution and there are additional args
				// that can be substituted in.  (a string with a % in it but no following
				// args, like "Pct light speed (%c)", wouldn't trigger a substitution.)
				// that firstArg has to be in the first argument to work, so add a style
				// reset substitution to our initial string (the second %c) and then
				// concat the first arg from the message.  then pass in the filename
				// style, the filename, and the reset style, and finally the rest of
				// the message args.
			outputArgs = [
				"%c%s%c " + firstArg,
				FilenameStyle,
				senderInfo,
				ResetStyle,
				...rest.map(fromJSONSafe)
			];
		}

		console[method](...outputArgs);
	}

		// if we don't call sendResponse(), Chrome will keep the calling service worker
		// alive waiting for a response, up to 5 minutes.  sending the response here
		// lets the service worker get terminated after 30 seconds.
	sendResponse(true);
}

chrome.runtime.onMessageExternal.addListener(handleMessage);
chrome.action.onClicked.addListener(toggleAgentMode);
chrome.storage.onChanged.addListener(handleStorageChange);
chrome.alarms.onAlarm.addListener(handleAlarm);
chrome.runtime.onStartup.addListener(restoreAgentMode);
chrome.runtime.onInstalled.addListener(restoreAgentMode);
