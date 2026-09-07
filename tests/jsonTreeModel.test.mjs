import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJsonTreeRows, visibleJsonTreeRows, indexJsonTreeMatches, matchOffsets } from '../src/lib/jsonTreeModel.ts';

test('collapsed subtrees skip descendants, while search includes every row', () => {
  const rows = buildJsonTreeRows({ answers: [{ q: 'patient', v: 'John' }], other: 7 });
  assert.deepEqual(rows.map(r => r.path), ['/answers', '/answers/0', '/answers/0/q', '/answers/0/v', '/other']);
  assert.deepEqual(visibleJsonTreeRows(rows, new Set(['/answers']), false).map(r => r.path), ['/answers', '/other']);
  assert.equal(visibleJsonTreeRows(rows, new Set(['/answers']), true), rows);
  assert.deepEqual(visibleJsonTreeRows(rows, new Set(['/answers/0']), false).map(r => r.path), ['/answers', '/answers/0', '/other']);
});

test('keys have unique escaped paths and retain their original labels', () => {
  const rows = buildJsonTreeRows({ 'a/b': 1, a: { b: 2 }, '~': 3, '': 4 });
  assert.equal(new Set(rows.map(r => r.path)).size, rows.length);
  assert.equal(rows[0].key, 'a/b');
  assert.equal(rows.at(-1).key, '');
});

test('match ordinals follow keys then values, excluding array indices', () => {
  const rows = buildJsonTreeRows([{ john: 'John JOHN', n: 0 }, { name: 'john' }]);
  const index = indexJsonTreeMatches(rows, 'JoHn');
  assert.equal(index.count, 4);
  assert.deepEqual(index.matches[1], { keys: [0], values: [0, 5], start: 0, end: 3 });
  assert.equal(indexJsonTreeMatches(rows, '0').count, 1);
  assert.deepEqual(matchOffsets('aaaa', 'aa'), [0, 2]);
  assert.deepEqual(matchOffsets('aaaa', ''), []);
});

test('large documents retain all matches without constructing rendered rows', (t) => {
  const data = Array.from({ length: 20000 }, (_, i) => ({ q: `patient.${i}`, value: 'John Smith', enabled: true }));
  const start = performance.now();
  const rows = buildJsonTreeRows(data);
  const indexedAt = performance.now();
  const result = indexJsonTreeMatches(rows, 'john');
  assert.equal(rows.length, 80000);
  assert.equal(result.count, 20000);
  assert.equal(visibleJsonTreeRows(rows, new Set(rows.filter(r => r.container).map(r => r.path)), false).length, 20000);
  t.diagnostic(`80,000 rows: model ${(indexedAt - start).toFixed(1)}ms; search ${(performance.now() - indexedAt).toFixed(1)}ms`);
});
