import { helpHandlers } from "../state/help";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  ArrowDown,
  X,
  FunnelSimpleX,
  CircleNotch,
  LockSimple,
  ShareNetwork,
  CalendarBlank,
  ArrowsOutSimple,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { DateTimePicker, dateModeFor, type DateMode } from "./DateTimePicker";
import { COMPARE_OPS } from "../types";
import { validateJsonShow } from "../lib/jsonPath";
import { JsonShowEditorDialog } from "./JsonShowEditorDialog";
import { useAnchoredPosition } from "../lib/useAnchoredPosition";
import type {
  ColumnFilter,
  FilterOp,
  SortDirection,
  SortSpec,
  SuggestResult,
} from "../types";

const COMPARE_OP_SET = new Set<FilterOp>(["gt", "gte", "lt", "lte"]);

interface Props {
  column: string;
  columnType: string;
  anchor: { x: number; y: number };
  currentSort: SortSpec | null;
  currentFilter: ColumnFilter | null;
  currentJsonShow: string | null;
  previewRows?: Record<string, unknown>[];
  previewRowIndex?: number;
  sampleJsonProperties?: (arrayProperty?: string, selectorProperty?: string) => Promise<string[]>;
  onClose: () => void;
  onSort: (direction: SortDirection | null) => void;
  onFilter: (filter: ColumnFilter | null) => void;
  onJsonShow: (path: string | null) => void;
  /** Fetches distinct column values starting with `prefix` for the Equals
   * auto-suggest. Absent = no suggestions (result grids, unsupported types). */
  suggest?: (prefix: string) => Promise<SuggestResult>;
  /** The filter on this column is fixed by the host (a peek panel's row
   * match) and can't be changed or cleared here; the menu says so instead of
   * showing the filter controls. Sort and JSON display still work. */
  locked?: boolean;
}

const MENU_WIDTH = 380;
/** Most suggestions fetched; the list shows as many as fit the window. */
const SUGGEST_LIMIT = 50;
const SUGGEST_DEBOUNCE_MS = 250;

export function ColumnHeaderMenu({
  column,
  columnType,
  anchor,
  currentSort,
  currentFilter,
  currentJsonShow,
  previewRows = [],
  previewRowIndex = 0,
  sampleJsonProperties,
  onClose,
  onSort,
  onFilter: applyFilter,
  onJsonShow,
  suggest,
  locked = false,
}: Props) {
  const isJson = columnType.trim().toLowerCase() === "json";
  const supportsTextPatterns = /^(?:char|varchar|tinytext|text|mediumtext|longtext|enum|set)\b/i.test(columnType.trim());
  /* DATE / DATETIME / TIMESTAMP columns get a calendar picker on the Equals
     and comparison inputs. */
  const dateMode = dateModeFor(columnType);
  const sortedHere =
    currentSort && currentSort.column === column ? currentSort.direction : null;

  const curOp = currentFilter?.op ?? null;
  const eqActive = curOp === "equals" || curOp === "ne";
  const likeActive = curOp === "like" || curOp === "notlike";
  const nullActive = curOp === "isnull" || curOp === "notnull";
  const compareActive = !!curOp && COMPARE_OP_SET.has(curOp);

  /* The combined toggles share one value input per pair, so prefill from
     whichever variant is the active filter. */
  const [eqOp, setEqOp] = useState<FilterOp>(eqActive ? curOp! : "equals");
  const [eqValue, setEqValue] = useState(eqActive ? currentFilter!.value : "");
  const [likeOp, setLikeOp] = useState<FilterOp>(likeActive ? curOp! : "like");
  const [likeValue, setLikeValue] = useState(
    likeActive ? currentFilter!.value : ""
  );
  const [compareOp, setCompareOp] = useState<FilterOp>(
    compareActive ? curOp! : "gt"
  );
  const [compareValue, setCompareValue] = useState(
    compareActive ? currentFilter!.value : ""
  );
  const [jsonPath, setJsonPath] = useState(currentFilter?.jsonPath ?? "");
  const [showPath, setShowPath] = useState(currentJsonShow ?? "");
  const [showEditor, setShowEditor] = useState(false);
  const showError = validateJsonShow(showPath);
  const ref = useRef<HTMLDivElement>(null);
  const { style: menuPosition } = useAnchoredPosition(anchor.x, anchor.y, 8, ref);

  /** One applied filter per column, including while a picker keeps the menu
   * open. Clear other groups' drafts so they cannot still look selected. */
  const onFilter = (filter: ColumnFilter | null) => {
    const op = filter?.op;
    setEqValue(op === "equals" || op === "ne" ? filter!.value : "");
    setLikeValue(op === "like" || op === "notlike" ? filter!.value : "");
    setCompareValue(op && COMPARE_OP_SET.has(op) ? filter!.value : "");
    applyFilter(filter);
  };

  /** The displayed (extracted) property is independent of the filter property,
   *  and updates the column live as the user types. */
  const onShowChange = (v: string) => {
    setShowPath(v);
    if (!validateJsonShow(v)) onJsonShow(v.trim() ? v.trim() : null);
  };

  const showActive = showPath.trim().length > 0;

  useEffect(() => {
    if (showEditor) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (ref.current.contains(target)) return;
      /**
       * Skip closing when the mousedown is on any column header — the
       * column-header onClick handler is responsible for toggling its own
       * menu, and closing here first would re-open the menu on the upcoming
       * click event.
       */
      if (target.closest("[data-column-header]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, showEditor]);


  /* JSON columns keep the original EQUALS / Contains fields (always op
     "equals"/"like" with a path); non-JSON columns use the combined toggles. */
  const commitEqJson = () => {
    const v = eqValue.trim();
    const path = jsonPath.trim();
    onFilter(v && path ? { column, op: "equals", value: v, jsonPath: path } : null);
    onClose();
  };
  const commitLikeJson = () => {
    const v = likeValue.trim();
    const path = jsonPath.trim();
    onFilter(v && path ? { column, op: "like", value: v, jsonPath: path } : null);
    onClose();
  };

  /* Combined-toggle commits (non-JSON). An empty value clears the filter. */
  const commitEquality = (close = true, value = eqValue) => {
    const v = value.trim();
    onFilter(v ? { column, op: eqOp, value: v,
      ...(dateMode && eqOp === "equals" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? { dateOnly: true } : {}),
    } : null);
    if (close) onClose();
  };
  const commitLikeness = () => {
    const v = likeValue.trim();
    onFilter(v ? { column, op: likeOp, value: v } : null);
    onClose();
  };
  const commitNull = (op: FilterOp) => {
    onFilter({ column, op, value: "" });
    onClose();
  };
  const commitCompare = (close = true, value = compareValue) => {
    const v = value.trim();
    onFilter(v ? { column, op: compareOp, value: v } : null);
    if (close) onClose();
  };

  if (showEditor) return <JsonShowEditorDialog
    column={column}
    initialValue={showPath}
    rows={previewRows}
    initialRowIndex={previewRowIndex}
    sampleProperties={sampleJsonProperties}
    onClose={() => setShowEditor(false)}
    onApply={(value) => { onShowChange(value); setShowEditor(false); onClose(); }}
  />;

  return createPortal(
    <div
      ref={ref}
      data-el="column-header-menu"
      style={{ ...menuPosition, width: MENU_WIDTH }}
      className="fixed z-[100] rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm shadow-xl shadow-black/60 text-[12px] text-zinc-200 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {!isJson && (
        <div className="py-1">
          <MenuItem
            icon={<ArrowUp size={15} />}
            active={sortedHere === "asc"}
            onClick={() => {
              onSort("asc");
              onClose();
            }}
          >
            Sort ascending
          </MenuItem>
          <MenuItem
            icon={<ArrowDown size={15} />}
            active={sortedHere === "desc"}
            onClick={() => {
              onSort("desc");
              onClose();
            }}
          >
            Sort descending
          </MenuItem>
          {sortedHere && (
            <MenuItem
              icon={<X size={15} />}
              onClick={() => {
                onSort(null);
                onClose();
              }}
            >
              Clear sort
            </MenuItem>
          )}
        </div>
      )}

      {isJson && (
        <div className="px-3 pt-3 pb-2 space-y-1">
          <div className="flex items-stretch">
            <span
              className={clsx(
                "flex items-center justify-center w-[88px] shrink-0 px-3 text-[11px] uppercase tracking-[0.12em] rounded-l whitespace-nowrap",
                showActive
                  ? "bg-emerald-500 text-black border-2 border-r-0 border-emerald-500"
                  : "bg-zinc-900 text-zinc-400 border border-r-0 border-zinc-700"
              )}
            >
              Show
            </span>
            <input
              type="text"
              data-el="json-show-input"
              aria-label="JSON SHOW expression"
              value={showPath.replace(/[\r\n]+/g, " ")}
              placeholder="path AS Label, another.path"
              onChange={(event) => onShowChange(event.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (showError) return;
                  onShowChange(showPath);
                  onClose();
                }
              }}
              className={clsx(
                "flex-1 min-w-0 bg-zinc-950 rounded-r px-2 py-[7px] text-[12.5px] font-mono text-zinc-100 outline-none focus:border-accent-500",
                showActive ? "border-2 border-emerald-500" : "border border-zinc-700"
              )}
            />
            <button
              type="button"
              data-el="json-show-expand"
              {...helpHandlers("Expand expression editor")}
              aria-label="Expand expression editor"
              onClick={() => setShowEditor(true)}
              className="ml-1 shrink-0 self-start rounded p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            ><ArrowsOutSimple size={16} /></button>
          </div>
          {showError && <p role="alert" className="text-xs text-red-400">{showError}</p>}
          <p className="text-[11px] leading-snug text-zinc-500">
            Dotted path. Use{" "}
            <span className="font-mono text-zinc-400">arr[key=value].field</span>{" "}
            to target a matching element; comma-separate for several. Add AS Label
            to name a value, or + ' ' + to join values.
            {" "}Use <span className="font-mono text-zinc-400">[name LIKE 'eTimes%']</span> for wildcard matching.
          </p>
        </div>
      )}

      {locked ? (
        <div className="border-t border-zinc-800 px-3 py-2.5 flex items-center gap-2 text-[11.5px] text-zinc-400">
          <LockSimple size={14} className="shrink-0 text-violet-400" />
          <span>
            Fixed by this peek:{" "}
            <span className="font-mono text-zinc-200">
              {column} = {String(currentFilter?.value ?? "")}
            </span>
          </span>
        </div>
      ) : (
      <div className="border-t border-zinc-800 px-3 py-2 space-y-1">
        {currentFilter?.relation && (
          <div className="mb-1 flex items-center gap-2 rounded bg-violet-500/15 px-2 py-1.5 text-[11.5px] text-violet-200">
            <ShareNetwork size={14} className="shrink-0 text-violet-300" />
            <span>
              {currentFilter.op === "norelated" ? "No related rows in " : "Has related rows in "}
              <span className="font-mono text-zinc-100">
                {currentFilter.relation.table}
              </span>
            </span>
          </div>
        )}
        {isJson && (
          <div className="flex items-stretch">
            <span className="flex items-center justify-center w-[88px] shrink-0 px-3 text-[11px] uppercase tracking-[0.12em] bg-zinc-900 border border-r-0 rounded-l whitespace-nowrap text-zinc-400 border-zinc-700">
              Property
            </span>
            <input
              data-el="json-path-input"
              value={jsonPath}
              placeholder="key or a.b.c"
              onChange={(e) => setJsonPath(e.target.value)}
              className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded-r px-2 py-1 text-[12.5px] font-mono text-zinc-100 outline-none focus:border-accent-500"
            />
          </div>
        )}
        {isJson ? (
          <>
            <FilterField
              label="EQUALS"
              value={eqValue}
              active={currentFilter?.op === "equals"}
              placeholder={'value · 33, true, "33"'}
              onChange={setEqValue}
              onSubmit={commitEqJson}
              onClear={() => {
                setEqValue("");
                if (currentFilter?.op === "equals") {
                  onFilter(null);
                }
              }}
            />
            <FilterField
              label="Contains"
              value={likeValue}
              active={currentFilter?.op === "like"}
              placeholder="substring"
              onChange={setLikeValue}
              onSubmit={commitLikeJson}
              onClear={() => {
                setLikeValue("");
                if (currentFilter?.op === "like") {
                  onFilter(null);
                }
              }}
            />
          </>
        ) : (
          <>
            <div className="flex">
              <Segmented
                options={[
                  { op: "isnull", label: "Null" },
                  { op: "notnull", label: "Not Null" },
                ]}
                value={nullActive ? currentFilter!.op : ""}
                active={nullActive}
                filled={nullActive}
                onChange={commitNull}
              />
            </div>
            <ToggleField
              options={[
                { op: "equals", label: "Equals" },
                { op: "ne", label: "Not Eq" },
              ]}
              op={eqOp}
              onOp={setEqOp}
              active={eqActive}
              value={eqValue}
              placeholder="value"
              onChange={setEqValue}
              onSubmit={commitEquality}
              onPickerApply={(value) => commitEquality(false, value)}
              onPickerDone={(value) => commitEquality(true, value)}
              onPick={(v) => {
                onFilter({ column, op: eqOp, value: v });
                onClose();
              }}
              suggest={suggest}
              dateMode={dateMode}
              onClear={() => {
                setEqValue("");
                if (eqActive) {
                  onFilter(null);
                }
              }}
            />
            {supportsTextPatterns && <ToggleField
              options={[
                { op: "like", label: "Like" },
                { op: "notlike", label: "Not Like" },
              ]}
              op={likeOp}
              onOp={setLikeOp}
              active={likeActive}
              value={likeValue}
              placeholder="contains"
              onChange={setLikeValue}
              onSubmit={commitLikeness}
              onClear={() => {
                setLikeValue("");
                if (likeActive) {
                  onFilter(null);
                }
              }}
            />}
            <ToggleField
              options={COMPARE_OPS}
              op={compareOp}
              onOp={setCompareOp}
              active={compareActive}
              value={compareValue}
              placeholder="value"
              onChange={setCompareValue}
              onSubmit={commitCompare}
              onPickerApply={(value) => commitCompare(false, value)}
              onPickerDone={(value) => commitCompare(true, value)}
              dateMode={dateMode}
              onClear={() => {
                setCompareValue("");
                if (compareActive) {
                  onFilter(null);
                }
              }}
            />
          </>
        )}
        {isJson && (
          <p className="text-[11px] leading-snug text-zinc-500">
            Matches any object, including inside arrays. Values are auto-typed —
            wrap in quotes to force text.
          </p>
        )}
        {(currentFilter || (isJson && currentJsonShow)) && (
          <button
            className="w-full inline-flex items-center justify-center gap-1.5 mt-1 px-2 py-1 rounded text-rose-300 hover:bg-rose-500/10"
            onClick={() => {
              onFilter(null);
              if (isJson) onJsonShow(null);
              onClose();
            }}
          >
            <FunnelSimpleX size={15} /> {isJson ? "Clear" : "Clear filter"}
          </button>
        )}
      </div>
      )}
    </div>,
    document.body
  );
}

/** A segmented toggle: mutually-exclusive operator buttons. When `attached`,
 * it squares its right edge to butt against a value input. */
function Segmented({
  options,
  value,
  active,
  filled,
  onChange,
  attached,
}: {
  options: { op: FilterOp; label: string }[];
  value: FilterOp | "";
  /** The row is the applied filter (drives the 2px green outline). */
  active: boolean;
  /** The selected op has a value committed/typed (green vs. just toggled). */
  filled: boolean;
  onChange: (op: FilterOp) => void;
  attached?: boolean;
}) {
  return (
    <div
      className={clsx(
        /* Fixed total width so every toggle group lines up, regardless of how
           many buttons it has or how wide each label is. */
        "flex w-[160px] shrink-0",
        attached ? "rounded-l" : "rounded",
        active ? "border-2 border-emerald-500" : "border border-zinc-700",
        attached && "border-r-0"
      )}
    >
      {options.map((o, i) => {
        const selected = value === o.op;
        return (
          <button
            key={o.op}
            data-el={`filter-op-${o.op}`}
            onClick={() => onChange(o.op)}
            className={clsx(
              "flex-1 min-w-0 px-1 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap transition-colors",
              i > 0 && "border-l border-zinc-700",
              selected
                ? filled
                  ? "bg-emerald-500 text-black"
                  : "bg-zinc-700 text-zinc-200"
                : "text-zinc-400 hover:bg-zinc-800"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A combined operator toggle (left) paired with a value input (right). */
function ToggleField({
  options,
  op,
  onOp,
  active,
  value,
  placeholder,
  onChange,
  onSubmit,
  onPickerApply,
  onPickerDone,
  onClear,
  onPick,
  suggest,
  dateMode = null,
}: {
  options: { op: FilterOp; label: string }[];
  op: FilterOp;
  onOp: (op: FilterOp) => void;
  active: boolean;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onPickerApply?: (value: string) => void;
  /** Picker OK: commit the value and let the menu close. */
  onPickerDone?: (value: string) => void;
  onClear: () => void;
  /** Called with a chosen suggestion; the caller commits it as the filter. */
  onPick?: (v: string) => void;
  suggest?: (prefix: string) => Promise<SuggestResult>;
  /** Temporal columns open the picker from the input or calendar button. */
  dateMode?: DateMode | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const sug = useSuggestions(dateMode ? undefined : suggest, value);
  const [pickerOpen, setPickerOpen] = useState(false);
  const togglePicker = () => {
    sug.dismiss();
    setPickerOpen((o) => !o);
  };

  /* Let the list run to the bottom of the window (it scrolls past that). */
  const [listMaxHeight, setListMaxHeight] = useState<number>();
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    setListMaxHeight(Math.max(60, window.innerHeight - top - 8));
  }, [sug.visible, sug.values]);

  /* Keep the keyboard-highlighted row visible while the list scrolls. */
  useEffect(() => {
    if (sug.highlighted < 0) return;
    listRef.current?.children[sug.highlighted]?.scrollIntoView({
      block: "nearest",
    });
  }, [sug.highlighted]);

  const pick = (v: string) => {
    sug.dismiss();
    onChange(v);
    onPick?.(v);
  };

  return (
    <div className="relative">
      <div className="flex items-stretch">
        <Segmented
          options={options}
          value={op}
          active={active}
          filled={value.trim().length > 0}
          onChange={onOp}
          attached
        />
        <div className="relative flex-1">
          <input
            ref={inputRef}
            data-el="column-filter-input"
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => { if (!dateMode) sug.open(); }}
            onBlur={() => sug.dismiss()}
            onClick={() => {
              if (dateMode) {
                sug.dismiss();
                setPickerOpen(true);
              }
            }}
            onKeyDown={(e) => {
              if (sug.visible) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  sug.move(1);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  sug.move(-1);
                  return;
                }
                if (e.key === "Escape") {
                  /* Close just the list; a second Escape closes the menu. */
                  e.preventDefault();
                  e.stopPropagation();
                  sug.dismiss();
                  return;
                }
                if (e.key === "Enter" && sug.highlighted >= 0) {
                  e.preventDefault();
                  pick(sug.values[sug.highlighted]);
                  return;
                }
              }
              if (e.key === "Enter") {
                e.preventDefault();
                sug.dismiss();
                onSubmit();
              }
            }}
            className={clsx(
              "w-full bg-zinc-950 rounded-r pl-2 py-1 text-[12.5px] font-mono text-zinc-100 outline-none focus:border-accent-500",
              dateMode ? (value ? "pr-12" : "pr-7") : value ? "pr-6" : "pr-2",
              active ? "border-2 border-emerald-500" : "border border-zinc-700"
            )}
          />
          {dateMode && (
            <button
              data-el="column-filter-calendar"
              onMouseDown={(e) => e.preventDefault()}
              onClick={togglePicker}
              className={clsx(
                "absolute top-1/2 -translate-y-1/2 rounded p-0.5 transition-colors",
                value ? "right-6" : "right-1.5",
                pickerOpen
                  ? "bg-accent-500/20 text-accent-300"
                  : "text-zinc-500 hover:text-accent-300"
              )}
              aria-label="Pick a date"
              {...helpHandlers(dateMode === "date" ? "Pick a date" : "Pick a date and time")}
            >
              <CalendarBlank size={15} />
            </button>
          )}
          {sug.loading && !dateMode && (
            <CircleNotch
              size={13}
              className={clsx(
                "absolute top-1/2 -translate-y-1/2 text-zinc-500 animate-spin pointer-events-none",
                value ? "right-6" : "right-2"
              )}
            />
          )}
          {value && (
            <button
              onClick={() => {
                onClear();
                inputRef.current?.focus();
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
              aria-label="Clear"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      {pickerOpen && dateMode && (
        <DateTimePicker
          value={value}
          mode={dateMode}
          optionalTime={op === "equals" || COMPARE_OP_SET.has(op)}
          dateOnlyLabel={op === "equals" ? "Entire day" : "Midnight"}
          onChange={onChange}
          onApply={onPickerApply ?? onSubmit}
          onDone={onPickerDone ?? onSubmit}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {sug.visible && !dateMode && !pickerOpen && (
        <ul
          ref={listRef}
          data-el="column-filter-suggestions"
          style={{ maxHeight: listMaxHeight }}
          className="absolute left-[160px] right-0 top-full mt-0.5 z-10 overflow-y-auto rounded border border-zinc-700 bg-zinc-900 shadow-lg shadow-black/50 py-0.5"
        >
          {sug.values.map((v, i) => (
            <li
              key={v}

              /* mousedown, not click, so the pick lands before the input
                 loses focus. */
              onMouseDown={(e) => {
                e.preventDefault();
                pick(v);
              }}
              className={clsx(
                "px-2 py-[3px] font-mono text-[12px] truncate cursor-pointer",
                i === sug.highlighted
                  ? "bg-accent-500/20 text-accent-200"
                  : "text-zinc-300 hover:bg-zinc-800"
              )}
              {...helpHandlers(v, { onMouseEnter: () => sug.highlight(i) })}
            >
              {v}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Debounced value suggestions for a filter input. Fetches while the input is
 *  focused, drops stale responses, and stops asking once the backend reports
 *  the column is skipped (table too large for an unindexed scan). */
function useSuggestions(
  suggest: ((prefix: string) => Promise<SuggestResult>) | undefined,
  value: string
) {
  const [values, setValues] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [openFlag, setOpenFlag] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const skippedRef = useRef(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!suggest || !openFlag || skippedRef.current) return;
    const prefix = value.trim();
    const id = ++requestRef.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      suggest(prefix)
        .then((res) => {
          if (id !== requestRef.current) return;
          if (res.skipped) {
            skippedRef.current = true;
            setValues([]);
            return;
          }
          /* Hide the list when the only match is exactly what was typed. */
          const vals =
            res.values.length === 1 && res.values[0] === prefix ? [] : res.values;
          setValues(vals.slice(0, SUGGEST_LIMIT));
          setHighlighted(-1);
        })
        .catch(() => {
          if (id === requestRef.current) setValues([]);
        })
        .finally(() => {
          if (id === requestRef.current) setLoading(false);
        });
    }, SUGGEST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [suggest, value, openFlag]);

  const dismiss = () => {
    requestRef.current += 1;
    setOpenFlag(false);
    setLoading(false);
    setValues([]);
    setHighlighted(-1);
  };

  const move = (delta: number) => {
    if (values.length === 0) return;
    setHighlighted((h) => {
      const n = h + delta;
      if (n < 0) return values.length - 1;
      if (n >= values.length) return 0;
      return n;
    });
  };

  return {
    values,
    loading,
    visible: openFlag && values.length > 0,
    highlighted,
    open: () => setOpenFlag(true),
    dismiss,
    move,
    highlight: setHighlighted,
  };
}

function MenuItem({
  icon,
  active,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full text-left px-3 py-1.5 inline-flex items-center gap-2 hover:bg-zinc-800",
        active && "text-accent-300 bg-accent-500/10"
      )}
    >
      <span className={clsx(active ? "text-accent-300" : "text-zinc-500")}>
        {icon}
      </span>
      {children}
    </button>
  );
}

function FilterField({
  label,
  value,
  active,
  placeholder,
  onChange,
  onSubmit,
  onClear,
}: {
  label: string;
  value: string;
  active: boolean;
  placeholder: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="flex items-stretch">
        <span
          className={clsx(
            "flex items-center justify-center w-[88px] shrink-0 px-3 text-[11px] uppercase tracking-[0.12em] rounded-l whitespace-nowrap",
            active
              ? "bg-emerald-500 text-black border-2 border-r-0 border-emerald-500"
              : "bg-zinc-900 text-zinc-400 border border-r-0 border-zinc-700"
          )}
        >
          {label}
        </span>
        <div className="relative flex-1">
          <input
            ref={inputRef}
            data-el="column-filter-input"
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit();
              }
            }}
            className={clsx(
              "w-full bg-zinc-950 rounded-r pl-2 pr-6 py-1 text-[12.5px] font-mono text-zinc-100 outline-none focus:border-accent-500",
              active ? "border-2 border-emerald-500" : "border border-zinc-700"
            )}
          />
          {value && (
            <button
              onClick={() => {
                onClear();
                inputRef.current?.focus();
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
              aria-label="Clear"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
