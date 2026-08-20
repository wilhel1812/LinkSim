import { lazy, Suspense, type ReactNode } from "react";
import { SiteNoticeBanner } from "./components/SiteNoticeBanner";

const AppShell = lazy(() => import("./components/AppShell").then((module) => ({ default: module.AppShell })));
const UiGalleryPage = lazy(() => import("./components/UiGalleryPage").then((module) => ({ default: module.UiGalleryPage })));
const StatsPage = lazy(() => import("./components/StatsPage").then((module) => ({ default: module.StatsPage })));

function App() {
  let route: ReactNode;
  if (window.location.pathname === "/ui-gallery") {
    route = (
      <Suspense fallback={<div className="route-loading">Loading UI gallery...</div>}>
        <UiGalleryPage />
      </Suspense>
    );
  } else if (window.location.pathname === "/stats") {
    route = (
      <Suspense fallback={<div className="route-loading">Loading stats...</div>}>
        <StatsPage />
      </Suspense>
    );
  } else {
    route = (
      <Suspense fallback={<div className="route-loading">Loading LinkSim...</div>}>
        <AppShell />
      </Suspense>
    );
  }
  return (
    <div className="site-notice-app-layout">
      <SiteNoticeBanner />
      <div className="site-notice-app-content">{route}</div>
    </div>
  );
}

export default App;
