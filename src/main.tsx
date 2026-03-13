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
  const isProd = runtimeEnvironment === "production";
  const version = "20260313c";
  const iconSvg = isProd ? `/favicon.svg?v=${version}` : `/favicon-test.svg?v=${version}`;
  const icon32 = isProd ? `/icon-32.png?v=${version}` : `/icon-test-32.png?v=${version}`;
  const icon16 = isProd ? `/icon-16.png?v=${version}` : `/icon-test-16.png?v=${version}`;
  const touchIcon = isProd ? `/icon-180.png?v=${version}` : `/icon-test-180.png?v=${version}`;
  const manifestHref = isProd ? `/site.webmanifest?v=${version}` : `/site-test.webmanifest?v=${version}`;
  const maskHref = isProd ? `/safari-pinned-tab.svg?v=${version}` : `/safari-pinned-tab-test.svg?v=${version}`;
  const maskColor = isProd ? "#2f4e3f" : "#8d2f66";
  const themeColor = isProd ? "#0077ff" : "#ff73b4";

  const setHrefById = (id: string, href: string) => {
    const linkEl = document.getElementById(id) as HTMLLinkElement | null;
    if (linkEl) linkEl.href = href;
  };

  setHrefById("app-icon-any", iconSvg);
  setHrefById("app-icon-32", icon32);
  setHrefById("app-icon-16", icon16);
  setHrefById("app-shortcut-icon", iconSvg);
  setHrefById("app-touch-icon", touchIcon);
  setHrefById("app-manifest", manifestHref);
  setHrefById("app-mask-icon", maskHref);
  const maskLink = document.getElementById("app-mask-icon") as HTMLLinkElement | null;
  if (maskLink) {
    maskLink.setAttribute("color", maskColor);
  }
  const themeMeta = document.getElementById("app-theme-color");
  if (themeMeta) {
    themeMeta.setAttribute("content", themeColor);
  }
};

applyEnvironmentBranding();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
