const FilenameStyle = "color: light-dark(#aaa, #888)";
const ResetStyle = "color: initial";
	// ignore %%, which escapes the % character
const SubstitutionPattern = /%[^%]/;

const senderIDs = new Set();

function convertError(
	value)
{
	if (value?.__type === "Error") {
		const { __type, message, name, stack, ...rest } = value;
		const err = new Error(message);

			// reconstruct the error object that was sent through runtime.sendMessage()
			// as best we can
		Object.assign(err, { name, stack, ...rest });

		return err;
	}

	return value;
}

function handleMessage(
	message,
	sender,
	sendResponse)
{
	const { method, filename, args } = message;

	senderIDs.add(sender.id);

	if (typeof console[method] === "function") {
		const [firstArg, ...rest] = args;
		const senderInfo = (senderIDs.size > 1 ? sender.id.slice(0, 4) + " " : "") + filename;
		let outputArgs = ["%c%s", FilenameStyle, senderInfo, ...args.map(convertError)];

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
				...rest.map(convertError)
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
