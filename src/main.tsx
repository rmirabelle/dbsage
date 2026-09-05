import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconContext } from "@phosphor-icons/react";
import App from "./App";
import { MonitorWindow } from "./components/MonitorWindow";
import { AdminWindow } from "./components/AdminWindow";
import { PeekWindow } from "./components/PeekWindow";
import { HelpWindow } from "./components/HelpWindow";
import { TornTabWindow } from "./components/TornTabWindow";
import { SplashScreen } from "./components/SplashScreen";
import "./lib/horizontalWheel";
import "./index.css";

/** Secondary windows share this bundle; the window label tells us the role.
 * A monitor window is labelled `monitor-<profileId>`, an admin window
 * `admin-<profileId>`, a torn-off tab `tab-<n>`, a peek `peek-<n>`, and the
 * Help library `help`; each renders only its own view, not the full app. */
const MONITOR_PREFIX = "monitor-";
const ADMIN_PREFIX = "admin-";
const label = getCurrentWindow().label;
const monitorProfile = label.startsWith(MONITOR_PREFIX)
  ? label.slice(MONITOR_PREFIX.length)
  : null;
const adminProfile = label.startsWith(ADMIN_PREFIX)
  ? label.slice(ADMIN_PREFIX.length)
  : null;

function Root() {
  if (label === "splash") return <SplashScreen />;
  if (monitorProfile) return <MonitorWindow profileId={monitorProfile} />;
  if (adminProfile) return <AdminWindow profileId={adminProfile} />;
  if (label.startsWith("peek-")) return <PeekWindow label={label} />;
  if (label.startsWith("tab-")) return <TornTabWindow label={label} />;
  if (label === "help") return <HelpWindow />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <IconContext.Provider value={{ weight: "fill" }}>
      <Root />
    </IconContext.Provider>
  </React.StrictMode>
);
