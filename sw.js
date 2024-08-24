const FilenameStyle = "color: light-dark(#aaa, #888)";
const ResetStyle = "color: initial";
	// ignore %%, which escapes the % character
const SubstitutionPattern = /%[^%]/;

function handleMessage(
	message,
	sender,
	sendResponse)
{
	const { method, filename, args } = message;

	if (typeof console[method] === "function" && args?.length) {
		const [firstArg, ...rest] = args;
		let outputArgs = ["%c%s", FilenameStyle, filename, firstArg, ...rest];

		if (SubstitutionPattern.test(firstArg) && rest.length) {
				// firstArg contains a string substitution and there are additional args
				// that can be substituted in.  (a string with a % in it with no following
				// args, like "Pct light speed (%c)", wouldn't trigger a substitution.)
				// that firstArg has to be in the first argument to work, so add a style
				// reset substitution to our initial string and then concat the first
				// arg from the message.  then pass in the filename style, the filename,
				// and the reset style, and finally the rest of the message args.
			outputArgs = [
				"%c%s%c " + firstArg,
				FilenameStyle,
				filename,
				ResetStyle,
				...rest
			];
		}

		console[method].apply(console, outputArgs);
	}

		// if we don't call sendResponse(), Chrome will keep the calling service worker
		// alive waiting for a response, up to 5 minutes.  sending the response here
		// lets the service worker get terminated after 30 seconds.
	sendResponse(true);
}

chrome.runtime.onMessageExternal.addListener(handleMessage);
