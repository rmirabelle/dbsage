import { memo, useEffect, useId, useLayoutEffect, type RefObject } from "react";

interface Props {
  text: string;
  matches: number[];
  queryLength: number;
  activeIndex: number;
  className: string;
  backdropRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

/** Paint matches on one text node instead of mounting a DOM node per match. */
export const InspectorTextBackdrop = memo(function InspectorTextBackdrop({ text, matches, queryLength, activeIndex, className, backdropRef, textareaRef }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const allName = `inspector-all-${id}`;
  const activeName = `inspector-active-${id}`;

  useEffect(() => {
    const node = backdropRef.current?.firstChild;
    if (!node || !matches.length || typeof Highlight === "undefined") return;
    const highlight = new Highlight();
    CSS.highlights.set(allName, highlight);
    let next = 0;
    let timer: ReturnType<typeof setTimeout>;
    /** Yield between batches so broad, one-letter searches cannot monopolize input. */
    const addBatch = () => {
      const end = Math.min(next + 500, matches.length);
      for (; next < end; next++) {
        const range = new Range();
        range.setStart(node, matches[next]);
        range.setEnd(node, matches[next] + queryLength);
        highlight.add(range);
      }
      if (next < matches.length) timer = setTimeout(addBatch, 0);
    };
    timer = setTimeout(addBatch, 0);
    return () => { clearTimeout(timer); CSS.highlights.delete(allName); };
  }, [text, matches, queryLength, allName, backdropRef]);

  useLayoutEffect(() => {
    const backdrop = backdropRef.current;
    const textarea = textareaRef.current;
    const node = backdrop?.firstChild;
    const offset = matches[activeIndex];
    if (!node || !backdrop || !textarea || offset === undefined) return;
    const range = new Range();
    range.setStart(node, offset);
    range.setEnd(node, offset + queryLength);
    if (typeof Highlight !== "undefined") {
      const active = new Highlight(range);
      active.priority = 1;
      CSS.highlights.set(activeName, active);
    }
    const rect = backdrop.getBoundingClientRect();
    const zoom = backdrop.offsetHeight ? rect.height / backdrop.offsetHeight : 1;
    textarea.scrollTop = Math.max(0, backdrop.scrollTop + (range.getBoundingClientRect().top - rect.top) / (zoom || 1) - 8);
    backdrop.scrollTop = textarea.scrollTop;
    return () => { if (typeof Highlight !== "undefined") CSS.highlights.delete(activeName); };
  }, [text, matches, queryLength, activeIndex, activeName, backdropRef, textareaRef]);

  return <>
    <style>{`::highlight(${allName}) { background-color: #a3e635; color: black; }
      ::highlight(${activeName}) { background-color: #a3e635; color: black; text-decoration: underline 2px black; }`}</style>
    <div ref={backdropRef} aria-hidden="true" className={className}>{text}</div>
  </>;
});
