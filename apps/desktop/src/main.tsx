import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import OverlayApp from "./overlay-app";
import { ErrorBoundary } from "./error-boundary";
import "./dev-reload-hook";
import "./styles.css";

const isOverlayRoute = window.location.hash.replace(/^#/, "").split("?")[0] === "overlay";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>{isOverlayRoute ? <OverlayApp /> : <App />}</ErrorBoundary>
  </React.StrictMode>,
);
