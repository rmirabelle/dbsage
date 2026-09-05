import { create } from "zustand";

export type PaneId = "tree" | "tabs";

/** Transient menu shown after dropping table(s) onto a different database. */
export interface TableCopyPrompt {
  profileId: string;
  sourceDb: string;
  tables: string[];
  /** Target connection; differs from `profileId` for a cross-connection copy. */
  targetProfileId: string;
  targetDb: string;
  /** Target connection's display name, shown when it differs from the source. */
  targetConnectionName?: string;
  x: number;
  y: number;
}

interface UiState {
  sidebarWidth: number;
  treeZoom: number;
  tabsZoom: number;
  focusedPane: PaneId;
  expandedPanelHeight: number;
  sqlPaneHeight: number;
  analysisPanelWidth: number;
  relationsPanelWidth: number;
  tableCopyPrompt: TableCopyPrompt | null;

  setSidebarWidth: (px: number) => void;
  setZoom: (pane: PaneId, factor: number) => void;
  bumpZoom: (pane: PaneId, delta: number) => void;
  resetZoom: (pane: PaneId) => void;
  setFocusedPane: (pane: PaneId) => void;
  setExpandedPanelHeight: (px: number) => void;
  setSqlPaneHeight: (px: number) => void;
  setAnalysisPanelWidth: (px: number) => void;
  setRelationsPanelWidth: (px: number) => void;
  openTableCopyPrompt: (prompt: TableCopyPrompt) => void;
  closeTableCopyPrompt: () => void;
}

const KEY = "dbsage.ui.v1";

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 560;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.1;
const PANEL_MIN = 80;
const PANEL_MAX = 1200;
const SQL_PANE_MIN = 80;
const SQL_PANE_MAX = 800;
const ANALYSIS_PANEL_MIN = 360;
const ANALYSIS_PANEL_MAX = 1400;
const RELATIONS_PANEL_MIN = 200;
const RELATIONS_PANEL_MAX = 800;
export const RELATIONS_PANEL_DEFAULT = 300;

interface Persisted {
  sidebarWidth?: number;
  treeZoom?: number;
  tabsZoom?: number;
  expandedPanelHeight?: number;
  sqlPaneHeight?: number;
  analysisPanelWidth?: number;
  relationsPanelWidth?: number;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

const roundZoom = (z: number) => Math.round(z * 100) / 100;

const loadPersisted = (): Persisted => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Persisted;
  } catch {
    return {};
  }
};

const savePersisted = (state: UiState) => {
  try {
    const data: Persisted = {
      sidebarWidth: state.sidebarWidth,
      treeZoom: state.treeZoom,
      tabsZoom: state.tabsZoom,
      expandedPanelHeight: state.expandedPanelHeight,
      sqlPaneHeight: state.sqlPaneHeight,
      analysisPanelWidth: state.analysisPanelWidth,
      relationsPanelWidth: state.relationsPanelWidth,
    };
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* localStorage unavailable; ignore */
  }
};

const persisted = loadPersisted();

export const useUi = create<UiState>((set, get) => ({
  sidebarWidth: clamp(persisted.sidebarWidth ?? 256, SIDEBAR_MIN, SIDEBAR_MAX),
  treeZoom: clamp(persisted.treeZoom ?? 1, ZOOM_MIN, ZOOM_MAX),
  tabsZoom: clamp(persisted.tabsZoom ?? 1, ZOOM_MIN, ZOOM_MAX),
  focusedPane: "tabs",
  expandedPanelHeight: clamp(
    persisted.expandedPanelHeight ?? 240,
    PANEL_MIN,
    PANEL_MAX
  ),
  sqlPaneHeight: clamp(persisted.sqlPaneHeight ?? 200, SQL_PANE_MIN, SQL_PANE_MAX),
  analysisPanelWidth: clamp(
    persisted.analysisPanelWidth ?? 880,
    ANALYSIS_PANEL_MIN,
    ANALYSIS_PANEL_MAX
  ),
  relationsPanelWidth: clamp(
    persisted.relationsPanelWidth ?? RELATIONS_PANEL_DEFAULT,
    RELATIONS_PANEL_MIN,
    RELATIONS_PANEL_MAX
  ),
  tableCopyPrompt: null,

  setSidebarWidth: (px) => {
    set({ sidebarWidth: clamp(Math.round(px), SIDEBAR_MIN, SIDEBAR_MAX) });
    savePersisted(get());
  },

  setZoom: (pane, factor) => {
    const z = roundZoom(clamp(factor, ZOOM_MIN, ZOOM_MAX));
    set(pane === "tree" ? { treeZoom: z } : { tabsZoom: z });
    savePersisted(get());
  },

  bumpZoom: (pane, delta) => {
    const current = pane === "tree" ? get().treeZoom : get().tabsZoom;
    get().setZoom(pane, current + delta);
  },

  resetZoom: (pane) => {
    set(pane === "tree" ? { treeZoom: 1 } : { tabsZoom: 1 });
    savePersisted(get());
  },

  setFocusedPane: (pane) => set({ focusedPane: pane }),

  openTableCopyPrompt: (prompt) => set({ tableCopyPrompt: prompt }),
  closeTableCopyPrompt: () => set({ tableCopyPrompt: null }),

  setExpandedPanelHeight: (px) => {
    set({ expandedPanelHeight: clamp(Math.round(px), PANEL_MIN, PANEL_MAX) });
    savePersisted(get());
  },

  setSqlPaneHeight: (px) => {
    set({ sqlPaneHeight: clamp(Math.round(px), SQL_PANE_MIN, SQL_PANE_MAX) });
    savePersisted(get());
  },

  setAnalysisPanelWidth: (px) => {
    set({
      analysisPanelWidth: clamp(
        Math.round(px),
        ANALYSIS_PANEL_MIN,
        ANALYSIS_PANEL_MAX
      ),
    });
    savePersisted(get());
  },

  setRelationsPanelWidth: (px) => {
    set({
      relationsPanelWidth: clamp(
        Math.round(px),
        RELATIONS_PANEL_MIN,
        RELATIONS_PANEL_MAX
      ),
    });
    savePersisted(get());
  },
}));

/**
 * Live-sync persisted prefs across windows. Every DBSage window (main, peeks,
 * torn-off tabs) has its own store instance over the same localStorage; the
 * `storage` event fires in every OTHER window when one of them persists, so
 * zooming in the main window immediately re-zooms an open peek (and a stale
 * window can't clobber newer prefs with its startup snapshot).
 */
window.addEventListener("storage", (e) => {
  if (e.key !== KEY || !e.newValue) return;
  try {
    const p = JSON.parse(e.newValue) as Persisted;
    useUi.setState({
      ...(p.sidebarWidth != null && {
        sidebarWidth: clamp(p.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX),
      }),
      ...(p.treeZoom != null && {
        treeZoom: clamp(p.treeZoom, ZOOM_MIN, ZOOM_MAX),
      }),
      ...(p.tabsZoom != null && {
        tabsZoom: clamp(p.tabsZoom, ZOOM_MIN, ZOOM_MAX),
      }),
      ...(p.expandedPanelHeight != null && {
        expandedPanelHeight: clamp(p.expandedPanelHeight, PANEL_MIN, PANEL_MAX),
      }),
      ...(p.sqlPaneHeight != null && {
        sqlPaneHeight: clamp(p.sqlPaneHeight, SQL_PANE_MIN, SQL_PANE_MAX),
      }),
      ...(p.analysisPanelWidth != null && {
        analysisPanelWidth: clamp(
          p.analysisPanelWidth,
          ANALYSIS_PANEL_MIN,
          ANALYSIS_PANEL_MAX
        ),
      }),
      ...(p.relationsPanelWidth != null && {
        relationsPanelWidth: clamp(
          p.relationsPanelWidth,
          RELATIONS_PANEL_MIN,
          RELATIONS_PANEL_MAX
        ),
      }),
    });
  } catch {
    /* malformed payload — ignore */
  }
});

export const ZOOM_BOUNDS = { MIN: ZOOM_MIN, MAX: ZOOM_MAX, STEP: ZOOM_STEP };
export const SIDEBAR_BOUNDS = { MIN: SIDEBAR_MIN, MAX: SIDEBAR_MAX };
export const PANEL_BOUNDS = { MIN: PANEL_MIN, MAX: PANEL_MAX };
