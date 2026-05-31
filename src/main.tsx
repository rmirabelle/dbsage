import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconContext } from "@phosphor-icons/react";
import App from "./App";
import { MonitorWindow } from "./components/MonitorWindow";
import { AdminWindow } from "./components/AdminWindow";
import { SplashScreen } from "./components/SplashScreen";
import "./lib/horizontalWheel";
import "./index.css";

/** Secondary windows share this bundle; the window label tells us the role.
 * A monitor window is labelled `monitor-<profileId>` and an admin window
 * `admin-<profileId>`; each renders only its own view, not the full app. */
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
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <IconContext.Provider value={{ weight: "fill" }}>
      <Root />
    </IconContext.Provider>
  </React.StrictMode>
);
