import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconContext } from "@phosphor-icons/react";
import App from "./App";
import { MonitorWindow } from "./components/MonitorWindow";
import "./lib/horizontalWheel";
import "./index.css";

/** Secondary windows share this bundle; the window label tells us the role.
 * A monitor window is labelled `monitor-<profileId>` and renders only the
 * Monitoring view, not the full app. */
const MONITOR_PREFIX = "monitor-";
const label = getCurrentWindow().label;
const monitorProfile = label.startsWith(MONITOR_PREFIX)
  ? label.slice(MONITOR_PREFIX.length)
  : null;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <IconContext.Provider value={{ weight: "fill" }}>
      {monitorProfile ? <MonitorWindow profileId={monitorProfile} /> : <App />}
    </IconContext.Provider>
  </React.StrictMode>
);
