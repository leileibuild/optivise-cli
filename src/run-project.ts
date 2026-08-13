import {
  applyWritePlan,
  defaultStandaloneConfig,
  readWorkbookSnapshot,
  runAdapterPipeline,
  type AdapterPair,
  type ModelBundle,
  type ResolvedConfig,
  type SolveOutcome,
} from '@smart-planner/adapter-sdk';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ApiClient } from './api-client.js';
import type { Identity, UserConfig } from './auth.js';
import { loadYamlConfig } from './patches.js';
import { assertProjectRoot } from './init-project.js';

export async function loadProjectAdapter(projectRoot: string): Promise<AdapterPair> {
  const adapterJs = join(projectRoot, 'dist', 'adapter.js');
  if (!existsSync(adapterJs)) {
    throw new Error('Adapter not built. Run: npm install && npm run build');
  }
  const mod = (await import(pathToFileURL(adapterJs).href)) as {
    dataAdapter: AdapterPair['data'];
    modelAdapter: AdapterPair['model'];
  };
  return { data: mod.dataAdapter, model: mod.modelAdapter };
}

export function resolveConfig(projectRoot: string): ResolvedConfig {
  const yaml = loadYamlConfig(projectRoot);
  const config = defaultStandaloneConfig();
  if (typeof yaml.adapterId === 'string') {
    config.adapterId = yaml.adapterId;
  }
  if (typeof yaml.modelVersion === 'string') {
    config.modelVersion = yaml.modelVersion;
  }
  return config;
}

export function resolveExcelPath(projectRoot: string, excelArg?: string): string {
  const yaml = loadYamlConfig(projectRoot);
  const candidate = excelArg ?? (typeof yaml.defaultExcel === 'string' ? yaml.defaultExcel : 'data/sample.xlsx');
  return resolve(projectRoot, candidate);
}

export async function runProjectPipeline(options: {
  projectRoot: string;
  excelPath: string;
  local?: boolean;
  identity?: Identity;
  config?: UserConfig;
  verbose?: boolean;
}): Promise<void> {
  assertProjectRoot(options.projectRoot);
  const adapter = await loadProjectAdapter(options.projectRoot);
  const config = resolveConfig(options.projectRoot);
  const snapshot = await readWorkbookSnapshot(options.excelPath);

  const remoteSolve =
    options.local || !options.identity || !options.config
      ? undefined
      : async (bundle: ModelBundle, cfg: ResolvedConfig): Promise<SolveOutcome> => {
          const client = new ApiClient(options.config!, options.identity!);
          const solveId = await client.startRemoteSolve({
            request_id: crypto.randomUUID(),
            user_uid: options.identity!.clientId,
            model_kind: 'cp_sat',
            model_payload: bundle.payload,
            decoder: bundle.decoder,
            solver: {
              max_time_in_seconds: cfg.solver.maxTimeInSeconds,
              num_workers: cfg.solver.numWorkers,
              log_search_progress: cfg.solver.logSearchProgress,
            },
          });
          if (options.verbose) {
            console.log(`solve_id=${solveId}`);
          }
          const result = await client.pollSolve(solveId, (progress) => {
            if (options.verbose && progress.phase_label) {
              console.log(`progress: ${progress.phase_label} (${progress.overall_percent ?? 0}%)`);
            }
          });
          return {
            status: String(result.status),
            feasible: Boolean(result.feasible),
            objectiveValue: result.objective_value ?? null,
            runtimeSeconds: result.runtime_seconds ?? null,
            metadata: result.metadata ?? {},
          };
        };

  const result = await runAdapterPipeline(adapter, snapshot, config, {
    local: options.local,
    remoteSolve,
  });

  await applyWritePlan(options.excelPath, result.writePlan);

  console.log('Solve finished');
  console.log(`status=${result.outcome.status} feasible=${result.outcome.feasible}`);
  if (result.outcome.objectiveValue != null) {
    console.log(`objective=${result.outcome.objectiveValue}`);
  }
  console.log(`excel=${options.excelPath}`);
}
