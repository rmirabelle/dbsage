import { useEffect, useRef, useState } from "react";
import clsx from "clsx";

/**
 * A textarea that renders as a single line when blurred (overflow clipped with
 * an ellipsis) and grows to fit its full content while focused. Used for the
 * column Comment field and the JSON "Show" path field.
 */
export function AutoGrowTextarea({
  value,
  onChange,
  className,
  placeholder,
  dataEl,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  dataEl?: string;
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
      el.style.height = `${el.scrollHeight + border}px`;
    } else {
      /* Collapsed: a single line (the `min-h-8` class height), overflow clipped. */
      el.style.height = "";
    }
  }, [value, focused]);

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
        "min-h-8 resize-none overflow-hidden",
        !focused && "whitespace-nowrap text-ellipsis"
      )}
    />
  );
}
