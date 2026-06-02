import { lazy, Suspense } from "react";

const AppShell = lazy(() => import("./components/AppShell").then((module) => ({ default: module.AppShell })));
const UiGalleryPage = lazy(() => import("./components/UiGalleryPage").then((module) => ({ default: module.UiGalleryPage })));
const StatsPage = lazy(() => import("./components/StatsPage").then((module) => ({ default: module.StatsPage })));

function App() {
  if (window.location.pathname === "/ui-gallery") {
    return (
      <Suspense fallback={<div className="route-loading">Loading UI gallery...</div>}>
        <UiGalleryPage />
      </Suspense>
    );
  }
  if (window.location.pathname === "/stats") {
    return (
      <Suspense fallback={<div className="route-loading">Loading stats...</div>}>
        <StatsPage />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<div className="route-loading">Loading LinkSim...</div>}>
      <AppShell />
    </Suspense>
  );
}

export default App;
