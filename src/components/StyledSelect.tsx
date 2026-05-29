import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CaretDown } from "@phosphor-icons/react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

export interface SelectOption {
  value: string;
  label: string;
  /** Optional leading icon shown before the label in the menu row. */
  icon?: ReactNode;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  title?: string;
  disabled?: boolean;
  dataEl?: string;
  /** Optional leading icon rendered inside the trigger, before the label. */
  icon?: ReactNode;
  /** Extra classes for the trigger button (width, font-weight, text color, …).
   * Merged over the defaults so a text-color here wins. */
  className?: string;
  /** Extra classes for the popup menu container (e.g. font-size — the option
   * buttons inherit it, since the global rule pins their own font-size). */
  menuClassName?: string;
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
  icon,
  className,
  menuClassName,
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
        className={twMerge(
          "inline-flex items-center justify-between gap-1.5 rounded pl-2 pr-1.5 py-1 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors focus:outline-none focus:ring-1 focus:ring-accent-500 disabled:opacity-50",
          className
        )}
      >
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {icon}
          <span className="truncate">{current?.label ?? ""}</span>
        </span>
        <CaretDown size={12} className="shrink-0 opacity-80" />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            className={twMerge(
              "fixed z-[60] max-h-72 overflow-auto rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm shadow-xl shadow-black/60 py-1 text-[12px]",
              menuClassName
            )}
            style={{
              left: rect.left,
              top: rect.bottom + 4,
              minWidth: Math.max(rect.width, 220),
            }}
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
                  "flex w-full items-center gap-2 text-left px-3 py-2 whitespace-nowrap hover:bg-zinc-800",
                  i === highlight && "bg-zinc-800",
                  o.value === value
                    ? "text-accent-300 font-semibold"
                    : "text-zinc-200"
                )}
              >
                {o.icon}
                {o.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
