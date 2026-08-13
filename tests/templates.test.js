import test from 'node:test';
import assert from 'node:assert/strict';

import { listTemplateSpecs, toAgentSpecBundle, getTemplateSpec } from '@smart-planner/adapter-sdk';

test('templates list has five entries', () => {
  assert.equal(listTemplateSpecs().length, 5);
});

test('spec bundle for manufacturing requires yaml', () => {
  const bundle = toAgentSpecBundle(getTemplateSpec('manufacturing'));
  assert.equal(bundle.requires_yaml, true);
  assert.equal(bundle.silo, 'pyjobshop');
});
