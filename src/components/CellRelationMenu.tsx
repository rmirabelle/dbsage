import { useEffect } from "react";
import { createPortal } from "react-dom";
import { PencilSimple, Plus } from "@phosphor-icons/react";
import { useAnchoredPosition } from "../lib/useAnchoredPosition";
import { useStore } from "../state/store";
import { relationsFor } from "../lib/relations";
import type { Relation } from "../types";

/**
 * Right-click menu for a grid cell: edit the relation(s) already defined on the
 * cell's column, or author a new one seeded from it. Reads relations from the
 * store itself so it always reflects the latest save.
 */
export function CellRelationMenu({
  x,
  y,
  profileId,
  database,
  table,
  column,
  onEdit,
  onNew,
  onClose,
}: {
  x: number;
  y: number;
  profileId: string;
  database: string;
  table: string;
  column: string;
  /** Open the dialog on an existing relation. */
  onEdit: (relation: Relation) => void;
  /** Open the dialog on a new relation seeded from this cell. */
  onNew: () => void;
  onClose: () => void;
}) {
  const all = useStore((s) => s.relations[`${profileId}::${database}`]);
  const existing = relationsFor(all ?? [], table, column);
  const multiple = existing.length > 1;

  useEffect(() => {
    const onDown = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const { ref, style } = useAnchoredPosition(x, y);
  const itemClass =
    "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] whitespace-nowrap text-zinc-200 hover:bg-zinc-800";

  return createPortal(
    <div
      ref={ref}
      data-el="cell-relation-menu"
      style={style}
      onMouseDown={(e) => e.stopPropagation()}
      className="dbs-context-menu fixed z-50 w-max min-w-[180px] rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60"
    >
      <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
        {table}.{column}
      </div>
      {existing.map((r) => (
        <button
          key={r.id}
          data-el="cell-edit-relation"
          className={itemClass}
          onClick={() => {
            onClose();
            onEdit(r);
          }}
        >
          <PencilSimple size={16} className="text-violet-400 shrink-0" />
          <span className="flex-1">Edit Relation</span>
          {/* Which one, when the column carries more than a single relation. */}
          {multiple && (
            <span className="font-mono text-[11px] text-zinc-500">
              {r.toTable}.{r.toColumn}
            </span>
          )}
        </button>
      ))}
      {/* Always offered: a column can carry more than one relation, so having
          some already is no reason to hide the way to add another. */}
      {existing.length > 0 && (
        <div className="my-1 border-t border-zinc-800" />
      )}
      <button
        data-el="cell-new-relation"
        className={itemClass}
        onClick={() => {
          onClose();
          onNew();
        }}
      >
        <Plus size={16} weight="bold" className="text-violet-400 shrink-0" />
        New Relation
      </button>
    </div>,
    document.body
  );
}
