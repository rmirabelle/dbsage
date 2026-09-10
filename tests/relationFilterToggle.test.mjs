import test from 'node:test';
import assert from 'node:assert/strict';
import { toggleRelationFilter } from '../src/lib/relationFilterToggle.ts';
import { selectIntegratedPeek } from '../src/lib/integratedPeek.ts';

for (const op of ['hasrelated', 'norelated']) {
  test(`clearing ${op} keeps its peek closed and preserves the active relation`, () => {
    const target = { id: 'documents', sourceColumn: 'id', target: { table: 'documents', column: 'pcr_id', value: '42' } };
    let workspace = { height: 240, activeId: 'user', peeks: [{ ...target, id: 'user' }], hiddenPeeks: [target] };
    const original = workspace;
    let filter = op;
    toggleRelationFilter(op, op, (next) => { filter = next; }, () => { workspace = selectIntegratedPeek(workspace, target); });
    assert.equal(filter, null);
    assert.equal(workspace, original);
  });
  test(`enabling ${op} selects the relation exactly once`, () => {
    let selected = 0;
    let filter = null;
    toggleRelationFilter(null, op, (next) => { filter = next; }, () => selected++);
    assert.equal(filter, op);
    assert.equal(selected, 1);
  });
}
