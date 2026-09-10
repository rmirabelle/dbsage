import test from 'node:test';
import assert from 'node:assert/strict';
import { findSameRow, firstFilteredCell } from '../src/lib/sameRow.ts';

const columns = [{ name: 'id', key: 'PRI' }, { name: 'name', key: '' }];
const before = [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }];

test('a surviving selected row is found by primary key after filtering', () => {
  assert.equal(findSameRow(columns, before, 1, [{ id: 2, name: 'Updated' }]), 0);
});

test('removed selected row falls back to first result and first visible column', () => {
  const after = [before[0]];
  assert.equal(findSameRow(columns, before, 1, after), -1);
  assert.deepEqual(firstFilteredCell(columns, after, ['id']), { rowIndex: 0, column: 'name' });
  assert.deepEqual(firstFilteredCell(columns, after, []), { rowIndex: 0, column: 'id' });
});

test('empty results or no visible columns cannot receive a cell selection', () => {
  assert.equal(firstFilteredCell(columns, [], []), null);
  assert.equal(firstFilteredCell(columns, before, ['id', 'name']), null);
});
