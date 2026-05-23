import { create } from "zustand";

export type ToastKind = "error" | "success" | "info";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface NotifyState {
  toasts: Toast[];
  notify: (kind: ToastKind, message: string) => string;
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
  notify: (kind, message) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    const ms = AUTO_DISMISS[kind];
    if (ms > 0) {
      setTimeout(() => get().dismiss(id), ms);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helpers usable anywhere (including non-component code). */
export const notifyError = (message: string) =>
  useNotify.getState().notify("error", message);
export const notifySuccess = (message: string) =>
  useNotify.getState().notify("success", message);
export const notifyInfo = (message: string) =>
  useNotify.getState().notify("info", message);
