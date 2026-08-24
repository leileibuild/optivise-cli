import type { V3ModelDescriptor } from './v3-client.js';

/** Agent-readable bundle derived from GET /v3/models/{model_id}. */
export function toAgentSpecBundle(descriptor: V3ModelDescriptor): Record<string, unknown> {
  return {
    model_id: descriptor.model_id,
    name: descriptor.name,
    description: descriptor.description,
    adapter_revision: descriptor.adapter_revision,
    solver_compatibility: descriptor.solver_compatibility,
    datasets: descriptor.datasets.map((dataset) => ({
      name: dataset.name,
      description: dataset.description ?? '',
      required: dataset.required !== false,
      csv_filename: `${dataset.name}.csv`,
      fields: 'fields' in dataset ? (dataset as { fields?: unknown[] }).fields ?? [] : [],
    })),
    result_datasets: descriptor.result_datasets.map((dataset) => ({
      name: dataset.name,
      description: dataset.description ?? '',
      csv_filename: `${dataset.name}.csv`,
    })),
    config_schema: descriptor.config_schema,
    constraints: descriptor.constraints ?? [],
    objectives: descriptor.objectives ?? [],
    semantic_boundaries: descriptor.semantic_boundaries ?? {},
    examples: descriptor.examples ?? [],
    workflow: [
      'optivise model-info --model <model_id>',
      'optivise scaffold --model <model_id> --profile <profile> --project <dir>',
      'Edit project.json, mapping.json, data/*.csv and config.json',
      'optivise lint --project <dir>',
      'optivise prepare --project <dir> --out <manifest-path>',
      'Show manifest and obtain explicit approval',
      'optivise run --manifest <path> --approve <manifest_id> --wait 60 --out <results-dir>',
      'optivise status/fetch/explain --run <run_id>',
    ],
    validate_rules: [
      'Each input file must be named exactly <dataset>.csv',
      'CSV headers must match the model descriptor field order',
      'config.json must satisfy config_schema',
      'Run validate until state=succeeded before solve',
    ],
    customer_communication: {
      activation: [
        'When uploaded files and a planning intent are present, reread the canonical optivise-cli skill before interpreting or answering the business request',
        'After npm installation, run optivise setup --target for the current host and require ready: true; npm installation alone is not complete agent setup',
        'Use the managed package executable directly; do not create wrappers, edit shell profiles, or persistently change PATH during installation',
        'Run describe-models/model-info internally before selecting a model; never answer a decision request from general reasoning alone',
      ],
      remote_only_boundary: [
        'The supplied optivise package is the only local installation; never install or run Python, OR-Tools, PyJobShop, CP-SAT, Routing, a solver package, or a substitute backend',
        'Preflight Smart Planner with describe-models/model-info before data interpretation; if it is unreachable, stop with no result and do not ask a business user for a backend URL',
        'Never create a local optimization script or use a phrase such as “优化工具” to justify a solver installation',
      ],
      result_gate: [
        'Require a real run_id, terminal status for that run, and result/artifact provenance before presenting any recommendation or decision file',
        'Without those facts, only ask a necessary business clarification or state that no result has been produced',
        'A customer-facing result is invalid if the CLI has not submitted a run and fetched the corresponding result or artifacts',
        'If artifact retrieval fails, stop with no downloadable result; never reconstruct or hand-write an artifact from previews, summaries, or memory',
        'Track provenance as unconfigured -> preflight_ok -> prepared -> approved -> submitted -> fetched; only fetched permits a business result',
        'Attachment readers, arithmetic, charts, code, and delegated agents may inspect metadata only; they must never synthesize a schedule, assignment, route, selection, score, cost, feasibility claim, or decision visualization',
        'Before fetched, say: 还没有生成远程求解结果，我不会根据文件内容自行推算排程。',
      ],
      response_templates: {
        installation: '已安装完成，可以开始使用。请上传业务数据，并告诉我希望安排或决定什么。',
        unavailable: '目前暂时无法完成计算，因此还没有生成结果。服务恢复后我可以继续处理。',
        result_order: ['business_table', 'business_interpretation', 'downloadable_files'],
      },
      default_style: [
        'Use concise business language and lead with a compact table after a completed run',
        'Do not expose commands, protocol terms, solver names, runtime, bounds, gap, internal term IDs, or numeric objective weights unless explicitly requested',
        'Keep agent-authored progress notes short and business-oriented; host-native tool cards may remain visible but must not be repeated in customer replies',
        'For Scheduling, resource_summary.busy_minutes is processing time only and excludes setup gaps; report processing busy time separately from the schedule span derived from schedule.csv, and never call busy_minutes setup-inclusive',
      ],
      exact_solve_sequence: [
        'optivise prepare --project <dir> --out <manifest-path>',
        'optivise run --manifest <same-manifest-path> --approve <manifest_id-from-prepare> --wait 60 --out <results-dir>',
        'optivise explain --run <run_id> --format short',
      ],
    },
  };
}
