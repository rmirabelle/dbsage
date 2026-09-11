import type { IntegratedPeekState, RowRecord, Relation, TableViewSetup, PeekDescriptor } from "../types";

/** Read older saved window layouts as integrated tabs; never reopen OS windows. */
export function restorePresetPeeks(setup: Pick<TableViewSetup, "peekAll" | "peeks">, table: string,
  relations: Relation[], profileId: string, profileName: string, database: string): IntegratedPeekState | null {
  if (setup.peekAll != null) return restoreIntegratedPeek(setup.peekAll, profileId, profileName, database);
  const legacy = (setup.peeks ?? []).flatMap<PeekDescriptor>((peek) => peek.hostedPeeks ?? [peek]);
  const build = (sourceTable: string, ancestors: Set<string>): IntegratedPeekState | null => {
    const peeks: IntegratedPeekState["peeks"] = [];
    for (const old of legacy) {
      if (old.sourceTable !== sourceTable) continue;
      const relation = relations.find((r) => r.fromTable === sourceTable && r.fromColumn === old.sourceColumn
        && r.toTable === old.target.table && r.toColumn === old.target.column && (!old.kind || r.kind === old.kind));
      if (!relation || ancestors.has(relation.id) || peeks.some((p) => p.id === relation.id)) continue;
      const { label: _label, x: _x, y: _y, width: _width, height: _height,
        compactHeight: _compact, fromView: _fromView, hostedPeeks: _hosted, activeHostedPeek: _active, ...view } = old;
      const child = old.childPeekAll ?? build(relation.toTable, new Set([...ancestors, relation.id]));
      peeks.push({ ...view, id: relation.id, title: relation.name?.trim() || relation.toTable,
        profileId, profileName, database, kind: relation.kind, target: { ...old.target, value: null },
        childPeekAll: restoreIntegratedPeek(child, profileId, profileName, database),
        childPeekOpen: old.childPeekOpen ?? Boolean(child),
      });
    }
    return peeks.length ? { height: 240, activeId: peeks[0].id, peeks } : null;
  };
  return build(table, new Set());
}

/** Reconcile open and remembered peeks with edited or deleted relation definitions. */
export function refreshPeekRelations(state: IntegratedPeekState, relations: Relation[]): IntegratedPeekState {
  let changed = false;
  const refresh = (peeks: IntegratedPeekState["peeks"]) => peeks.filter((peek) => {
    const exists = relations.some((r) => r.id === peek.id);
    if (!exists) changed = true;
    return exists;
  }).map((peek) => {
    const relation = relations.find((r) => r.id === peek.id);
    let next = peek;
    if (relation) {
      const title = relation.name?.trim() || relation.toTable;
      if (peek.title !== title || peek.sourceTable !== relation.fromTable || peek.sourceColumn !== relation.fromColumn
        || peek.target.table !== relation.toTable || peek.target.column !== relation.toColumn || peek.kind !== relation.kind) {
        const base = peek.target.table === relation.toTable ? peek : {
          id: peek.id, profileId: peek.profileId, profileName: peek.profileName, database: peek.database,
        };
        next = { ...base, title, sourceTable: relation.fromTable, sourceColumn: relation.fromColumn,
          target: { table: relation.toTable, column: relation.toColumn, value: null }, kind: relation.kind };
      }
    }
    if (next.childPeekAll) {
      const childPeekAll = refreshPeekRelations(next.childPeekAll, relations);
      if (childPeekAll !== next.childPeekAll) next = { ...next, childPeekAll };
    }
    if (next !== peek) changed = true;
    return next;
  });
  const peeks = refresh(state.peeks);
  const hiddenPeeks = state.hiddenPeeks ? refresh(state.hiddenPeeks) : undefined;
  const activeId = peeks.some((peek) => peek.id === state.activeId)
    ? state.activeId
    : peeks[Math.min(Math.max(0, state.peeks.findIndex((peek) => peek.id === state.activeId)), peeks.length - 1)]?.id ?? "";
  return changed || activeId !== state.activeId ? { ...state, peeks, hiddenPeeks, activeId } : state;
}

/** Saved setups follow a server across profiles; bind every level to the current connection. */
export function restoreIntegratedPeek(state: IntegratedPeekState | null | undefined,
  profileId: string, profileName: string, database: string): IntegratedPeekState | null {
  if (!state) return null;
  const restore = (peeks: IntegratedPeekState["peeks"]) => peeks.map((peek) => ({
    ...peek, profileId, profileName, database, target: { ...peek.target, value: null },
    childPeekAll: restoreIntegratedPeek(peek.childPeekAll, profileId, profileName, database),
  }));
  return { ...state, peeks: restore(state.peeks), hiddenPeeks: state.hiddenPeeks ? restore(state.hiddenPeeks) : undefined };
}

function rememberPeeks(...groups: IntegratedPeekState["peeks"][]) {
  return [...new Map(groups.flat().map((peek) => [peek.id, peek])).values()];
}

/** Relation clicks toggle membership; tab clicks only change the active tab. */
export function toggleIntegratedPeek(state: IntegratedPeekState, peek: IntegratedPeekState["peeks"][number]): IntegratedPeekState {
  const index = state.peeks.findIndex((p) => p.id === peek.id);
  if (index < 0) {
    const remembered = state.hiddenPeeks?.find((p) => p.id === peek.id);
    const reopened = { relationsSolo: state.solo ?? false, ...remembered, ...peek };
    const hiddenPeeks = (state.hiddenPeeks ?? []).filter((p) => p.id !== peek.id);
    return { ...state, hiddenPeeks, peeks: [...state.peeks, reopened], activeId: peek.id };
  }
  /* Solo mode shows one tab but keeps the others open (and their rows loaded),
     so selecting a hidden one only brings it forward. */
  if (state.solo && state.activeId !== peek.id) return { ...state, activeId: peek.id };
  const peeks = state.peeks.filter((p) => p.id !== peek.id);
  const activeId = state.activeId === peek.id
    ? peeks[Math.min(index, peeks.length - 1)]?.id ?? ""
    : state.activeId;
  return { ...state, peeks, activeId, hiddenPeeks: rememberPeeks(state.hiddenPeeks ?? [], [state.peeks[index]]) };
}

/** Solo is a display rule: the open peeks stay mounted, only one tab shows. */
export function setIntegratedPeekSolo(state: IntegratedPeekState, solo: boolean): IntegratedPeekState {
  return { ...state, solo };
}

/** Filter actions select an open tab without toggling it off. */
export function selectIntegratedPeek(state: IntegratedPeekState, peek: IntegratedPeekState["peeks"][number]): IntegratedPeekState {
  return state.peeks.some((p) => p.id === peek.id) ? { ...state, activeId: peek.id } : toggleIntegratedPeek(state, peek);
}

/** Match each relation against its own source column, including zero and false. */
export function followIntegratedPeeks(peeks: IntegratedPeekState["peeks"], row: RowRecord | null) {
  return peeks.map((peek) => {
    const value = row?.[peek.sourceColumn];
    return { ...peek, target: { ...peek.target, value: value == null ? null : String(value) } };
  });
}

/** Pointer coordinates include CSS zoom; stored panel heights do not. */
export function resizeIntegratedPeek(startHeight: number, deltaY: number, scale: number, maxHeight: number, minSize = 140) {
  return Math.max(Math.min(minSize, maxHeight), Math.min(maxHeight, startHeight - deltaY / (scale || 1)));
}
