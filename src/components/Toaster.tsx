import {
  CheckCircle,
  WarningCircle,
  Info,
  X,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { useNotify, type ToastKind } from "../state/notify";

const KIND_STYLE: Record<
  ToastKind,
  { border: string; icon: typeof Info; iconColor: string }
> = {
  error: {
    border: "border-rose-800/70",
    icon: WarningCircle,
    iconColor: "text-rose-400",
  },
  success: {
    border: "border-emerald-800/70",
    icon: CheckCircle,
    iconColor: "text-emerald-400",
  },
  info: {
    border: "border-zinc-700",
    icon: Info,
    iconColor: "text-accent-400",
  },
};

export function Toaster() {
  const toasts = useNotify((s) => s.toasts);
  const dismiss = useNotify((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      data-el="toaster"
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[360px] max-w-[calc(100vw-2rem)]"
    >
      {toasts.map((t) => {
        const style = KIND_STYLE[t.kind];
        const Icon = style.icon;
        return (
          <div
            key={t.id}
            data-el="toast"
            data-kind={t.kind}
            role="alert"
            className={clsx(
              "flex items-start gap-2.5 rounded-lg border bg-zinc-900 px-3.5 py-2.5 shadow-2xl shadow-black/60",
              style.border
            )}
          >
            <Icon size={18} weight="fill" className={clsx("mt-0.5 shrink-0", style.iconColor)} />
            <div className="min-w-0 flex-1 text-[12px] leading-relaxed text-zinc-200 break-words whitespace-pre-wrap">
              {t.message}
            </div>
            <button
              data-el="toast-dismiss"
              onClick={() => dismiss(t.id)}
              className="shrink-0 -mr-1 -mt-0.5 p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
