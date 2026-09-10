import { helpHandlers } from "../state/help";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight, Check } from "@phosphor-icons/react";
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
  optionalTime = false,
  dateOnlyLabel = "Date only",
  onChange,
  onApply,
  onDone,
  onClose,
}: {
  value: string;
  mode: DateMode;
  optionalTime?: boolean;
  dateOnlyLabel?: string;
  onChange: (v: string) => void;
  onApply: (value: string) => void;
  /** OK (auto mode) commits the value for good; the host may close itself. */
  onDone?: (value: string) => void;
  onClose: () => void;
}) {
  const initial = parse(value) ?? nowParts();
  const [parts, setParts] = useState<Parts>(initial);
  const [autoApply, setAutoApply] = useState(true);
  const [includeTime, setIncludeTime] = useState(!optionalTime || /[ T]\d{1,2}:\d{2}/.test(value));
  const timeEnabled = !optionalTime || includeTime;
  const outputMode = mode === "datetime" && timeEnabled ? "datetime" : "date";
  /* The month on display, independent of the selected day. */
  const [view, setView] = useState({ y: initial.y, m: initial.m });
  const [calendarView, setCalendarView] = useState<"days" | "months" | "years">("days");
  const [yearStart, setYearStart] = useState(Math.max(1000, Math.min(9988, initial.y - 5)));
  const navigateCalendar = (direction: number) => {
    if (calendarView === "days") shiftMonth(direction);
    else if (calendarView === "months") setView((v) => ({ ...v, y: Math.max(1000, Math.min(9999, v.y + direction)) }));
    else setYearStart((year) => Math.max(1000, Math.min(9988, year + direction * 12)));
  };
  const ref = useRef<HTMLDivElement>(null);
  const appliedValue = useRef(value);
  const apply = () => {
    appliedValue.current = value;
    onApply(value);
  };
  /** Pass the new value directly; the host input has not rerendered yet. */
  const changeValue = (next: string) => {
    onChange(next);
    if (autoApply) {
      appliedValue.current = next;
      onApply(next);
    }
  };
  const cancel = () => {
    onChange(appliedValue.current);
    onClose();
  };
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  /** Keep the picker inside the viewport without detaching it from its menu.
   * Recalculate for months with different week counts and window resizing. */
  useLayoutEffect(() => {
    const picker = ref.current;
    const anchor = picker?.offsetParent;
    if (!picker || !(anchor instanceof HTMLElement)) return;
    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      const width = picker.getBoundingClientRect().width;
      const inputLeft = anchor.querySelector("input")?.getBoundingClientRect().left ?? rect.left;
      const left = Math.max(8, Math.min(inputLeft, window.innerWidth - width - 8)) - rect.left;
      const maxHeight = Math.max(0, window.innerHeight - 16);
      const height = Math.min(picker.scrollHeight + 2, maxHeight);
      let top = rect.bottom + 2;
      if (top + height > window.innerHeight - 8) top = rect.top - height - 2;
      top = Math.max(8, Math.min(top, window.innerHeight - height - 8)) - rect.top;
      setPosition((previous) => previous?.top === top && previous.left === left && previous.maxHeight === maxHeight
        ? previous : { top, left, maxHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(picker);
    observer.observe(anchor);
    let frame = 0;
    const reposition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [view.y, view.m, mode, includeTime, calendarView]);

  const update = (patch: Partial<Parts>) => {
    const next = { ...parts, ...patch };
    next.d = Math.min(next.d, daysInMonth(next.y, next.m));
    setParts(next);
    changeValue(format(next, outputMode));
  };

  /* Write the initial value into the input right away when it was empty or
     unparsable, so opening the picker never leaves the two out of step. */
  useEffect(() => {
    if (!parse(value)) onChange(format(initial, outputMode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancel();
      }
    };
    const el = ref.current;
    el?.addEventListener("keydown", onKey);
    return () => el?.removeEventListener("keydown", onKey);
  }, [onClose, onChange]);

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
          apply();
        }
      }}
      className="w-8 rounded bg-zinc-950 border border-zinc-700 px-1 py-0.5 text-center font-mono text-[12px] text-zinc-100 outline-none focus:border-accent-500"
    />
  );

  return (
    <div
      ref={ref}
      data-el="datetime-picker"
      style={position ?? undefined}
      className="absolute left-[160px] top-full w-[280px] max-w-[calc(100vw-16px)] z-20 overflow-y-auto rounded border border-zinc-500 bg-zinc-900 p-3 shadow-lg shadow-black/50 select-none"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-1">
        <button
          onClick={() => navigateCalendar(-1)}
          className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label={calendarView === "days" ? "Previous month" : calendarView === "months" ? "Previous year" : "Previous years"}
        >
          <CaretLeft size={14} weight="bold" />
        </button>
        {calendarView === "years" ? <span className="text-[12px] font-semibold text-zinc-100">
          {yearStart}–{yearStart + 11}
        </span> : <button type="button"
          onClick={() => {
            if (calendarView === "days") setCalendarView("months");
            else {
              setYearStart(Math.max(1000, Math.min(9988, view.y - 5)));
              setCalendarView("years");
            }
          }}
          aria-label={calendarView === "days" ? "Choose month" : "Choose year"}
          {...helpHandlers(calendarView === "days" ? "Choose a month" : "Choose a year")}
          className="rounded px-2 py-0.5 text-[12px] font-semibold text-zinc-100 hover:bg-zinc-800">
          {calendarView === "days" ? `${MONTHS[view.m - 1]} ${view.y}` : view.y}
        </button>}
        <button
          onClick={() => navigateCalendar(1)}
          className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label={calendarView === "days" ? "Next month" : calendarView === "months" ? "Next year" : "Next years"}
        >
          <CaretRight size={14} weight="bold" />
        </button>
      </div>
      {calendarView === "years" && <ul aria-label="Choose year" className="grid grid-cols-3 gap-1">
        {Array.from({ length: 12 }, (_, i) => yearStart + i).map((year) => <li key={year}>
          <button type="button" aria-pressed={year === view.y}
            onClick={() => { setView((v) => ({ ...v, y: year })); setCalendarView("months"); }}
            className={clsx("w-full rounded py-2 text-[12px] tabular-nums", year === view.y
              ? "bg-accent-500 text-[#042f2e] font-semibold" : "text-zinc-200 hover:bg-zinc-800")}>
            {year}
          </button>
        </li>)}
      </ul>}
      {calendarView === "months" && <div aria-label="Choose month" className="grid grid-cols-3 gap-1">
        {MONTHS.map((month, i) => <button key={month} type="button" aria-label={month} aria-pressed={i + 1 === view.m}
          onClick={() => { setView((v) => ({ ...v, m: i + 1 })); setCalendarView("days"); }}
          className={clsx("rounded py-2 text-[12px]", i + 1 === view.m
            ? "bg-accent-500 text-[#042f2e] font-semibold" : "text-zinc-200 hover:bg-zinc-800")}>
          {month.slice(0, 3)}
        </button>)}
      </div>}
      {calendarView === "days" && <div className="grid grid-cols-7 gap-px text-center">
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
              onDoubleClick={() => { if (!autoApply) apply(); }}
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
      </div>}
      {mode === "datetime" && optionalTime && <label className="mt-2 flex items-center gap-2 text-[11px] text-zinc-300">
        <input type="checkbox" checked={includeTime}
          onChange={(event) => {
            setIncludeTime(event.target.checked);
            changeValue(format(parts, event.target.checked ? "datetime" : "date"));
          }} />
        Include time
        {!includeTime && <span className="text-zinc-500">{dateOnlyLabel}</span>}
      </label>}
      {mode === "datetime" && timeEnabled && (
        <div className="mt-2 text-[11px] text-zinc-400">
          <div className="flex items-center gap-1">
          <span className="mr-1 uppercase tracking-wide text-[10px] text-zinc-500">Time</span>
          {timeField("h", 23)}
          <span className="text-zinc-600">:</span>
          {timeField("mi", 59)}
          <span className="text-zinc-600">:</span>
          {timeField("s", 59)}
          </div>
          <div className="mt-1 flex items-center justify-end gap-1">
          <button
            onClick={() => update({ h: 0, mi: 0, s: 0 })}
            className="rounded px-1.5 py-0.5 hover:bg-zinc-800 hover:text-zinc-100"
            {...helpHandlers("Start of day")}
          >
            00:00
          </button>
          <button
            onClick={() => update({ h: 23, mi: 59, s: 59 })}
            className="rounded px-1.5 py-0.5 hover:bg-zinc-800 hover:text-zinc-100"
            {...helpHandlers("End of day")}
          >
            23:59
          </button>
          </div>
        </div>
      )}
      <div data-el="datetime-picker-footer" className="mt-2 -mx-3 -mb-3 flex items-center gap-1 border-t border-zinc-800 bg-zinc-950 px-1.5 py-1">
        <button
          type="button"
          data-el="datetime-cancel"
          onClick={cancel}
          className="rounded bg-zinc-800 px-2 py-1 text-[11px] font-semibold text-zinc-300 hover:bg-zinc-700"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            const n = nowParts();
            setView({ y: n.y, m: n.m });
            setCalendarView("days");
            update(mode === "date" ? { y: n.y, m: n.m, d: n.d } : n);
          }}
          className="ml-auto rounded px-2 py-1 text-[11px] font-semibold text-zinc-200 bg-zinc-800 hover:bg-zinc-700"
        >
          {outputMode === "date" ? "Today" : "Now"}
        </button>
        <label className="flex items-center gap-1 px-1 text-[10px] text-zinc-500 hover:text-zinc-400"
          {...helpHandlers("Automatically apply date and time changes while keeping the picker open")}>
          <span className="relative inline-flex h-3 w-3 shrink-0">
            <input type="checkbox" data-el="datetime-auto-apply" checked={autoApply}
              className="peer h-3 w-3 appearance-none rounded-sm border border-zinc-600 bg-zinc-900 focus-visible:outline focus-visible:outline-1 focus-visible:outline-zinc-300"
              onChange={(event) => setAutoApply(event.target.checked)} />
            <Check size={10} weight="bold" aria-hidden="true"
              className="pointer-events-none absolute left-px top-px hidden text-zinc-200 peer-checked:block" />
          </span>
          Auto
        </label>
        <button
          type="button"
          data-el="datetime-apply"
          onClick={() => {
            if (autoApply && onDone) {
              appliedValue.current = value;
              onDone(value);
              return;
            }
            apply();
            if (autoApply) onClose();
          }}
          className="rounded px-3 py-1 text-[11px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400"
        >
          {autoApply ? "OK" : "Apply"}
        </button>
      </div>
    </div>
  );
}
