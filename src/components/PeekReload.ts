import { createContext } from "react";

/** Sum of the Refresh clicks in every Relations panel above a peek. A peek
 * adds it to its fetch dependencies, so a click reloads that panel's peeks and
 * every peek nested under them. */
export const PeekReload = createContext(0);
