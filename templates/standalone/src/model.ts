import { buildStandaloneBundle } from '@smart-planner/adapter-sdk';
import type {
  ModelAdapter,
  ModelBundle,
  PreparedData,
  ResolvedConfig,
  Solution,
  SolveOutcome,
} from '@smart-planner/adapter-sdk';

export const modelAdapter: ModelAdapter = {
  async buildModel(prepared: PreparedData, config: ResolvedConfig): Promise<ModelBundle> {
    return buildStandaloneBundle(prepared, config);
  },

  decodeSolution(outcome: SolveOutcome, bundle: ModelBundle, config: ResolvedConfig): Solution {
    void bundle;
    void config;
    const values = (outcome.metadata?.solver_values ?? {}) as Record<string, unknown>;
    return {
      status: outcome.status,
      feasible: outcome.feasible,
      rows: [],
      summary: {
        x: values.x,
        y: values.y,
        objective_value: outcome.objectiveValue,
        runtime_seconds: outcome.runtimeSeconds,
      },
    };
  },
};
