import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown } from "@phosphor-icons/react";
import clsx from "clsx";

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  title?: string;
  disabled?: boolean;
  dataEl?: string;
  /** Extra classes for the trigger button (width, font-weight, etc.). */
  className?: string;
}

/**
 * A styled drop-down replacement for a native `<select>`, so the popup (and its
 * hover highlight) is fully themeable — the native option list isn't. Portaled
 * to <body> to escape scroll-clipping and the tabs pane's CSS zoom.
 */
export function StyledSelect({
  value,
  options,
  onChange,
  title,
  disabled,
  dataEl,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const current = options.find((o) => o.value === value);

  const openMenu = () => {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    const idx = options.findIndex((o) => o.value === value);
    setHighlight(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        !btnRef.current?.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
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
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    btnRef.current?.focus();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-el={dataEl}
        disabled={disabled}
        title={title}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) {
              openMenu();
              return;
            }
            setHighlight((h) =>
              e.key === "ArrowDown"
                ? Math.min(h + 1, options.length - 1)
                : Math.max(h - 1, 0)
            );
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (open && options[highlight]) choose(options[highlight].value);
            else openMenu();
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={clsx(
          "inline-flex items-center justify-between gap-1.5 bg-zinc-900 border border-zinc-800 rounded pl-2 pr-1.5 py-1 text-zinc-200 focus:border-accent-500 disabled:opacity-50",
          className
        )}
      >
        <span className="truncate">{current?.label ?? ""}</span>
        <CaretDown size={12} className="shrink-0 opacity-70" />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[60] max-h-72 overflow-auto rounded border border-zinc-700 bg-zinc-900 shadow-xl shadow-black/60 py-1 text-[12px]"
            style={{ left: rect.left, top: rect.bottom + 2, minWidth: rect.width }}
          >
            {options.map((o, i) => (
              <button
                key={o.value}
                type="button"
                ref={
                  i === highlight
                    ? (el) => el?.scrollIntoView({ block: "nearest" })
                    : undefined
                }
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o.value)}
                className={clsx(
                  "block w-full text-left px-3 py-1.5 whitespace-nowrap hover:bg-zinc-950",
                  i === highlight && "bg-zinc-950",
                  o.value === value
                    ? "text-accent-300 font-semibold"
                    : "text-zinc-200"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
