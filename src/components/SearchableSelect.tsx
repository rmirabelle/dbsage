import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

interface Props {
  value: string;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  dataEl?: string;
  className?: string;
  onChange: (value: string) => void;
  /** Each time this changes to a truthy value, the input is focused. Lets a
   * parent imperatively focus the field (e.g. when opening an editor) without
   * a ref, even when the component stays mounted. */
  focusSignal?: number;
}

/**
 * Searchable select: choose from `options` (rendered in the given order, so
 * callers can rank/"bubble" matches later). Opening shows the full list
 * (scrollable) with the current value pre-highlighted; typing filters it.
 * Selection is constrained to the options — typed text that doesn't match an
 * option is discarded on close. The dropdown is portaled to <body> so it
 * escapes scroll-container clipping and the tabs pane's CSS zoom.
 */
export function SearchableSelect({
  value,
  options,
  placeholder,
  disabled,
  dataEl,
  className,
  onChange,
  focusSignal,
}: Props) {
  const [text, setText] = useState(value);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setText(value), [value]);

  useEffect(() => {
    if (focusSignal) inputRef.current?.focus();
  }, [focusSignal]);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    const list =
      searching && q
        ? options.filter((o) => o.toLowerCase().includes(q))
        : options;
    return list.slice(0, 200);
  }, [text, searching, options]);

  const openMenu = () => {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect());
    setSearching(false);
    const idx = options.indexOf(value);
    setHighlight(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  /** Close without committing; revert the field to the selected value. */
  const close = () => {
    setOpen(false);
    setSearching(false);
    setText(value);
  };

  /**
   * Close on blur: if the typed text exactly matches an option (case-
   * insensitive), commit it so the user isn't forced to press Enter; otherwise
   * revert like a plain close.
   */
  const commitOnBlur = () => {
    const q = text.trim().toLowerCase();
    const exact = options.find((o) => o.toLowerCase() === q);
    if (exact && exact !== value) {
      select(exact);
    } else {
      close();
    }
  };

  const select = (v: string) => {
    setOpen(false);
    setSearching(false);
    setText(v);
    onChange(v);
  };

  useEffect(() => {
    if (!open) return;
    // Close when the page/pane scrolls (the dropdown is fixed-positioned), but
    // NOT when scrolling within the dropdown itself.
    const onScroll = (e: Event) => {
      if (
        menuRef.current &&
        e.target instanceof Node &&
        menuRef.current.contains(e.target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <div className={className}>
      <input
        ref={inputRef}
        data-el={dataEl}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onMouseDown={() => {
          if (!open) openMenu();
        }}
        onFocus={() => {
          openMenu();
          inputRef.current?.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          setSearching(true);
          setHighlight(0);
        }}
        onBlur={commitOnBlur}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) openMenu();
            else setHighlight((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && filtered[highlight] !== undefined) {
              select(filtered[highlight]);
            } else {
              setOpen(false);
            }
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
        className="w-full cursor-pointer bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-accent-500 disabled:opacity-50"
      />
      {open &&
        rect &&
        filtered.length > 0 &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[80] max-h-60 overflow-auto rounded border border-zinc-700 bg-zinc-900 shadow-xl shadow-black/60 py-1"
            style={{ left: rect.left, top: rect.bottom + 2, width: rect.width }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {filtered.map((o, i) => (
              <button
                key={o}
                ref={
                  i === highlight
                    ? (el) => el?.scrollIntoView({ block: "nearest" })
                    : undefined
                }
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(o);
                }}
                className={clsx(
                  "block w-full text-left px-2 py-1 text-[12px] font-mono hover:bg-zinc-800",
                  i === highlight
                    ? "bg-accent-500/20 text-accent-100"
                    : o === value
                    ? "text-accent-300"
                    : "text-zinc-300"
                )}
              >
                {o}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
