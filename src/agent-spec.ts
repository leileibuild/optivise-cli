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
    examples: descriptor.examples ?? [],
    workflow: [
      'smart-planner init --model-id <model_id> [dir]',
      'Edit data/<dataset>.csv files and config.json',
      'smart-planner validate --dry-run and show the manifest to the user',
      'After explicit approval, smart-planner validate',
      'smart-planner solve --dry-run and show the manifest to the user',
      'After explicit approval, smart-planner solve --out-dir results',
    ],
    validate_rules: [
      'Each input file must be named exactly <dataset>.csv',
      'CSV headers must match the model descriptor field order',
      'config.json must satisfy config_schema',
      'Run validate until state=succeeded before solve',
    ],
  };
}
