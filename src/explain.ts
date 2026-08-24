import type { V3Run } from './v3-client.js';

export type ExplainFormat = 'short' | 'detailed';

export function buildExplainPayload(run: V3Run, format: ExplainFormat): Record<string, unknown> {
  const result = (run.result ?? {}) as Record<string, any>;
  const status = String(result.status ?? run.state);
  if (status === 'infeasible') {
    const infeasible = {
      run_id: run.run_id,
      status,
      feasible: false,
      infeasibility_diagnosis: result.infeasibility_diagnosis ?? null,
    };
    if (format === 'short') return infeasible;
    return {
      run_id: run.run_id,
      status,
      feasibility: result.feasibility ?? { feasible: false, proof: 'solver_infeasible', violations: [] },
      infeasibility_diagnosis: result.infeasibility_diagnosis ?? null,
    };
  }

  const detailed = {
    run_id: run.run_id,
    status,
    objective_value: result.objective_value ?? null,
    optimality_gap: result.optimality_gap ?? null,
    feasibility: result.feasibility ?? null,
    objective_components: result.objective_components ?? [],
    key_decisions: result.key_decisions ?? {},
    artifacts: result.artifacts ?? run.artifacts ?? [],
    sensitivity_summary: result.sensitivity_summary ?? null,
    logs: result.logs ?? [],
    meta: result.meta ?? {},
  };
  return format === 'detailed'
    ? detailed
    : {
        run_id: detailed.run_id,
        status: detailed.status,
        feasible: (detailed.feasibility as any)?.feasible ?? null,
        key_decisions: detailed.key_decisions,
        artifacts: detailed.artifacts,
      };
}
