import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, applyMapping, toCsv } from '../dist/mapping.js';

test('CSV mapping handles quoted commas and multiline values', () => {
  const rows = parseCsv('id,note\n1,"hello, world"\n2,"line one\nline two"\n');
  assert.deepEqual(rows, [
    { id: '1', note: 'hello, world' },
    { id: '2', note: 'line one\nline two' },
  ]);
});

test('JSON mapping applies explicit columns, defaults, and restricted types', () => {
  const rows = applyMapping('[{"source_id":"A","qty":"3"}]', {
    source: 'input.json', target_dataset: 'items',
    columns: { item_id: 'source_id', quantity: 'qty' },
    defaults: { active: true }, types: { quantity: 'integer' },
  }, 'json');
  assert.deepEqual(rows, [{ item_id: 'A', quantity: 3, active: true }]);
});

test('boolean mapping accepts common source casing and emits canonical CSV literals', () => {
  const rows = applyMapping('id,active\nA,True\nB,FALSE\n', {
    source: 'input.csv', target_dataset: 'items',
    columns: { item_id: 'id', required: 'active' },
    types: { required: 'boolean' },
  });
  assert.deepEqual(rows, [
    { item_id: 'A', required: true },
    { item_id: 'B', required: false },
  ]);
  assert.equal(toCsv(rows), 'item_id,required\nA,true\nB,false\n');
});
