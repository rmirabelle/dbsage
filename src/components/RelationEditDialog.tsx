import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CircleNotch,
  FloppyDisk,
  ShareNetwork,
  Trash,
  X,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { ipc } from "../ipc";
import {
  BLANK_RELATION,
  formFromRelation,
  withFromColumn,
  withSuggestedToColumn,
  withToTable,
} from "../lib/relationForm";
import { useBackdropDismiss } from "../lib/useBackdropDismiss";
import { useStore } from "../state/store";
import { SearchableSelect } from "./SearchableSelect";
import type { Relation, RelationKind } from "../types";

/**
 * Shared modal editor for a single relation. Context-menu creation seeds it
 * from the clicked table/column; Relations view opens the same dialog unseeded.
 */
export function RelationEditDialog({
  profileId,
  database,
  relation,
  from,
  onClose,
  onSaved,
  onDeleted,
}: {
  profileId: string;
  database: string;
  /** The relation being edited, or null to author a new one. */
  relation: Relation | null;
  /** Optional clicked cell — seeds the FROM side of context-menu creation. */
  from?: { table: string; column: string };
  onClose: () => void;
  /** Fired after a successful save (the host closes and refreshes). */
  onSaved: () => void;
  /** Fired after the relation is deleted — same handling as a save. */
  onDeleted: () => void;
}) {
  const saveRelation = useStore((s) => s.saveRelation);
  const deleteRelation = useStore((s) => s.deleteRelation);

  const [form, setForm] = useState(() =>
    relation
      ? formFromRelation(relation)
      : {
          ...BLANK_RELATION,
          fromTable: from?.table ?? "",
          fromColumn: from?.column ?? "",
        }
  );
  const [tables, setTables] = useState<string[]>([]);
  const [fromColumns, setFromColumns] = useState<string[]>([]);
  const [toColumns, setToColumns] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = saving || deleting;

  const sortedTables = useMemo(() => [...tables].sort(), [tables]);
  const backdrop = useBackdropDismiss(onClose, !busy);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  useEffect(() => {
    ipc
      .listTables(profileId, database)
      .then((ts) => setTables(ts.map((t) => t.name)))
      .catch((e) => setError(String(e)));
  }, [profileId, database]);

  /**
   * Guess the rest of a NEW relation from the clicked column once the table
   * list is known (the guess checks that the target table exists). Runs once —
   * a ref, not a dependency list, since the form it seeds is also the thing the
   * user then edits.
   */
  const seededRef = useRef(relation != null || !from?.column);
  useEffect(() => {
    if (seededRef.current || tables.length === 0) return;
    seededRef.current = true;
    setForm((f) => withFromColumn(f, f.fromColumn, tables));
  }, [tables]);

  useEffect(() => {
    if (!form.fromTable) {
      setFromColumns([]);
      return;
    }
    ipc
      .listColumns(profileId, database, form.fromTable)
      .then((cols) => setFromColumns(cols.map((c) => c.name)))
      .catch(() => setFromColumns([]));
  }, [form.fromTable, profileId, database]);

  useEffect(() => {
    if (!form.toTable) {
      setToColumns([]);
      return;
    }
    ipc
      .listColumns(profileId, database, form.toTable)
      .then((cols) => setToColumns(cols.map((c) => c.name)))
      .catch(() => setToColumns([]));
  }, [form.toTable, profileId, database]);

  /** Suggest/validate the to-column once the target table's columns land. */
  useEffect(() => {
    setForm((f) => withSuggestedToColumn(f, toColumns));
  }, [toColumns, form.kind, form.fromTable]);

  const canSave =
    !!form.fromTable && !!form.fromColumn && !!form.toTable && !!form.toColumn;

  /**
   * Delete the relation being edited. No confirmation — a relation is app-level
   * metadata, nothing in the database changes, and re-authoring it is the same
   * few clicks that made it. Matches the Relations tab's per-row delete.
   */
  const onDelete = async () => {
    if (!relation || busy) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteRelation(profileId, database, relation.id);
      onDeleted();
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleting(false);
    }
  };

  const onSave = async () => {
    if (!canSave || busy) return;
    setSaving(true);
    setError(null);
    try {
      await saveRelation({
        profileId,
        database,
        id: form.editingId,
        fromTable: form.fromTable,
        fromColumn: form.fromColumn,
        toTable: form.toTable,
        toColumn: form.toColumn,
        kind: form.kind,
        name: form.name.trim(),
      });
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const selectClass =
    "bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-accent-500 disabled:opacity-50";

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        data-el="relation-edit-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] max-w-[92vw] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <ShareNetwork size={18} weight="bold" className="text-violet-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              {relation ? "Edit Relation" : "New Relation"}
            </h2>
          </div>
          <button
            data-el="relation-dialog-close"
            onClick={onClose}
            disabled={busy}
            className="text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-4">
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-[12px] text-zinc-400">
            <span className="text-right">From</span>
            <div className="flex items-center gap-2">
              <SearchableSelect
                dataEl="rel-dlg-from-table"
                value={form.fromTable}
                options={sortedTables}
                placeholder="table…"
                onChange={(v) =>
                  setForm((f) =>
                    v === f.fromTable ? f : { ...BLANK_RELATION, fromTable: v }
                  )
                }
                className="flex-1"
              />
              <SearchableSelect
                dataEl="rel-dlg-from-column"
                value={form.fromColumn}
                options={fromColumns}
                placeholder="column…"
                disabled={!form.fromTable}
                onChange={(v) =>
                  setForm((f) =>
                    v === f.fromColumn ? f : withFromColumn(f, v, tables)
                  )
                }
                className="flex-1"
              />
            </div>

            <span className="text-right">Type</span>
            <select
              data-el="rel-dlg-kind"
              value={form.kind}
              onChange={(e) => {
                const kind = e.target.value as RelationKind;
                setForm((f) => withToTable({ ...f, kind }, f.toTable));
              }}
              className={clsx(selectClass, "w-40")}
            >
              <option value="has_one">has one</option>
              <option value="has_many">has many</option>
            </select>

            <span className="text-right">To</span>
            <div className="flex items-center gap-2">
              <SearchableSelect
                dataEl="rel-dlg-to-table"
                value={form.toTable}
                options={sortedTables}
                placeholder="table…"
                onChange={(v) =>
                  setForm((f) => (v === f.toTable ? f : withToTable(f, v)))
                }
                className="flex-1"
              />
              <SearchableSelect
                dataEl="rel-dlg-to-column"
                value={form.toColumn}
                options={toColumns}
                placeholder="column…"
                disabled={!form.toTable}
                onChange={(v) => setForm((f) => ({ ...f, toColumn: v }))}
                className="flex-1"
              />
            </div>

            <span className="text-right">Label</span>
            <input
              data-el="rel-dlg-name"
              value={form.name}
              onChange={(e) =>
                setForm((f) => ({ ...f, name: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                e.preventDefault();
                void onSave();
              }}
              placeholder="optional relation label"
              className={clsx(selectClass, "w-full")}
            />
          </div>

          {error && (
            <div className="mt-3 rounded bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-[11px] text-rose-300 break-words">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded text-[12px] text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
          >
            Cancel
          </button>
          {relation && (
            <button
              data-el="relation-dialog-delete"
              onClick={onDelete}
              disabled={busy}
              className="mr-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-rose-900 text-rose-100 hover:bg-rose-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {deleting ? (
                <CircleNotch size={14} className="animate-spin" />
              ) : (
                <Trash size={14} />
              )}
              Delete Relation
            </button>
          )}
          <button
            data-el="relation-dialog-save"
            onClick={onSave}
            disabled={!canSave || busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 transition-colors disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
          >
            {saving ? (
              <CircleNotch size={14} className="animate-spin" />
            ) : (
              <FloppyDisk size={14} />
            )}
            Save Relation
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
