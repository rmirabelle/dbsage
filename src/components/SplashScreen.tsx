import appIcon from "../assets/app-icon.png";
import pkg from "../../package.json";

/**
 * Contents of the standalone splash window. Mirrors the static splash in
 * index.html exactly (same layout, fonts, colors) so React can take over
 * without a visible reflow. Layout matches the About dialog: icon on the left,
 * text column on the right. The version is read from package.json at build
 * time — the splash window has no IPC capabilities, so it can't call the
 * get_app_version command the main window uses.
 */
export function SplashScreen() {
  return (
    <div
      data-el="splash-screen"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        background: "#22252f",
        color: "#e4e4e7",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <img src={appIcon} alt="DB Sage" width={120} height={120} style={{ display: "block", flexShrink: 0 }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", maxWidth: 270 }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: "#a3e635", letterSpacing: "0.01em" }}>
            DB Sage
          </div>
          <div style={{ fontSize: 11.5, lineHeight: "16px", height: 16, color: "#71717a", marginTop: 2 }}>
            Version {pkg.version}
          </div>
          <div style={{ fontSize: 12, color: "#a1a1aa", marginTop: 4 }}>by Robert Mirabelle</div>
          <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "#71717a", marginTop: 8 }}>
            A focused, opinionated, intelligent and robust MySQL client for Windows.
          </div>
        </div>
      </div>
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 9999,
          border: "3px solid rgba(255,255,255,0.12)",
          borderTopColor: "#a3e635",
          animation: "dbsage-spin 0.7s linear infinite",
        }}
      />
    </div>
  );
}
