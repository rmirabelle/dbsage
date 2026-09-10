import { createContext } from "react";
import type { PeekLocation } from "../lib/peekNavigation";

export const PeekNavigation = createContext<PeekLocation[]>([]);

export function revealPeekRows(container: HTMLElement | null | (() => HTMLElement | null), rowIndex?: number) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const root = typeof container === "function" ? container() : container;
    const grid = root?.querySelector<HTMLElement>('[data-el="data-grid"]');
    grid?.scrollIntoView({ block: "nearest" });
    grid?.focus({ preventScroll: true });
    grid?.dispatchEvent(new CustomEvent("dbsage:reveal-row", { detail: rowIndex }));
  }));
}
