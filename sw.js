function handleMessage(
	message,
	sender,
	sendResponse)
{
	const { method, data } = message;

	if (typeof console[method] === "function" && data?.length) {
			// the first item in data is the caller's filename
		console[method].apply(console, ["%c%s", "color: #aaa", ...data]);
	}

		// if we don't call sendResponse(), Chrome will keep the calling service worker
		// alive waiting for a response, up to 5 minutes.  sending the response here
		// lets the service worker get terminated after 30 seconds.
	sendResponse(true);
}

chrome.runtime.onMessageExternal.addListener(handleMessage);
