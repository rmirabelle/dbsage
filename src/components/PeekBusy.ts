import { createContext } from "react";

/** True while any peek above this one is replacing its rows (or has fresh
 * rows but no selected row yet). Lower peeks veil their stale rows until their
 * own fresh rows arrive. */
export const PeekBusy = createContext(false);
