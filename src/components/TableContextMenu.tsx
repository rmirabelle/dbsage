import { createPortal } from "react-dom";
import { PencilSimple, TextT, Eraser, Trash } from "@phosphor-icons/react";
import clsx from "clsx";

/** Right-click menu for a table (shared by the DB view tiles and the tree). */
export function TableContextMenu({
  x,
  y,
  onTruncate,
  onDelete,
  onEdit,
  onRename,
}: {
  x: number;
  y: number;
  onTruncate: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onRename: () => void;
}) {
  const itemClass =
    "flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-zinc-800";
  return createPortal(
    <div
      data-el="table-context-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
      className="dbs-context-menu fixed z-50 min-w-[170px] rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60"
    >
      <button
        data-el="ctx-edit-table"
        className={clsx(itemClass, "text-zinc-200")}
        onClick={onEdit}
      >
        <PencilSimple size={14} className="text-accent-400 shrink-0" />
        Edit Table
      </button>
      <button
        data-el="ctx-rename-table"
        className={clsx(itemClass, "text-zinc-200")}
        onClick={onRename}
      >
        <TextT size={14} className="text-accent-400 shrink-0" />
        Rename Table
      </button>
      <div className="my-1 border-t border-zinc-800" />
      <button
        data-el="ctx-truncate-table"
        className={clsx(itemClass, "text-zinc-200")}
        onClick={onTruncate}
      >
        <Eraser size={14} className="text-amber-400 shrink-0" />
        Truncate Table
      </button>
      <button
        data-el="ctx-delete-table"
        className={clsx(itemClass, "text-rose-400")}
        onClick={onDelete}
      >
        <Trash size={14} className="shrink-0" />
        Delete Table
      </button>
    </div>,
    document.body
  );
}
