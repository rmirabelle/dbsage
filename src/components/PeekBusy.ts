import { createContext } from "react";

/** Set while any peek above this one is replacing its rows, or has fresh rows
 * but no selected row yet. The value is the veil label lower peeks show over
 * their stale rows ("Loading related rows…" or "Select a row in <table>");
 * null means nothing above is busy. */
export const PeekBusy = createContext<string | null>(null);
