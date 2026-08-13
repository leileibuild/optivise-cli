import test from 'node:test';
import assert from 'node:assert/strict';

import { toAgentSpecBundle } from '../dist/agent-spec.js';

test('toAgentSpecBundle maps v3 descriptor for agents', () => {
  const bundle = toAgentSpecBundle({
    model_id: 'capacity-planning@sha256:abc',
    name: 'Capacity planning',
    description: 'Allocate capacity.',
    adapter_revision: 'sha256:abc',
    solver_compatibility: ['reference'],
    datasets: [{ name: 'work_items', description: 'Items', required: true }],
    result_datasets: [{ name: 'allocations', description: 'Output' }],
    config_schema: { type: 'object' },
    constraints: [{ id: 'capacity_limit', label: 'Limit', default: true }],
    objectives: [{ id: 'maximize_priority', label: 'Priority', default: true }],
  });
  assert.equal(bundle.model_id, 'capacity-planning@sha256:abc');
  assert.equal(bundle.datasets[0].csv_filename, 'work_items.csv');
  assert.ok(Array.isArray(bundle.workflow));
  assert.ok(Array.isArray(bundle.validate_rules));
});
