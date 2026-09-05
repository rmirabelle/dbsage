import { useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import clsx from "clsx";

/** Picker precision: whole days (DATE columns) or seconds (DATETIME/TIMESTAMP). */
export type DateMode = "date" | "datetime";

/** The picker mode for a MySQL column type, or null for non-temporal columns. */
export function dateModeFor(columnType: string): DateMode | null {
  const t = columnType.trim().toLowerCase();
  if (t.startsWith("datetime") || t.startsWith("timestamp")) return "datetime";
  if (t.startsWith("date")) return "date";
  return null;
}

interface Parts {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  mi: number;
  s: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

const format = (p: Parts, mode: DateMode) =>
  mode === "date"
    ? `${p.y}-${pad(p.m)}-${pad(p.d)}`
    : `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;

/** Parse `YYYY-MM-DD[ HH:MM[:SS]]` (also `T` separators); null if unparsable. */
function parse(value: string): Parts | null {
  const m = value
    .trim()
    .match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!m) return null;
  const p: Parts = {
    y: +m[1],
    m: +m[2],
    d: +m[3],
    h: m[4] ? +m[4] : 0,
    mi: m[5] ? +m[5] : 0,
    s: m[6] ? +m[6] : 0,
  };
  if (p.m < 1 || p.m > 12 || p.d < 1 || p.d > 31 || p.h > 23 || p.mi > 59 || p.s > 59)
    return null;
  return p;
}

const nowParts = (): Parts => {
  const n = new Date();
  return {
    y: n.getFullYear(),
    m: n.getMonth() + 1,
    d: n.getDate(),
    h: n.getHours(),
    mi: n.getMinutes(),
    s: n.getSeconds(),
  };
};

const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * A themed calendar (+ time) popover for date/datetime filter inputs. Every
 * change writes the formatted value into the host input via `onChange` so the
 * text always shows what will be applied; `onApply` commits it. Escape closes
 * only the picker (the host menu handles its own Escape).
 */
export function DateTimePicker({
  value,
  mode,
  onChange,
  onApply,
  onClose,
}: {
  value: string;
  mode: DateMode;
  onChange: (v: string) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const initial = parse(value) ?? nowParts();
  const [parts, setParts] = useState<Parts>(initial);
  /* The month on display, independent of the selected day. */
  const [view, setView] = useState({ y: initial.y, m: initial.m });
  const ref = useRef<HTMLDivElement>(null);

  const update = (patch: Partial<Parts>) => {
    const next = { ...parts, ...patch };
    next.d = Math.min(next.d, daysInMonth(next.y, next.m));
    setParts(next);
    onChange(format(next, mode));
  };

  /* Write the initial value into the input right away when it was empty or
     unparsable, so opening the picker never leaves the two out of step. */
  useEffect(() => {
    if (!parse(value)) onChange(format(initial, mode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const el = ref.current;
    el?.addEventListener("keydown", onKey);
    return () => el?.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shiftMonth = (delta: number) => {
    setView((v) => {
      const m0 = v.m - 1 + delta;
      const y = v.y + Math.floor(m0 / 12);
      const m = ((m0 % 12) + 12) % 12;
      return { y, m: m + 1 };
    });
  };

  const today = nowParts();
  const firstWeekday = new Date(view.y, view.m - 1, 1).getDay();
  const count = daysInMonth(view.y, view.m);
  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: count }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);

  const timeField = (key: "h" | "mi" | "s", max: number) => (
    <input
      data-el={`datetime-${key}`}
      value={pad(parts[key])}
      inputMode="numeric"
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const n = parseInt(e.target.value.replace(/\D/g, "").slice(-2), 10);
        update({ [key]: Number.isNaN(n) ? 0 : Math.min(max, n) } as Partial<Parts>);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const delta = e.key === "ArrowUp" ? 1 : -1;
          update({ [key]: (parts[key] + delta + max + 1) % (max + 1) } as Partial<Parts>);
        } else if (e.key === "Enter") {
          e.preventDefault();
          onApply();
        }
      }}
      className="w-8 rounded bg-zinc-950 border border-zinc-700 px-1 py-0.5 text-center font-mono text-[12px] text-zinc-100 outline-none focus:border-accent-500"
    />
  );

  return (
    <div
      ref={ref}
      data-el="datetime-picker"
      className="absolute left-[160px] right-0 top-full mt-0.5 z-20 rounded border border-zinc-700 bg-zinc-900 p-2 shadow-lg shadow-black/50 select-none"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-1">
        <button
          onClick={() => shiftMonth(-1)}
          className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Previous month"
        >
          <CaretLeft size={14} weight="bold" />
        </button>
        <span className="text-[12px] font-semibold text-zinc-100">
          {MONTHS[view.m - 1]} {view.y}
        </span>
        <button
          onClick={() => shiftMonth(1)}
          className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Next month"
        >
          <CaretRight size={14} weight="bold" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-px text-center">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
            {w}
          </span>
        ))}
        {cells.map((d, i) =>
          d == null ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              onClick={() => {
                update({ y: view.y, m: view.m, d });
              }}
              onDoubleClick={onApply}
              className={clsx(
                "h-6 rounded text-[12px] tabular-nums",
                parts.y === view.y && parts.m === view.m && parts.d === d
                  ? "bg-accent-500 text-[#042f2e] font-semibold"
                  : today.y === view.y && today.m === view.m && today.d === d
                  ? "text-accent-300 ring-1 ring-inset ring-accent-500/60 hover:bg-zinc-800"
                  : "text-zinc-200 hover:bg-zinc-800"
              )}
            >
              {d}
            </button>
          )
        )}
      </div>
      {mode === "datetime" && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-zinc-400">
          <span className="mr-1 uppercase tracking-wide text-[10px] text-zinc-500">Time</span>
          {timeField("h", 23)}
          <span className="text-zinc-600">:</span>
          {timeField("mi", 59)}
          <span className="text-zinc-600">:</span>
          {timeField("s", 59)}
          <button
            onClick={() => update({ h: 0, mi: 0, s: 0 })}
            className="ml-auto rounded px-1.5 py-0.5 hover:bg-zinc-800 hover:text-zinc-100"
            title="Start of day"
          >
            00:00
          </button>
          <button
            onClick={() => update({ h: 23, mi: 59, s: 59 })}
            className="rounded px-1.5 py-0.5 hover:bg-zinc-800 hover:text-zinc-100"
            title="End of day"
          >
            23:59
          </button>
        </div>
      )}
      <div className="mt-2 flex items-center gap-1">
        <button
          onClick={() => {
            const n = nowParts();
            setView({ y: n.y, m: n.m });
            update(mode === "date" ? { y: n.y, m: n.m, d: n.d } : n);
          }}
          className="rounded px-2 py-1 text-[11px] font-semibold text-zinc-200 bg-zinc-800 hover:bg-zinc-700"
        >
          {mode === "date" ? "Today" : "Now"}
        </button>
        <button
          data-el="datetime-apply"
          onClick={onApply}
          className="ml-auto rounded px-3 py-1 text-[11px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
