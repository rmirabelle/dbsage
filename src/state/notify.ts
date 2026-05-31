import { create } from "zustand";

export type ToastKind = "error" | "success" | "info";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  /** Optional grouping key: a new toast with the same key replaces the prior
   * one, regardless of message text (e.g. "only show the latest query error"). */
  dedupeKey?: string;
}

interface NotifyState {
  toasts: Toast[];
  notify: (kind: ToastKind, message: string, dedupeKey?: string) => string;
  dismiss: (id: string) => void;
}

/** How long each kind stays before auto-dismissing (ms). `0` means it never
 * auto-dismisses — errors ALWAYS stay until the user actively closes them. */
const AUTO_DISMISS: Record<ToastKind, number> = {
  error: 0,
  success: 3500,
  info: 5000,
};

export const useNotify = create<NotifyState>((set, get) => ({
  toasts: [],
  notify: (kind, message, dedupeKey) => {
    const id = crypto.randomUUID();
    /* Collapse a prior toast into this fresh one rather than stacking a
       duplicate. With a dedupeKey, the latest replaces any toast sharing that
       key regardless of text (e.g. successive query errors). Otherwise an
       identical (kind+message) toast is collapsed. Without this, repeating a
       failing action piles up error toasts (which never auto-dismiss), so
       dismissing one leaves others behind — they look like a dismissed error
       "coming back" when the next error appears. */
    set((s) => ({
      toasts: [
        ...s.toasts.filter((t) =>
          dedupeKey != null
            ? t.dedupeKey !== dedupeKey
            : !(t.kind === kind && t.message === message)
        ),
        { id, kind, message, dedupeKey },
      ],
    }));
    const ms = AUTO_DISMISS[kind];
    if (ms > 0) {
      setTimeout(() => get().dismiss(id), ms);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helpers usable anywhere (including non-component code). */
export const notifyError = (message: string, dedupeKey?: string) =>
  useNotify.getState().notify("error", message, dedupeKey);
export const notifySuccess = (message: string, dedupeKey?: string) =>
  useNotify.getState().notify("success", message, dedupeKey);
export const notifyInfo = (message: string, dedupeKey?: string) =>
  useNotify.getState().notify("info", message, dedupeKey);
