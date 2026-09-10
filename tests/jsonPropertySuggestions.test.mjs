import test from 'node:test';
import assert from 'node:assert/strict';
import { rootJsonProperties, rootCompletion, matchingRootProperties, matchingSelectorValues, jsonPropertyCompletion } from '../src/lib/jsonPropertySuggestions.ts';

test('merges root keys across heterogeneous documents without descending into objects or arrays', () => {
  const rows = [
    { json: '{"name":"A","nested":{"child":1},"items":[{"arrayChild":1}]}' },
    { json: { name: 'B', different: null } },
    { json: '[{"notRoot":1}]' }, { json: 'null' }, { json: 'invalid' }, { json: '123' }, {},
  ];
  assert.deepEqual(rootJsonProperties(rows, 'json'), ['different', 'items', 'name', 'nested']);
});

test('loaded sampling inspects at most 100 rows', () => {
  assert.deepEqual(rootJsonProperties([...Array.from({ length: 100 }, () => ({ json: '{}' })), { json: '{"outside":1}' }], 'json'), []);
});

test('root completion works after commas and concatenation and replaces the whole token', () => {
  for (const text of ['', 'na', 'name AS Name, na', "first + ' ' + na", 'first,\n  na']) {
    const completion = rootCompletion(text, text.length);
    assert.ok(completion, text);
    assert.equal(completion.prefix, text ? 'na' : '');
  }
  assert.deepEqual(rootCompletion('name AS Label', 2), { start: 0, end: 4, prefix: 'na' });
});

test('does not suggest inside aliases, nested paths, array selectors or quoted literals', () => {
  for (const text of ['name AS Lab', "'name", 'items[na', 'items[0].na', 'obj.na', "items[name LIKE 'rep", 'name AS Label + na']) {
    assert.equal(rootCompletion(text, text.length), null, text);
  }
});

test('matches prefixes case-insensitively, preserves key spelling, and bounds results', () => {
  assert.deepEqual(matchingRootProperties(['Name', 'nested', 'other', 'name-first', 'not.a.root'], 'NA'), ['Name', 'name-first']);
  assert.equal(matchingRootProperties(Array.from({ length: 100 }, (_, i) => `key_${i}`), '').length, 50);
});

test('array selector suggestions use first-item keys from the correct array across rows', () => {
  const rows = [
    { j: { items: [{ prop: 1 }, { laterOnly: 2 }], other: [{ unrelated: 1 }] } },
    { j: '{"items":[{"different":2}]}' },
    { j: { items: [] } }, { j: { items: [null, { skipped: 1 }] } },
    { j: { items: { notAnArray: 1 } } },
  ];
  assert.deepEqual(rootJsonProperties(rows, 'j', 'items'), ['different', 'prop']);
  assert.deepEqual(rootJsonProperties([{ j: [{ rootProp: 1 }] }], 'j', ''), ['rootProp']);
});

test('completes selector property without replacing the predicate or remaining expression', () => {
  const text = 'items[property=value].name AS Label';
  const completion = jsonPropertyCompletion(text, 'items[pr'.length);
  assert.deepEqual(completion, { start: 6, end: 14, prefix: 'pr', arrayProperty: 'items', selectorProperty: undefined });
  assert.equal(text.slice(0, completion.start) + 'product' + text.slice(completion.end), 'items[product=value].name AS Label');
  assert.equal(jsonPropertyCompletion('[pr', 3).arrayProperty, '');
  assert.equal(jsonPropertyCompletion('name, items[', 12).arrayProperty, 'items');
});

test('selector suggestions do not leak into quoted patterns, indices, aliases or nested selectors', () => {
  for (const text of ["items[prop LIKE 'va", 'items[0', 'name AS items[pr', "'items[pr", 'items[x=y].other[pr']) {
    assert.equal(jsonPropertyCompletion(text, text.length), null, text);
  }
});

test('answers[q=] suggests identifier values and preserves the users full expression', () => {
  const text = 'dispatched, incident_num as incident, call_sign_code as unit, answers[q=].lbl as dest';
  const caret = text.indexOf('q=') + 2;
  const completion = jsonPropertyCompletion(text, caret);
  assert.equal(completion.arrayProperty, 'answers');
  assert.equal(completion.selectorProperty, 'q');
  assert.equal(completion.prefix, '');
  const rows = [{ j: { answers: [{ q: 'eArrest.01' }, { q: 'eArrest.02' }, { q: 'eArrest.02' }, { other: 1 }] } }];
  const values = rootJsonProperties(rows, 'j', 'answers', 'q');
  assert.deepEqual(matchingSelectorValues(values, 'ear'), ['eArrest.01', 'eArrest.02']);
  assert.equal(text.slice(0, completion.start) + values[1] + text.slice(completion.end), text.replace('q=', 'q=eArrest.02'));
});

test('selector values support scalar values and omit null, containers and unrepresentable delimiters', () => {
  const rows = [{ j: [{ q: false }, { q: 0 }, { q: null }, { q: {} }, { q: 'a]b' }] }];
  assert.deepEqual(matchingSelectorValues(rootJsonProperties(rows, 'j', '', 'q'), ''), ['0', 'false']);
  const text = 'answers[q=eArrest.01].lbl';
  const completion = jsonPropertyCompletion(text, text.indexOf('eArrest') + 3);
  assert.equal(completion.prefix, 'eAr');
  assert.equal(text.slice(completion.end), '].lbl');
});
