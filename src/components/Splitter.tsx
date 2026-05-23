import { useRef } from "react";
import { useUi } from "../state/ui";

export function Splitter() {
  const setSidebarWidth = useUi((s) => s.setSidebarWidth);
  const startRef = useRef<{ x: number; w: number } | null>(null);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={(e) => {
        startRef.current = { x: e.clientX, w: useUi.getState().sidebarWidth };
        const onMove = (ev: MouseEvent) => {
          if (!startRef.current) return;
          const delta = ev.clientX - startRef.current.x;
          setSidebarWidth(startRef.current.w + delta);
        };
        const onUp = () => {
          startRef.current = null;
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }}
      onDoubleClick={() => setSidebarWidth(256)}
      className="w-1 shrink-0 cursor-col-resize bg-zinc-800/60 hover:bg-accent-500/40 transition-colors relative group"
      title="Drag to resize · double-click to reset"
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}
