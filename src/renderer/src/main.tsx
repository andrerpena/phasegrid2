import { App } from "@renderer/App";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import "./css/index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
