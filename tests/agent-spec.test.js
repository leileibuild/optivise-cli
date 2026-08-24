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
    semantic_boundaries: { supported: ['continuous operation'], not_supported: ['preemption'] },
  });
  assert.equal(bundle.model_id, 'capacity-planning@sha256:abc');
  assert.equal(bundle.datasets[0].csv_filename, 'work_items.csv');
  assert.ok(Array.isArray(bundle.workflow));
  assert.ok(Array.isArray(bundle.validate_rules));
  assert.deepEqual(bundle.semantic_boundaries, {
    supported: ['continuous operation'],
    not_supported: ['preemption'],
  });
  assert.deepEqual(bundle.customer_communication.result_gate, [
    'Require a real run_id, terminal status for that run, and result/artifact provenance before presenting any recommendation or decision file',
    'Without those facts, only ask a necessary business clarification or state that no result has been produced',
    'A customer-facing result is invalid if the CLI has not submitted a run and fetched the corresponding result or artifacts',
    'If artifact retrieval fails, stop with no downloadable result; never reconstruct or hand-write an artifact from previews, summaries, or memory',
    'Track provenance as unconfigured -> preflight_ok -> prepared -> approved -> submitted -> fetched; only fetched permits a business result',
    'Attachment readers, arithmetic, charts, code, and delegated agents may inspect metadata only; they must never synthesize a schedule, assignment, route, selection, score, cost, feasibility claim, or decision visualization',
    'Before fetched, say: 还没有生成远程求解结果，我不会根据文件内容自行推算排程。',
  ]);
  assert.ok(bundle.customer_communication.activation.some((item) => item.includes('optivise setup --target')));
  assert.ok(bundle.customer_communication.activation.some((item) => item.includes('do not create wrappers')));
  assert.deepEqual(bundle.customer_communication.remote_only_boundary, [
    'The supplied optivise package is the only local installation; never install or run Python, OR-Tools, PyJobShop, CP-SAT, Routing, a solver package, or a substitute backend',
    'Preflight Smart Planner with describe-models/model-info before data interpretation; if it is unreachable, stop with no result and do not ask a business user for a backend URL',
    'Never create a local optimization script or use a phrase such as “优化工具” to justify a solver installation',
  ]);
  assert.equal(bundle.customer_communication.response_templates.installation, '已安装完成，可以开始使用。请上传业务数据，并告诉我希望安排或决定什么。');
  assert.match(bundle.customer_communication.default_style[0], /business language/);
  assert.match(bundle.customer_communication.default_style[2], /host-native tool cards/);
  assert.match(bundle.customer_communication.default_style[3], /busy_minutes is processing time only/);
  assert.deepEqual(bundle.customer_communication.exact_solve_sequence, [
    'optivise prepare --project <dir> --out <manifest-path>',
    'optivise run --manifest <same-manifest-path> --approve <manifest_id-from-prepare> --wait 60 --out <results-dir>',
    'optivise explain --run <run_id> --format short',
  ]);
});
