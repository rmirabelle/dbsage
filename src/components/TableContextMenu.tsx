import { createPortal } from "react-dom";
import {
  PencilSimple,
  TextT,
  Copy,
  Eraser,
  Trash,
  FileCode,
  CaretRight,
  Table,
  Database,
  BracketsCurly,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { useAnchoredPosition } from "../lib/useAnchoredPosition";

/** Right-click menu for a table (shared by the DB view tiles and the tree). */
export function TableContextMenu({
  x,
  y,
  onTruncate,
  onDelete,
  onEdit,
  onRename,
  onCopy,
  onSaveSql,
  onImportJson,
  count = 1,
}: {
  x: number;
  y: number;
  onTruncate: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onRename: () => void;
  /** Duplicate the table and its data into `{name}_copy`. */
  onCopy: () => void;
  /** Save a `.sql` script; `includeData` adds INSERTs that restore the rows. */
  onSaveSql: (includeData: boolean) => void;
  /** Open the JSON import wizard for this table. */
  onImportJson: () => void;
  /** Number of selected tables the menu acts on. When >1 the single-table-only
   * items (edit/rename/copy/import) are hidden and the rest act on all of them. */
  count?: number;
}) {
  const multi = count > 1;
  const tableWord = multi ? `${count} Tables` : "Table";
  const itemClass =
    "flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-zinc-800";
  const { ref, style } = useAnchoredPosition(x, y);
  return createPortal(
    <div
      ref={ref}
      data-el="table-context-menu"
      style={style}
      onClick={(e) => e.stopPropagation()}
      className="dbs-context-menu fixed z-50 min-w-[180px] rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60"
    >
      {/* Table actions: edit/rename/copy (single only) + truncate/delete. */}
      {!multi && (
        <>
          <button
            data-el="ctx-edit-table"
            className={clsx(itemClass, "text-zinc-200")}
            onClick={onEdit}
          >
            <PencilSimple size={16} className="text-emerald-400 shrink-0" />
            Edit Table
          </button>
          <button
            data-el="ctx-rename-table"
            className={clsx(itemClass, "text-zinc-200")}
            onClick={onRename}
          >
            <TextT size={16} className="text-emerald-400 shrink-0" />
            Rename Table
          </button>
          <button
            data-el="ctx-copy-table"
            className={clsx(itemClass, "text-zinc-200")}
            onClick={onCopy}
          >
            <Copy size={16} className="text-emerald-400 shrink-0" />
            Copy Table
          </button>
        </>
      )}
      <button
        data-el="ctx-truncate-table"
        className={clsx(itemClass, "text-amber-400")}
        onClick={onTruncate}
      >
        <Eraser size={16} className="text-amber-400 shrink-0" />
        Truncate {tableWord}
      </button>
      <button
        data-el="ctx-delete-table"
        className={clsx(itemClass, "text-rose-400")}
        onClick={onDelete}
      >
        <Trash size={16} className="shrink-0" />
        Delete {tableWord}
      </button>

      {!multi && (
        <>
          <div className="my-1 border-t border-zinc-800" />
          <button
            data-el="ctx-import-json"
            className={clsx(itemClass, "text-zinc-200")}
            onClick={onImportJson}
          >
            <BracketsCurly size={16} className="text-emerald-400 shrink-0" />
            Import JSON
          </button>
        </>
      )}

      <div className="my-1 border-t border-zinc-800" />
      <div className="group relative">
        <button
          data-el="ctx-save-sql"
          className={clsx(itemClass, "text-zinc-200")}
        >
          <FileCode size={16} className="text-emerald-400 shrink-0" />
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
              <Table size={16} className="text-emerald-400 shrink-0" />
              Create {tableWord}
            </button>
            <button
              data-el="ctx-save-sql-create-data"
              className={clsx(itemClass, "text-zinc-200")}
              onClick={() => onSaveSql(true)}
            >
              <Database size={16} className="text-emerald-400 shrink-0" />
              Create {tableWord} and Restore Data
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
