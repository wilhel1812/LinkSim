import { useEffect, useRef } from "react";
import { AppShell } from "./components/AppShell";
import { useAppStore } from "./store/appStore";

function App() {
  const syncSiteElevationsOnline = useAppStore((state) => state.syncSiteElevationsOnline);
  const autoSynced = useRef(false);

  useEffect(() => {
    if (autoSynced.current) return;
    autoSynced.current = true;
    void syncSiteElevationsOnline();
  }, [syncSiteElevationsOnline]);

  return <AppShell />;
}

export default App;
