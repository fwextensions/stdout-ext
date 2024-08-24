import { useCallback, useEffect, useState } from "react";
import { Console } from "console-feed";
import "./App.css";

export default function App()
{
	const [logs, setLogs] = useState([]);

	const handleMessage = useCallback((message, sender, sendResponse) => {
		const { method, data } = message;

		if (data) {
			console[method].apply(console, data);
			setLogs((currentLogs) => [...currentLogs, { method, data }]);
		}

			// if we don't call sendResponse(), Chrome will keep the calling service worker
			// alive waiting for a response, up to 5 minutes.  sending the response here
			// lets the service worker get terminated after 30 seconds.
		sendResponse(null);
	}, []);

	useEffect(() => {
		chrome.runtime.onMessageExternal.addListener(handleMessage);

		return () => chrome.runtime.onMessageExternal.removeListener(handleMessage);
	}, []);

	return (
		<Console logs={logs} />
	);
}
