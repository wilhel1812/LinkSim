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

const host = window.location.hostname.toLowerCase();
const isStagingHost = host.startsWith("staging.") || host.endsWith(".linksim-staging.pages.dev");
if (isStagingHost) {
  document.documentElement.classList.add("env-staging");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
