import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonDisplay, extractJsonShowParts, validateJsonShow, extractJsonCandidates } from '../src/lib/jsonPath.ts';

const patient = { answers: [
  { q: 'ePatient.02', v: 'John' },
  { q: 'ePatient.03', v: 'Smith' },
], age: 42, enabled: false, empty: null };
const first = 'answers[q=ePatient.02].v';
const last = 'answers[q=ePatient.03].v';

test('existing paths retain types, selectors and automatic multi-path labels', () => {
  assert.equal(extractJsonDisplay(patient, first), 'John');
  assert.equal(extractJsonDisplay(patient, 'age'), 42);
  assert.equal(extractJsonDisplay(patient, 'enabled'), false);
  assert.equal(extractJsonShowParts(patient, first), null);
  assert.equal(extractJsonDisplay(patient, 'age, enabled'), 'age: 42, enabled: false');
  assert.equal(extractJsonDisplay(JSON.stringify(patient), 'answers.v'), 'John · Smith');
});

test('single and multiple aliases are displayed', () => {
  assert.deepEqual(extractJsonShowParts(patient, `${first} AS Patient First Name`), [{ label: 'Patient First Name', value: 'John' }]);
  assert.equal(extractJsonDisplay(patient, `${first} as First, ${last} AS Last`), 'First: John, Last: Smith');
  assert.equal(extractJsonDisplay(patient, `${first} AS "Name, AS First"`), 'Name, AS First: John');
});

test('multiline concatenation preserves literals and treats null/missing as empty', () => {
  assert.equal(extractJsonDisplay(patient, `${first}\n + ' ' +\n${last}\nAS Patient Name`), 'Patient Name: John Smith');
  assert.equal(extractJsonDisplay(patient, "age + enabled + empty + missing"), '42false');
  assert.equal(extractJsonDisplay(patient, "'a, + AS [b]' + 'c'"), 'a, + AS [b]c');
  assert.equal(extractJsonDisplay(patient, String.raw`'It\'s ' + 'ok'`), "It's ok");
});

test('selector punctuation is not parsed as SHOW operators', () => {
  assert.equal(extractJsonDisplay({ answers: [{ q: 'a,b + AS c', v: 'found' }] }, 'answers[q=a,b + AS c].v AS Result'), 'Result: found');
});

test('bracket indexing selects from the filtered array in order', () => {
  const data = [{ name: 'other', v: 'skip' }, { name: 'eTimes', v: 'first' }, { name: 'eTimes', v: 'second' }];
  assert.equal(extractJsonDisplay(data, '[name=eTimes][0].v'), 'first');
  assert.equal(extractJsonDisplay(data, '[name=eTimes][1].v AS Time'), 'Time: second');
  assert.equal(extractJsonDisplay(data, '[name=eTimes][0].v'), extractJsonDisplay(data, '[name=eTimes].0.v'));
  assert.equal(extractJsonDisplay(data, '[name=eTimes][9].v'), undefined);
  assert.equal(extractJsonDisplay(data, '[name=missing][0].v'), undefined);
  assert.deepEqual(extractJsonCandidates(data, '[name=eTimes][0].v'), ['first']);
  assert.equal(extractJsonDisplay({ entries: data }, 'entries[name=eTimes][0].v'), 'first');
});

test('plain and nested bracket indices preserve extraction and concatenation', () => {
  assert.equal(extractJsonDisplay(patient, 'answers[0].v'), 'John');
  assert.equal(extractJsonDisplay(patient, "answers[0].v + ' ' + answers[1].v AS Name"), 'Name: John Smith');
  assert.equal(extractJsonDisplay([[{ v: 'nested' }]], '[0][0].v'), 'nested');
  assert.equal(extractJsonDisplay([{ items: ['a', 'b'] }, { items: ['c'] }], 'items[0]'), 'a · c');
});

test('invalid syntax reports errors without crashing display', () => {
  for (const expression of ["age +", "'unclosed", 'answers[q=x', 'age]', 'age AS', 'age AS ""', "'x' age", String.raw`'\z'`, 'age AS One AS Two']) {
    assert.ok(validateJsonShow(expression), expression);
    assert.doesNotThrow(() => extractJsonDisplay(patient, expression));
  }
  assert.equal(validateJsonShow(''), null);
  assert.equal(validateJsonShow(`${first} + ' ' + ${last} AS Name`), null);
});

test('LIKE selectors support prefix, suffix, contains, exact-length and case-sensitive matching', () => {
  const data = [{ name: 'eTimes', items: [
    { name: 'eTimes.01', label: 'One' }, { name: 'eTimes.02', label: 'Two' },
    { name: 'eTimes.A', label: 'Letter' }, { name: 'ETIMES.03', label: 'Upper' },
  ] }];
  const show = pattern => `[name=eTimes].items[name LIKE '${pattern}'].label`;
  assert.equal(extractJsonDisplay(data, show('eTimes.%')), 'One · Two · Letter');
  assert.equal(extractJsonDisplay(data, show('%.02')), 'Two');
  assert.equal(extractJsonDisplay(data, show('%Times%')), 'One · Two · Letter');
  assert.equal(extractJsonDisplay(data, show('eTimes.__')), 'One · Two');
  assert.equal(extractJsonDisplay(data, show('eTimes._')), 'Letter');
  assert.equal(extractJsonDisplay(data, show('Times')), undefined);
  assert.equal(extractJsonDisplay(data, "[name=eTimes].items[name like 'eTimes.%'][0].label + '!' AS First"), 'First: One!');
});

test('LIKE escapes and punctuation remain literal and do not split SHOW syntax', () => {
  const names = ['100%', '100x', 'a_b', 'axb', 'a]b[. + AS ,=c', "O'Brien", 'a\\b', '😀', '', 'a\nb'];
  const data = names.map(name => ({ name, label: name || 'empty' }));
  assert.equal(extractJsonDisplay(data, String.raw`[name LIKE '100\%'].label`), '100%');
  assert.equal(extractJsonDisplay(data, String.raw`[name LIKE 'a\_b'].label`), 'a_b');
  assert.equal(extractJsonDisplay(data, "[name LIKE 'a]b[. + AS ,=c'].label AS Result"), 'Result: a]b[. + AS ,=c');
  assert.equal(extractJsonDisplay(data, String.raw`[name LIKE 'O\'Brien'].label`), "O'Brien");
  assert.equal(extractJsonDisplay(data, String.raw`[name LIKE 'a\\b'].label`), 'a\\b');
  assert.equal(extractJsonDisplay(data, '[name LIKE "_"].label'), '😀');
  assert.equal(extractJsonDisplay(data, "[name LIKE ''].label"), 'empty');
  assert.equal(extractJsonDisplay(data, "[name LIKE 'a_b'].label"), 'a_b · axb · a\\b · a\nb');
  assert.equal(extractJsonDisplay(data, '[name=100%].label'), '100%');
});

test('LIKE excludes missing/null values and invalid patterns fail validation', () => {
  const data = [{}, {name: null}, {name: {}}, {name: 42, label: 'number'}, {name: false, label: 'bool'}];
  assert.equal(extractJsonDisplay(data, "[name LIKE '%'].label"), 'number · bool');
  for (const show of ["[name LIKE eTimes%].label", "[name LIKE].label", "[name LIKE 'oops].label", "[name LIKE 'x' garbage].label"]) {
    assert.ok(validateJsonShow(show), show);
    assert.deepEqual(extractJsonCandidates(data, show), []);
  }
});

test('NOT LIKE supports nested selectors, both index forms, aliases, and concatenation', () => {
  const data = [{ name: 'eTimes', items: [
    { name: 'eTimes.01' }, { name: 'other.01' }, { name: 'ETimes.02' },
    {}, { name: null }, { name: {} },
  ] }];
  const expression = "[name=eTimes].0.items[name NOT LIKE 'eTimes%'].name";
  assert.equal(validateJsonShow(expression), null);
  assert.equal(extractJsonDisplay(data, expression), 'other.01 · ETimes.02');
  assert.equal(extractJsonDisplay(data, "[name=eTimes][0].items[name not like 'eTimes%'][0].name + '!' AS Other"), 'Other: other.01!');
  assert.deepEqual(extractJsonCandidates(data, expression), ['other.01', 'ETimes.02']);
});

test('NOT LIKE inverts wildcards and escaped literals without matching missing values', () => {
  const data = ['a_b', 'axb', '', 'a]b + AS ,=c'].map(name => ({ name }));
  assert.equal(extractJsonDisplay(data, String.raw`[name NOT LIKE 'a\_b'][0].name`), 'axb');
  assert.equal(extractJsonDisplay(data, "[name NOT LIKE 'a_b'][0].name"), '');
  assert.equal(extractJsonDisplay(data, "[name NOT LIKE '%'].name"), undefined);
  assert.equal(extractJsonDisplay(data, "[name NOT LIKE 'a]b + AS ,=c'][0].name"), 'a_b');
  assert.equal(extractJsonDisplay([{}, {name: null}], "[name NOT LIKE 'x'].name"), undefined);
  for (const expression of ["[name NOT LIKE].name", "[name NOT LIKE x%].name", "[name NOT LIKE 'x].name"]) {
    assert.ok(validateJsonShow(expression), expression);
    assert.deepEqual(extractJsonCandidates(data, expression), []);
  }
});
