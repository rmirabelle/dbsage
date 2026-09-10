import test from 'node:test';
import assert from 'node:assert/strict';
import { followIntegratedPeeks, resizeIntegratedPeek, toggleIntegratedPeek, restoreIntegratedPeek, setIntegratedPeekSolo, selectIntegratedPeek, refreshPeekRelations, restorePresetPeeks } from '../src/lib/integratedPeek.ts';

const peeks = [
  { id: 'customer', sourceColumn: 'customer_id', target: { table: 'customers', column: 'id', value: 'old' }, hiddenColumns: ['notes'] },
  { id: 'items', sourceColumn: 'id', target: { table: 'items', column: 'order_id', value: 'old' }, sort: { column: 'id', direction: 'desc' } },
];

test('legacy window layouts migrate into integrated tabs with nested settings and current connection', () => {
  const relations = [
    { id: 'customer', name: 'Customer', fromTable: 'orders', fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id', kind: 'has_one' },
    { id: 'items', name: 'Items', fromTable: 'customers', fromColumn: 'id', toTable: 'items', toColumn: 'customer_id', kind: 'has_many' },
    { id: 'back', name: 'Orders', fromTable: 'items', fromColumn: 'order_id', toTable: 'orders', toColumn: 'id', kind: 'has_one' },
  ];
  const legacy = relations.map((r) => ({ profileId: 'old', profileName: 'Old', database: 'old_db', label: `peek-${r.id}`,
    sourceTable: r.fromTable, sourceColumn: r.fromColumn, kind: r.kind,
    target: { table: r.toTable, column: r.toColumn, value: '123' }, hiddenColumns: ['notes'], filters: [], x: 100, height: 700 }));
  const state = restorePresetPeeks({ peeks: legacy }, 'orders', relations, 'new', 'New', 'new_db');
  assert.equal(state.activeId, 'customer');
  assert.equal(state.peeks.length, 1);
  const customer = state.peeks[0];
  assert.equal(customer.profileId, 'new');
  assert.equal(customer.database, 'new_db');
  assert.equal(customer.target.value, null);
  assert.equal(customer.label, undefined);
  assert.equal(customer.x, undefined);
  assert.deepEqual(customer.hiddenColumns, ['notes']);
  const items = customer.childPeekAll.peeks[0];
  assert.equal(items.id, 'items');
  assert.equal(items.childPeekAll.peeks[0].id, 'back');
  assert.equal(items.childPeekAll.peeks[0].childPeekAll, null);
  assert.equal(legacy[0].target.value, '123');
});

test('legacy hosted tabs deduplicate and missing relations are omitted; modern integrated state wins', () => {
  const relation = { id: 'customer', name: 'Buyer', fromTable: 'orders', fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id', kind: 'has_one' };
  const old = { ...peeks[0], sourceTable: 'orders', kind: 'has_one' };
  const state = restorePresetPeeks({ peeks: [{ hostedPeeks: [old, old] }] }, 'orders', [relation], 'p', 'P', 'db');
  assert.equal(state.peeks.length, 1);
  assert.equal(state.peeks[0].title, 'Buyer');
  assert.equal(restorePresetPeeks({ peeks: [old] }, 'orders', [], 'p', 'P', 'db'), null);
  const modern = { height: 350, closed: true, activeId: '', peeks: [] };
  assert.deepEqual(restorePresetPeeks({ peekAll: modern, peeks: [old] }, 'orders', [relation], 'p', 'P', 'db'), restoreIntegratedPeek(modern, 'p', 'P', 'db'));
});

test('new peeks inherit Solo while individually configured peeks retain their preference across reopen and restore', () => {
  const opened = toggleIntegratedPeek({ height: 240, solo: true, activeId: '', peeks: [] }, peeks[0]);
  assert.equal(opened.peeks[0].relationsSolo, true);
  const configured = { ...opened, peeks: [{ ...opened.peeks[0], relationsSolo: false,
    childPeekAll: { height: 160, solo: false, activeId: 'items', peeks: [peeks[1]] } }] };
  const closed = toggleIntegratedPeek(configured, peeks[0]);
  const restored = restoreIntegratedPeek(JSON.parse(JSON.stringify(closed)), 'p', 'Local', 'db');
  const reopened = toggleIntegratedPeek(restored, peeks[0]);
  assert.equal(reopened.solo, true);
  assert.equal(reopened.peeks[0].relationsSolo, false);
  assert.equal(reopened.peeks[0].childPeekAll.solo, false);
  const sibling = toggleIntegratedPeek(reopened, peeks[1]);
  assert.equal(sibling.peeks[0].relationsSolo, true);
  assert.equal(sibling.hiddenPeeks.find((p) => p.id === 'customer').relationsSolo, false);
});

test('session restoration retains closed workspaces and their nested tab configuration', () => {
  const child = { closed: true, height: 180, activeId: 'items', peeks: [peeks[1]] };
  const state = { closed: true, dock: 'right', width: 520, height: 240, activeId: 'customer',
    peeks: [{ ...peeks[0], childPeekAll: child, childPeekOpen: false }], hiddenPeeks: [peeks[1]] };
  const restored = restoreIntegratedPeek(JSON.parse(JSON.stringify(state)), 'profile', 'Local', 'db');
  assert.equal(restored.closed, true);
  assert.equal(restored.dock, 'right');
  assert.equal(restored.width, 520);
  assert.equal(restored.activeId, 'customer');
  assert.deepEqual(restored.peeks[0].hiddenColumns, ['notes']);
  assert.equal(restored.peeks[0].childPeekAll.closed, true);
  assert.equal(restored.peeks[0].childPeekOpen, false);
  assert.deepEqual(restored.peeks[0].childPeekAll.peeks[0].sort, peeks[1].sort);
  assert.equal(restored.hiddenPeeks.length, 1);
});

test('edited joins refresh open peeks while preserving same-table configuration and following the new source column', () => {
  const original = { ...peeks[0], title: 'Customer', sourceTable: 'orders', kind: 'has_one' };
  const state = { height: 240, activeId: original.id, peeks: [original] };
  const relation = { id: original.id, name: 'Buyer', fromTable: 'orders', fromColumn: 'buyer_id', toTable: 'customers', toColumn: 'user_id', kind: 'has_many' };
  const updated = refreshPeekRelations(state, [relation]);
  assert.equal(updated.peeks[0].title, 'Buyer');
  assert.equal(updated.peeks[0].kind, 'has_many');
  assert.equal(updated.peeks[0].target.column, 'user_id');
  assert.deepEqual(updated.peeks[0].hiddenColumns, ['notes']);
  assert.equal(followIntegratedPeeks(updated.peeks, { buyer_id: 123 })[0].target.value, '123');
  assert.equal(refreshPeekRelations(updated, [relation]), updated);
  assert.equal(state.peeks[0], original);
});

test('changing target table resets incompatible settings even in remembered nested peeks', () => {
  const old = { ...peeks[1], title: 'Items', sourceTable: 'customers', childPeekAll: { height: 120, activeId: '', peeks: [] } };
  const state = { height: 240, activeId: '', peeks: [], hiddenPeeks: [{ ...peeks[0], childPeekAll: { height: 150, activeId: 'items', peeks: [old] } }] };
  const relation = { id: 'items', name: '', fromTable: 'customers', fromColumn: 'id', toTable: 'invoices', toColumn: 'customer_id', kind: 'has_many' };
  const parentRelation = { id: 'customer', fromTable: 'orders', fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id', kind: 'has_one' };
  const updated = refreshPeekRelations(state, [parentRelation, relation]);
  const child = updated.hiddenPeeks[0].childPeekAll.peeks[0];
  assert.equal(child.title, 'invoices');
  assert.equal(child.target.table, 'invoices');
  assert.equal(child.sort, undefined);
  assert.equal(child.childPeekAll, undefined);
  assert.equal(updated.hiddenPeeks[0].childPeekAll.height, 150);
});

test('deleted relations remove open, remembered, and nested peeks and repair active tabs', () => {
  const relation = { id: 'customer', name: 'Customer', fromTable: 'orders', fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id', kind: 'has_one' };
  const child = { height: 150, activeId: 'items', peeks: [peeks[1]], hiddenPeeks: [peeks[1]] };
  const parent = { ...peeks[0], title: 'Customer', sourceTable: 'orders', kind: 'has_one', childPeekAll: child };
  const state = { height: 240, activeId: 'items', peeks: [parent, peeks[1]], hiddenPeeks: [{ ...parent }, peeks[1]] };
  const updated = refreshPeekRelations(state, [relation]);
  assert.deepEqual(updated.peeks.map((p) => p.id), ['customer']);
  assert.deepEqual(updated.hiddenPeeks.map((p) => p.id), ['customer']);
  assert.equal(updated.activeId, 'customer');
  for (const parent of [updated.peeks[0], updated.hiddenPeeks[0]]) {
    assert.deepEqual(parent.childPeekAll.peeks, []);
    assert.deepEqual(parent.childPeekAll.hiddenPeeks, []);
    assert.equal(parent.childPeekAll.activeId, '');
  }
  assert.equal(state.peeks.length, 2);
  assert.equal(refreshPeekRelations(updated, [relation]), updated);
  const empty = refreshPeekRelations(updated, []);
  assert.deepEqual(empty.peeks, []);
  assert.deepEqual(empty.hiddenPeeks, []);
  assert.equal(empty.activeId, '');
});

test('filter actions select an existing tab without closing it or losing its configuration', () => {
  const state = { height: 240, activeId: 'items', peeks };
  const selected = selectIntegratedPeek(state, { id: 'customer' });
  assert.equal(selected.activeId, 'customer');
  assert.equal(selected.peeks, peeks);
  assert.equal(selectIntegratedPeek(selected, { id: 'customer' }).peeks.length, 2);
  const solo = setIntegratedPeekSolo(state, true);
  const reopened = selectIntegratedPeek(solo, { id: 'customer' });
  assert.equal(reopened.peeks.length, 1);
  assert.deepEqual(reopened.peeks[0].hiddenColumns, ['notes']);
  assert.equal(reopened.hiddenPeeks[0].id, 'items');
});

test('solo keeps the active tab, replaces it on another relation click, and allows closing it', () => {
  const solo = setIntegratedPeekSolo({ height: 240, activeId: 'items', peeks }, true);
  assert.deepEqual(solo.peeks, [peeks[1]]);
  const replaced = toggleIntegratedPeek(solo, peeks[0]);
  assert.deepEqual(replaced.peeks, [{ ...peeks[0], relationsSolo: true }]);
  assert.equal(replaced.activeId, 'customer');
  assert.deepEqual(toggleIntegratedPeek(replaced, peeks[0]).peeks, []);
  const multi = toggleIntegratedPeek(setIntegratedPeekSolo(replaced, false), peeks[1]);
  assert.equal(multi.peeks.length, 2);
  assert.equal(restoreIntegratedPeek(solo, 'p', 'P', 'db').solo, true);
});

test('solo handles empty panels and an obsolete active tab id', () => {
  assert.deepEqual(setIntegratedPeekSolo({ height: 240, activeId: '', peeks: [] }, true).peeks, []);
  assert.equal(setIntegratedPeekSolo({ height: 240, activeId: 'missing', peeks }, true).activeId, 'customer');
});

test('solo replacements retain filters, column settings and nested peeks when reopened', () => {
  const configured = { ...peeks[0], filters: [{ column: 'status', op: 'equals', value: 'open' }],
    columnWidths: { name: 260 }, childPeekOpen: true,
    childPeekAll: { height: 180, activeId: 'items', peeks: [peeks[1]], hiddenPeeks: [] } };
  const state = { height: 240, activeId: configured.id, peeks: [configured], solo: true };
  const replaced = toggleIntegratedPeek(state, peeks[1]);
  const saved = restoreIntegratedPeek(JSON.parse(JSON.stringify(replaced)), 'new-profile', 'New', 'db');
  assert.equal(saved.hiddenPeeks[0].profileId, 'new-profile');
  assert.equal(saved.hiddenPeeks[0].childPeekAll.peeks[0].profileId, 'new-profile');
  const reopened = toggleIntegratedPeek(saved, { id: configured.id, sourceColumn: 'customer_id', target: { ...configured.target, value: '99' } });
  assert.deepEqual(reopened.peeks[0].filters, configured.filters);
  assert.deepEqual(reopened.peeks[0].columnWidths, configured.columnWidths);
  assert.deepEqual(reopened.peeks[0].hiddenColumns, configured.hiddenColumns);
  assert.equal(reopened.peeks[0].childPeekOpen, true);
  assert.equal(reopened.peeks[0].childPeekAll.height, 180);
  assert.equal(reopened.peeks[0].target.value, '99');
  assert.deepEqual(reopened.hiddenPeeks.map((p) => p.id), ['items']);
});

test('manual toggling and enabling solo remember hidden tabs without duplicating cache entries', () => {
  const state = { height: 240, activeId: 'items', peeks };
  const solo = setIntegratedPeekSolo(state, true);
  assert.deepEqual(solo.hiddenPeeks.map((p) => p.id), ['customer']);
  const closed = toggleIntegratedPeek(solo, peeks[1]);
  assert.equal(closed.hiddenPeeks.length, 2);
  const opened = toggleIntegratedPeek(setIntegratedPeekSolo(closed, false), { id: 'customer', target: peeks[0].target });
  assert.deepEqual(opened.peeks[0].hiddenColumns, ['notes']);
  assert.equal(toggleIntegratedPeek(opened, peeks[0]).hiddenPeeks.length, 2);
});

test('persisted nested tabs restore their settings on the current connection without stale row values', () => {
  const nested = { height: 120, activeId: 'items', peeks: [peeks[1]] };
  const saved = { height: 300, dock: 'right', width: 640, relationsWidth: 317, activeId: 'customer', peeks: [{ ...peeks[0], childPeekAll: nested, childPeekOpen: true }] };
  const restored = restoreIntegratedPeek(JSON.parse(JSON.stringify(saved)), 'current', 'Current profile', 'db');
  assert.equal(restored.height, 300);
  assert.equal(restored.dock, 'right');
  assert.equal(restored.width, 640);
  assert.equal(restored.relationsWidth, 317);
  assert.equal(restored.activeId, 'customer');
  assert.deepEqual(restored.peeks[0].hiddenColumns, ['notes']);
  assert.equal(restored.peeks[0].profileId, 'current');
  assert.equal(restored.peeks[0].target.value, null);
  assert.equal(restored.peeks[0].childPeekOpen, true);
  assert.equal(restored.peeks[0].childPeekAll.peeks[0].profileId, 'current');
  assert.equal(restored.peeks[0].childPeekAll.peeks[0].target.value, null);
  assert.deepEqual(restored.peeks[0].childPeekAll.peeks[0].sort, peeks[1].sort);
  assert.equal(saved.peeks[0].target.value, 'old');
  assert.equal(restoreIntegratedPeek(undefined, 'current', 'Current', 'db'), null);
});

test('focus mode opens only requested relations and preserves existing tab state', () => {
  const empty = { height: 220, activeId: '', peeks: [] };
  const first = toggleIntegratedPeek(empty, peeks[0]);
  assert.deepEqual(first.peeks.map((p) => p.id), ['customer']);
  const second = toggleIntegratedPeek(first, peeks[1]);
  assert.equal(second.activeId, 'items');
  assert.equal(second.peeks[0], first.peeks[0]);
  assert.equal(second.height, 220);
  assert.deepEqual(empty.peeks, []);
});

test('relation clicks close both active and inactive tabs and handle the final tab', () => {
  const state = { height: 220, activeId: 'items', peeks };
  const inactiveClosed = toggleIntegratedPeek(state, peeks[0]);
  assert.equal(inactiveClosed.activeId, 'items');
  assert.deepEqual(inactiveClosed.peeks.map((p) => p.id), ['items']);
  const activeClosed = toggleIntegratedPeek(state, peeks[1]);
  assert.equal(activeClosed.activeId, 'customer');
  const lastClosed = toggleIntegratedPeek(activeClosed, peeks[0]);
  assert.equal(lastClosed.activeId, '');
  assert.deepEqual(lastClosed.peeks, []);
});

test('source-row changes use each relation key without discarding tab settings', () => {
  const followed = followIntegratedPeeks(peeks, { id: 0, customer_id: 42 });
  assert.deepEqual(followed.map((p) => p.target.value), ['42', '0']);
  assert.deepEqual(followed[0].hiddenColumns, ['notes']);
  assert.deepEqual(followed[1].sort, peeks[1].sort);
  assert.equal(peeks[0].target.value, 'old');
});

test('clearing selection empties all peeks; NULL and false are distinct', () => {
  assert.deepEqual(followIntegratedPeeks(peeks, null).map((p) => p.target.value), [null, null]);
  assert.deepEqual(followIntegratedPeeks(peeks, { id: false, customer_id: null }).map((p) => p.target.value), [null, 'false']);
});

test('dragging at 200% zoom uses logical height and reserves parent rows', () => {
  assert.equal(resizeIntegratedPeek(300, 100, 2, 500), 250);
  assert.equal(resizeIntegratedPeek(300, -1000, 2, 500), 500);
  assert.equal(resizeIntegratedPeek(300, 1000, 2, 500), 140);
  assert.equal(resizeIntegratedPeek(300, -1000, 2, 90), 90);
});

test('right docking resize respects zoom, minimum width and available space', () => {
  assert.equal(resizeIntegratedPeek(600, -200, 2, 900, 320), 700);
  assert.equal(resizeIntegratedPeek(600, 1000, 1, 900, 320), 320);
  assert.equal(resizeIntegratedPeek(600, -1000, 1, 250, 320), 250);
});

test('recursive peeks retain independent state and follow their immediate parent', () => {
  const children = { height: 180, activeId: 'items', peeks };
  const parent = [{ ...peeks[0], childPeekAll: children, childPeekOpen: true }];
  const followedParent = followIntegratedPeeks(parent, { customer_id: 100 });
  const followedChildren = followIntegratedPeeks(followedParent[0].childPeekAll.peeks, { customer_id: 200, id: 300 });
  assert.equal(followedParent[0].target.value, '100');
  assert.deepEqual(followedChildren.map((p) => p.target.value), ['200', '300']);
  assert.equal(followedParent[0].childPeekAll.activeId, 'items');
  assert.equal(followedParent[0].childPeekAll.height, 180);
  assert.equal(children.peeks[0].target.value, 'old');
  assert.deepEqual(followIntegratedPeeks(children.peeks, null).map((p) => p.target.value), [null, null]);
});
