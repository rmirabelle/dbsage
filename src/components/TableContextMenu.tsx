import { createPortal } from "react-dom";
import {
  PencilSimple,
  TextT,
  Eraser,
  Trash,
  FileCode,
  CaretRight,
  Table,
  Database,
} from "@phosphor-icons/react";
import clsx from "clsx";

/** Right-click menu for a table (shared by the DB view tiles and the tree). */
export function TableContextMenu({
  x,
  y,
  onTruncate,
  onDelete,
  onEdit,
  onRename,
  onSaveSql,
}: {
  x: number;
  y: number;
  onTruncate: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onRename: () => void;
  /** Save a `.sql` script; `includeData` adds INSERTs that restore the rows. */
  onSaveSql: (includeData: boolean) => void;
}) {
  const itemClass =
    "flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-zinc-800";
  return createPortal(
    <div
      data-el="table-context-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
      className="dbs-context-menu fixed z-50 min-w-[180px] rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60"
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

      <div className="group relative">
        <button
          data-el="ctx-save-sql"
          className={clsx(itemClass, "text-zinc-200")}
        >
          <FileCode size={14} className="text-sky-400 shrink-0" />
          <span className="flex-1">Save SQL Script (*.sql)</span>
          <CaretRight size={12} className="shrink-0 opacity-70" />
        </button>
        <div className="absolute left-full top-0 -ml-px hidden min-w-[230px] group-hover:block pl-1">
          <div className="dbs-context-menu rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60">
            <button
              data-el="ctx-save-sql-create"
              className={clsx(itemClass, "text-zinc-200")}
              onClick={() => onSaveSql(false)}
            >
              <Table size={14} className="text-emerald-400 shrink-0" />
              Create Table
            </button>
            <button
              data-el="ctx-save-sql-create-data"
              className={clsx(itemClass, "text-zinc-200")}
              onClick={() => onSaveSql(true)}
            >
              <Database size={14} className="text-emerald-400 shrink-0" />
              Create Table and Restore Data
            </button>
          </div>
        </div>
      </div>

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
