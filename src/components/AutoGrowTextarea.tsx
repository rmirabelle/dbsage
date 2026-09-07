import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

/**
 * A textarea that renders as a single line when blurred (overflow clipped with
 * an ellipsis) and grows while focused, scrolling at an optional height cap. Used for the
 * column Comment field and the JSON "Show" path field.
 */
export function AutoGrowTextarea({
  value,
  onChange,
  className,
  placeholder,
  dataEl,
  onKeyDown,
  maxHeight,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  dataEl?: string;
  maxHeight?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (focused) {
      /* While editing, grow to fit the full content. */
      el.style.height = "auto";
      const border = el.offsetHeight - el.clientHeight;
      el.style.height = `${Math.min(el.scrollHeight + border, maxHeight ?? Infinity)}px`;
    } else {
      /* Collapsed: a single line (the `min-h-8` class height), overflow clipped. */
      el.style.height = "";
    }
  }, [value, focused, maxHeight]);

  return (
    <textarea
      data-el={dataEl}
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className={clsx(
        className,
        "min-h-8 resize-none",
        focused && maxHeight ? "overflow-y-auto" : "overflow-hidden",
        !focused && "whitespace-nowrap text-ellipsis"
      )}
    />
  );
}
