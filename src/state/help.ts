import { create } from "zustand";

interface HelpState {
  /** Help text for the currently-hovered item, shown in the app help strip. */
  help: string | null;
  setHelp: (help: string | null) => void;
}

/**
 * Tiny app-wide store backing the help strip at the bottom of the connection
 * sidebar. Any component (the tree, the DB view, …) can publish help by hovering
 * an item; the strip renders whatever is current. A store rather than context so
 * unrelated, non-nested components can feed the same strip.
 */
export const useHelp = create<HelpState>((set) => ({
  help: null,
  setHelp: (help) => set({ help }),
}));

/**
 * Hover handlers that show `text` in the help strip and clear it on leave.
 * Spread onto any element that should explain itself, in place of a `title`.
 * A plain helper (not a hook), so it's safe inside render loops.
 */
export const helpHandlers = (text: string) => ({
  onMouseEnter: () => useHelp.getState().setHelp(text),
  onMouseLeave: () => useHelp.getState().setHelp(null),
});
