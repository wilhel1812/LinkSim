import { AppShell } from "./components/AppShell";
import { UiGalleryPage } from "./components/UiGalleryPage";

function App() {
  if (window.location.pathname === "/ui-gallery") {
    return <UiGalleryPage />;
  }
  return <AppShell />;
}

export default App;
