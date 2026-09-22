import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import "./styles.css";
import "./surfaces.css";
import "./brand.css";
import "./product.css";
import "./composer.css";
import "./quick.css";
import "./companion.css";
import "./extend.css";
import "./hub.css";
import { useApp } from "./core/store";

// Development only: a handle on the store from the devtools console. Debugging
// a desktop app without one means restarting to reach any interesting state.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__conduit = useApp;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
