import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./index.css";
import App from "./App";
import { getCurrentRuntimeEnvironment } from "./lib/environment";

if (window.location.hostname === "127.0.0.1") {
  const redirectUrl =
    `${window.location.protocol}//localhost` +
    `${window.location.port ? `:${window.location.port}` : ""}` +
    `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(redirectUrl);
}

const runtimeEnvironment = getCurrentRuntimeEnvironment();
document.documentElement.classList.remove("env-local", "env-staging", "env-production");
document.documentElement.classList.add(`env-${runtimeEnvironment}`);

const applyEnvironmentBranding = () => {
  document.title =
    runtimeEnvironment === "production"
      ? "LinkSim"
      : runtimeEnvironment === "local"
        ? "[LOCAL] LinkSim"
        : "[TEST] LinkSim";
  const iconHref = runtimeEnvironment === "production" ? "/favicon.svg?v=20260313b" : "/favicon-test.svg?v=20260313b";
  for (const selector of ['link[rel="icon"]', 'link[rel="shortcut icon"]']) {
    const linkEl = document.querySelector<HTMLLinkElement>(selector);
    if (linkEl) linkEl.href = iconHref;
  }
};

applyEnvironmentBranding();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
