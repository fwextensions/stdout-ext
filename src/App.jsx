import { useCallback, useEffect, useState } from "react";
import { Console } from "console-feed";
import "./App.css";

export default function App()
{
	const [logs, setLogs] = useState([]);

	const handleMessage = useCallback((message, sender) => {
		const { method, data } = message;

		if (data) {
			setLogs((currentLogs) => [...currentLogs, { method, data }]);
		}
	}, []);

	useEffect(() => {
		chrome.runtime.onMessageExternal.addListener(handleMessage);

		return () => chrome.runtime.onMessageExternal.removeListener(handleMessage);
	}, []);

	return (
		<Console logs={logs} />
	);
}
