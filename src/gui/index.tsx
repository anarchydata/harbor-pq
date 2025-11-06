/**
 * Entry point for the GUI
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

const rootElement = document.getElementById("root");
if (!rootElement) {
  const errorDiv = document.createElement("div");
  errorDiv.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:#ff0000;color:#fff;padding:20px;z-index:99999;";
  errorDiv.textContent = "ERROR: Root element not found!";
  document.body.appendChild(errorDiv);
  throw new Error("Root element not found");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

