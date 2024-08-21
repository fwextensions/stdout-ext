import { useCallback, useEffect, useState } from "react";
import "./App.css";
import Console from "./Console.jsx";

export default function App()
{
	const [output, setOutput] = useState("");

	const handleMessage = useCallback((message, sender) => {
		if (message.data) {
			setOutput((output) => output + `${sender.id}: ${message.data}\n`);
		}
	}, []);

	useEffect(() => {
		chrome.runtime.onMessageExternal.addListener(handleMessage);

		return () => chrome.runtime.onMessageExternal.removeListener(handleMessage);
	}, []);

	return (
		<Console output={output} />
	);
}
