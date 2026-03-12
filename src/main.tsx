import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./index.css";
import App from "./App";

if (window.location.hostname === "127.0.0.1") {
  const redirectUrl =
    `${window.location.protocol}//localhost` +
    `${window.location.port ? `:${window.location.port}` : ""}` +
    `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(redirectUrl);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
