import { App } from "@renderer/App";
import { watchTheme } from "@renderer/theming/theme-store";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import "./css/index.css";

// Before the first render, so the window never shows one theme's ground and then repaints into
// another. Never stopped: the document outlives the application.
watchTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
