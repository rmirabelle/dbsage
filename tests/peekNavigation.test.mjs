import test from 'node:test';
import assert from 'node:assert/strict';
import { findPeekLocation } from '../src/lib/peekNavigation.ts';

const root = { profileId: 'local', database: 'db', table: 'pcrs', childTable: 'documents', row: { id: 42 }, label: 'Return', reveal() {} };
const target = { table: 'pcrs', column: 'id', value: '42' };
const find = (locations, request = target, kind = 'has_one', profile = 'local', database = 'db', source = 'documents') => findPeekLocation(locations, profile, database, request, kind, source);

test('reciprocal HAS ONE returns to the selected ancestor row', () => {
  assert.equal(find([root]), root);
  assert.equal(find([root], { ...target, value: '43' }), undefined);
});
test('identity includes connection and database and never matches NULL', () => {
  assert.equal(find([root], target, 'has_one', 'remote'), undefined);
  assert.equal(find([root], target, 'has_one', 'local', 'other'), undefined);
  assert.equal(find([root], { ...target, value: null }), undefined);
  assert.equal(find([{ ...root, row: { id: 0 } }], { ...target, value: '0' })?.row.id, 0);
});
test('HAS MANY requires the same record set, not one matching selected row', () => {
  assert.equal(find([root], target, 'has_many'), undefined);
  const sibling = { ...root, row: null, target };
  assert.equal(find([sibling], target, 'has_many'), sibling);
  assert.equal(find([{ ...sibling, filters: [{ column: 'status', op: 'equals', value: 'open' }] }], target, 'has_many'), undefined);
  assert.equal(find([sibling], { ...target, column: 'other_id' }, 'has_many'), undefined);
});
test('table names alone never cause navigation and nearest ordered match wins', () => {
  assert.equal(find([{ ...root, table: 'documents' }]), undefined);
  const sibling = { ...root, target };
  assert.equal(find([root, sibling]), root);
});

test('changes to users does not reuse the pcrs to users sibling, even for the same user', () => {
  const user = { ...root, table: 'users', childTable: undefined, target: { table: 'users', column: 'id', value: '42' } };
  const pcr = { ...root, childTable: 'changes' };
  assert.equal(find([pcr, user], user.target, 'has_one', 'local', 'db', 'changes'), undefined);
  assert.equal(find([pcr], target, 'has_one', 'local', 'db', 'changes'), pcr);
});

test('matching ancestor records alone are insufficient without reversed tables', () => {
  assert.equal(find([root], target, 'has_one', 'local', 'db', 'changes'), undefined);
  assert.equal(find([{ ...root, childTable: undefined }]), undefined);
});
