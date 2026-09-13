import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretLeft, CaretRight, X } from "@phosphor-icons/react";
import { compactDisplay, extractJsonDisplay, extractJsonShowParts, validateJsonShow } from "../lib/jsonPath";
import { matchingRootProperties, matchingSelectorValues, jsonPropertyCompletion, rootJsonProperties } from "../lib/jsonPropertySuggestions";

interface Props {
  column: string;
  initialValue: string;
  rows: Record<string, unknown>[];
  initialRowIndex: number;
  sampleProperties?: (arrayProperty?: string, selectorProperty?: string) => Promise<string[]>;
  onApply: (value: string) => void;
  onClose: () => void;
}

const EXPRESSION_EXAMPLES = [
  { action: "Extract a value", expression: "first_name", description: "Display the document’s first_name property." },
  { action: "Search a root array", expression: "[prop=x].prop2", description: "Find items in a root array whose prop equals x; display each matching item’s prop2." },
  { action: "Search a named array", expression: "things[prop=x].prop2", description: "Find items in the things array whose prop equals x; display each matching item’s prop2." },
  { action: "Add an alias", expression: "prop AS test", description: "Display the value as test: {prop value}." },
  { action: "Join values", expression: "first + ' ' + last AS Name", description: "Join first and last with a space, displayed as Name: Jane Smith." },
  { action: "First item", expression: "items[0].date", description: "Display the date of the first item in items. Array indices start at zero." },
  { action: "First match", expression: "[category=favorites][0].name", description: "Find the first item in a root array whose category equals favorites; display its name." },
  { action: "Match a pattern", expression: "items[name LIKE 'report%'].name", description: "Display names from items that start with report." },
  { action: "Exclude a pattern", expression: "items[name NOT LIKE 'report%'].name", description: "Display names from items that do not start with report." },
  { action: "Quote an alias", expression: 'first AS "Name, First"', description: "Put aliases containing commas in quotes so they remain one label." },
];

/** Native modal supplies focus trapping and isolates the editor from the grid. */
export function JsonShowEditorDialog({ column, initialValue, rows, initialRowIndex, sampleProperties, onApply, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [draft, setDraft] = useState(initialValue);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sampler = useRef(sampleProperties);
  const arraySamples = useRef(new Map<string, Promise<string[]>>());
  const [keys, setKeys] = useState(() => rootJsonProperties(rows, column));
  const [sampleStatus, setSampleStatus] = useState(sampleProperties ? "Sampling properties…" : "Suggestions from up to 100 loaded rows.");
  const [caret, setCaret] = useState(initialValue.length);
  const [suggestOpen, setSuggestOpen] = useState(false);
  /**
   * Root-level property names only appear on Ctrl+Space, so a space typed in
   * "first name" never opens a list. Inside items[...] suggestions stay automatic.
   */
  const [manualOpen, setManualOpen] = useState(false);
  const [choice, setChoice] = useState(0);
  const [suggestions, setSuggestions] = useState<{ text: string; caret: number; values: string[] } | null>(null);
  const options = suggestOpen && suggestions?.text === draft && suggestions.caret === caret ? suggestions.values : [];

  useEffect(() => {
    if (!sampler.current) return;
    let cancelled = false;
    void sampler.current().then((sample) => {
      if (cancelled) return;
      setKeys((local) => [...new Set([...local, ...sample])]);
      setSampleStatus("Root properties from up to 100 sampled rows plus loaded rows; properties may vary by row.");
    }).catch(() => {
      if (!cancelled) setSampleStatus("Table sample unavailable; suggestions use loaded rows.");
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!suggestOpen) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const completion = jsonPropertyCompletion(draft, caret);
      let properties = keys;
      if (completion?.arrayProperty !== undefined) {
        const property = completion.arrayProperty;
        properties = rootJsonProperties(rows, column, property, completion.selectorProperty);
        const cacheKey = JSON.stringify([property, completion.selectorProperty]);
        if (sampler.current) {
          let sample = arraySamples.current.get(cacheKey);
          if (!sample) {
            sample = sampler.current(property, completion.selectorProperty).catch(() => []);
            arraySamples.current.set(cacheKey, sample);
          }
          properties = [...new Set([...properties, ...await sample])];
        }
      }
      if (cancelled) return;
      const rootContext = completion?.arrayProperty === undefined;
      const wanted = completion && (!rootContext || manualOpen);
      setSuggestions({ text: draft, caret, values: wanted ? (completion.selectorProperty === undefined ? matchingRootProperties : matchingSelectorValues)(properties, completion.prefix) : [] });
      setChoice(0);
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [draft, caret, keys, suggestOpen, manualOpen, rows, column]);

  const acceptProperty = (property: string) => {
    const completion = jsonPropertyCompletion(draft, caret);
    if (!completion) return;
    const next = draft.slice(0, completion.start) + property + draft.slice(completion.end);
    const position = completion.start + property.length;
    setDraft(next);
    setCaret(position);
    setSuggestOpen(false);
    setManualOpen(false);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(position, position); setSuggestOpen(false); });
  };
  const [rowIndex, setRowIndex] = useState(Math.max(0, Math.min(initialRowIndex, rows.length - 1)));
  const error = validateJsonShow(draft);
  const row = rows[rowIndex];
  const value = row?.[column];
  const parts = error || !row || !draft.trim() ? null : extractJsonShowParts(value, draft);
  const display = error || !row ? undefined : draft.trim() ? extractJsonDisplay(value, draft) : value;

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      data-el="json-show-editor-dialog"
      aria-labelledby="json-show-editor-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          if (!error) onApply(draft);
        }
      }}
      className="m-auto h-[840px] w-[960px] max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)] resize overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 p-0 text-sm text-zinc-200 shadow-2xl backdrop:bg-black/60"
      style={{ minWidth: "min(560px, calc(100vw - 32px))", minHeight: "min(360px, calc(100vh - 32px))" }}
    >
      <div className="flex h-full min-h-0 flex-col">
        <header
          className="flex shrink-0 cursor-move touch-none select-none items-center gap-3 border-b border-zinc-800 px-4 py-3"
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary || (event.target as HTMLElement).closest("button")) return;
            const dialog = dialogRef.current!;
            const rect = dialog.getBoundingClientRect();
            dragRef.current = { pointerId: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
            /** Switch from centered layout to viewport positioning before dragging. */
            Object.assign(dialog.style, { position: "fixed", margin: "0", left: `${rect.left}px`, top: `${rect.top}px`, right: "auto", bottom: "auto" });
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            const dialog = dialogRef.current;
            if (!drag || !dialog || drag.pointerId !== event.pointerId) return;
            const rect = dialog.getBoundingClientRect();
            dialog.style.left = `${Math.max(16, Math.min(window.innerWidth - rect.width - 16, event.clientX - drag.x))}px`;
            dialog.style.top = `${Math.max(16, Math.min(window.innerHeight - rect.height - 16, event.clientY - drag.y))}px`;
          }}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId !== event.pointerId) return;
            dragRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { dragRef.current = null; }}
          onLostPointerCapture={() => { dragRef.current = null; }}
        >
          <div className="min-w-0 flex-1">
            <h2 id="json-show-editor-title" className="font-semibold text-zinc-100">Edit JSON display</h2>
            <p className="truncate text-xs text-zinc-400">{column} · Changes apply when you choose Apply.</p>
          </div>
          <button type="button" aria-label="Close editor" onClick={onClose} className="rounded p-1 hover:bg-zinc-800"><X size={18} /></button>
        </header>
        <div className="grid h-48 max-h-[28%] min-h-28 shrink-0 grid-cols-[3fr_2fr] grid-rows-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 pt-4 pb-2">
            <label htmlFor="json-show-expression" className="col-start-1 row-start-1 self-center text-xs font-semibold text-zinc-300">Expressions</label>
            <div className="relative col-start-1 row-start-2 min-h-0 min-w-0">
            <textarea
              ref={inputRef}
              id="json-show-expression"
              data-el="json-show-expression"
              autoFocus
              spellCheck={false}
              value={draft}
              onChange={(event) => { setDraft(event.target.value); setCaret(event.target.selectionStart); setSuggestOpen(true); }}
              onSelect={(event) => { setCaret(event.currentTarget.selectionStart); if (event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) setSuggestOpen(false); }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => { setSuggestOpen(false); setManualOpen(false); }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if ((event.ctrlKey || event.metaKey) && event.key === " ") {
                  event.preventDefault(); event.stopPropagation();
                  setCaret(event.currentTarget.selectionStart);
                  setManualOpen(true); setSuggestOpen(true);
                  return;
                }
                if (event.key === "Escape" && suggestOpen) { event.preventDefault(); event.stopPropagation(); setSuggestOpen(false); setManualOpen(false); return; }
                if (!options.length || event.ctrlKey || event.metaKey || event.altKey) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault(); event.stopPropagation();
                  setChoice((index) => (index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
                } else if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
                  event.preventDefault(); event.stopPropagation(); acceptProperty(options[choice] ?? options[0]);
                }
              }}
              aria-autocomplete="list"
              aria-controls={options.length ? "json-property-suggestions" : undefined}
              aria-activedescendant={options.length ? `json-property-${choice}` : undefined}
              aria-invalid={!!error}
              aria-describedby="json-show-expression-status json-show-expression-help"
              placeholder="first_name AS First Name"
              className="col-start-1 row-start-2 h-full min-h-0 w-full min-w-0 resize-none rounded border border-zinc-700 bg-zinc-950 p-3 font-mono text-[13px] leading-6 text-zinc-100 outline-none focus:border-accent-500"
            />
            {options.length > 0 && <ul id="json-property-suggestions" role="listbox" aria-label="JSON suggestions"
              className="absolute top-full left-0 right-0 z-20 max-h-48 overflow-auto rounded border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
              {options.map((property, index) => <li key={property} id={`json-property-${index}`} role="option" aria-selected={choice === index}
                ref={(element) => { if (choice === index) element?.scrollIntoView({ block: "nearest" }); }}
                onMouseDown={(event) => { event.preventDefault(); acceptProperty(property); }}
                onMouseEnter={() => setChoice(index)}
                className={`cursor-pointer px-3 py-1 font-mono text-xs ${choice === index ? "bg-accent-500/20 text-accent-200" : "text-zinc-300"}`}>
                {property}
              </li>)}
            </ul>}
            </div>
            <div className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center justify-between gap-1 text-xs">
              <span className="font-semibold text-zinc-300">Preview</span>
              <div className="flex items-center gap-1">
                <button type="button" aria-label="Previous preview row" disabled={rowIndex <= 0 || !row} onClick={() => setRowIndex((i) => i - 1)} className="rounded p-1 hover:bg-zinc-800 disabled:opacity-30"><CaretLeft size={14} /></button>
                <span className="text-zinc-400">{row ? `Row ${rowIndex + 1} of ${rows.length}` : "No rows"}</span>
                <button type="button" aria-label="Next preview row" disabled={rowIndex >= rows.length - 1 || !row} onClick={() => setRowIndex((i) => i + 1)} className="rounded p-1 hover:bg-zinc-800 disabled:opacity-30"><CaretRight size={14} /></button>
              </div>
            </div>
            <div data-el="json-show-preview" className="col-start-2 row-start-2 h-full min-h-0 min-w-0 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-3 text-[13px]">
              {error ? <p className="text-zinc-500">Fix the expression to see a preview.</p>
                : !row ? <p className="text-zinc-500">No loaded rows to preview. You can still edit and apply expressions.</p>
                : parts ? <div className="space-y-3">{parts.map((part, index) => <div key={index} className="break-words whitespace-pre-wrap"><span className="text-zinc-500">{part.label}: </span>{part.value || <span className="italic text-zinc-600">Empty</span>}</div>)}</div>
                : display === undefined ? <p className="text-zinc-500">No value found in this row.</p>
                : <div className="break-words whitespace-pre-wrap">{compactDisplay(display) || <span className="italic text-zinc-600">Empty</span>}</div>}
            </div>
        </div>
        <div id="json-show-expression-status" role="status" className={`shrink-0 px-4 pb-3 text-xs ${error ? "text-red-400" : "text-zinc-400"}`}>
          {error ?? (draft.trim() ? "Valid expressions" : "Empty SHOW displays the original JSON.")}
        </div>
        <div id="json-show-expression-help" className="min-h-0 flex-1 overflow-auto border-t border-zinc-800 px-4 py-3 text-xs leading-5 text-zinc-400">
          <h3 className="mb-1 font-semibold text-zinc-200">Expression guide</h3>
          <p className="mb-3">Separate expressions with commas. Use newlines to spread a long expression across several lines.</p>
          <p className="mb-3">{sampleStatus} Press Ctrl+Space to list property names; inside items[…] suggestions appear as you type. Use ↑/↓ to choose a suggestion, Enter or Tab to insert, and Escape to dismiss. In items[prop=value], property names come from the first array item; after =, suggestions come from that property's values across up to 1,000 items per sampled array.</p>
          <table className="w-full table-fixed text-left">
            <colgroup><col className="w-[18%]" /><col className="w-[32%]" /><col className="w-[50%]" /></colgroup>
            <thead>
              <tr className="border-b border-zinc-700 text-zinc-300">
                <th scope="col" className="pr-3 pb-2 font-semibold">Expression</th>
                <th scope="col" className="pr-3 pb-2 font-semibold">Example</th>
                <th scope="col" className="pb-2 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {EXPRESSION_EXAMPLES.map(({ action, expression, description }) => <tr key={expression} className="border-b border-zinc-800/60 align-top">
                <th scope="row" className="py-1.5 pr-3 font-normal text-zinc-300">{action}</th>
                <td className="py-1.5 pr-3"><code className="break-words text-zinc-200">{expression}</code></td>
                <td className="py-1.5 text-zinc-400">{description}</td>
              </tr>)}
            </tbody>
          </table>
          <p className="mt-3 border-t border-zinc-800 pt-2">LIKE and NOT LIKE are case-sensitive. <code className="text-zinc-200">%</code> matches zero or more characters; <code className="text-zinc-200">_</code> matches exactly one. Use <code className="text-zinc-200">{"\\%"}</code> or <code className="text-zinc-200">{"\\_"}</code> for literal wildcards.</p>
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 hover:bg-zinc-800">Cancel</button>
          <button type="button" data-el="json-show-apply" disabled={!!error} onClick={() => onApply(draft)} className="rounded bg-accent-500 px-3 py-1.5 font-semibold text-zinc-950 hover:bg-accent-400 disabled:opacity-40">Apply</button>
        </footer>
      </div>
    </dialog>, document.body
  );
}
