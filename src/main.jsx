//import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

console.log("derp");
createRoot(document.getElementById("root")).render(<App />);

//createRoot(document.getElementById("root")).render(
//	<StrictMode>
//		<App />
//	</StrictMode>,
//);
