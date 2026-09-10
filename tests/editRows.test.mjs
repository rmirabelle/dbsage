import test from 'node:test';
import assert from 'node:assert/strict';
import { editRows } from '../src/lib/editRows.ts';

test('edits address the selected records and preserve NULL values', async () => {
  const writes = [];
  await editRows([{ name: 'id', key: 'PRI' }], [{ id: 7 }, { id: 9 }, { id: 12 }],
    [{ rowIndex: 2, column: 'name', value: null }, { rowIndex: 0, column: 'name', value: 'changed' }],
    async (update) => writes.push(update));
  assert.deepEqual(writes, [
    { pk: [{ column: 'id', value: '12' }], column: 'name', value: null },
    { pk: [{ column: 'id', value: '7' }], column: 'name', value: 'changed' },
  ]);
});

test('later edits follow changed composite primary keys without mutating source rows', async () => {
  const writes = [];
  const rows = [{ id: 7, tenant: 'a' }];
  await editRows([{ name: 'id', key: 'PRI' }, { name: 'tenant', key: 'PRI' }], rows,
    [{ rowIndex: 0, column: 'id', value: '8' }, { rowIndex: 0, column: 'name', value: 'updated' }],
    async (update) => writes.push(update));
  assert.deepEqual(writes.map((w) => w.pk), [
    [{ column: 'id', value: '7' }, { column: 'tenant', value: 'a' }],
    [{ column: 'id', value: '8' }, { column: 'tenant', value: 'a' }],
  ]);
  assert.equal(rows[0].id, 7);
});

test('missing keys or rows reject before any write and write failures stop the batch', async () => {
  let count = 0;
  const write = async () => { count++; throw new Error('database rejected update'); };
  const edits = [{ rowIndex: 0, column: 'name', value: 'x' }];
  await assert.rejects(editRows([], [{}], edits, write), /primary key/);
  await assert.rejects(editRows([{ name: 'id', key: 'PRI' }], [], edits, write), /no longer available/);
  assert.equal(count, 0);
  await assert.rejects(editRows([{ name: 'id', key: 'PRI' }], [{ id: 1 }], [...edits, ...edits], write), /database rejected/);
  assert.equal(count, 1);
});
