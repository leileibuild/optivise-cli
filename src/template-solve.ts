import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getTemplateSpec,
  loadYamlFile,
  readWorkbookSnapshot,
  runStandaloneDemoPipeline,
  validateWorkbookAgainstTemplate,
  validateYamlAgainstTemplate,
  type ModelBundle,
  type ResolvedConfig,
  type ValidationResult,
} from '@smart-planner/adapter-sdk';

import { ApiClient } from './api-client.js';
import type { Identity, UserConfig } from './auth.js';

export function loadProjectYaml(projectRoot: string): Record<string, unknown> {
  const path = resolve(projectRoot, 'project.yaml');
  try {
    return loadYamlFile(path);
  } catch {
    return {};
  }
}

export function resolveTemplateId(projectRoot: string, arg?: string): string {
  if (arg) {
    return arg;
  }
  const project = loadProjectYaml(projectRoot);
  if (typeof project.template_id === 'string') {
    return project.template_id;
  }
  throw new Error('Missing --template (or template_id in project.yaml)');
}

export function resolveExcelPath(projectRoot: string, templateId: string, arg?: string): string {
  if (arg) {
    return resolve(projectRoot, arg);
  }
  const project = loadProjectYaml(projectRoot);
  if (typeof project.defaultExcel === 'string') {
    return resolve(projectRoot, project.defaultExcel);
  }
  const spec = getTemplateSpec(templateId);
  return resolve(projectRoot, spec.examples.excel);
}

export function resolveConfigPath(
  projectRoot: string,
  templateId: string,
  arg?: string,
): string | undefined {
  if (arg) {
    return resolve(projectRoot, arg);
  }
  const project = loadProjectYaml(projectRoot);
  if (typeof project.defaultConfig === 'string') {
    return resolve(projectRoot, project.defaultConfig);
  }
  const spec = getTemplateSpec(templateId);
  if (spec.examples.yaml) {
    return resolve(projectRoot, spec.examples.yaml);
  }
  return undefined;
}

export async function runValidate(options: {
  projectRoot: string;
  templateId: string;
  excelPath: string;
  configPath?: string;
}): Promise<ValidationResult> {
  const spec = getTemplateSpec(options.templateId);
  const snapshot = await readWorkbookSnapshot(options.excelPath);
  const result = validateWorkbookAgainstTemplate(spec, snapshot);

  if (spec.requires_yaml) {
    if (!options.configPath) {
      result.errors.push({
        rule_id: 'yaml:required',
        path: 'yaml',
        message: 'Template requires --config supplemental.yaml',
        severity: 'error',
      });
      result.valid = false;
    } else {
      const yamlData = loadYamlFile(options.configPath);
      result.errors.push(...validateYamlAgainstTemplate(spec, yamlData));
      result.valid = result.errors.length === 0;
    }
  }

  return result;
}

export async function runTemplateSolve(options: {
  projectRoot: string;
  templateId: string;
  excelPath: string;
  configPath?: string;
  local?: boolean;
  identity?: Identity;
  userConfig?: UserConfig;
  verbose?: boolean;
}): Promise<{ status: string; feasible: boolean; objective?: number | null }> {
  const spec = getTemplateSpec(options.templateId);
  const validation = await runValidate(options);
  if (!validation.valid) {
    const msg = validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new Error(`Validation failed: ${msg}`);
  }

  if (!spec.solve_ready) {
    throw new Error(`Template ${options.templateId} is not solve-ready yet`);
  }

  if (spec.silo === 'cp_sat') {
    const remoteSolve =
      options.local || !options.identity || !options.userConfig
        ? undefined
        : async (bundle: ModelBundle, cfg: ResolvedConfig) => {
            const client = new ApiClient(options.userConfig!, options.identity!);
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
              console.error(`solve_id=${solveId}`);
            }
            const result = await client.pollSolve(solveId, (progress) => {
              if (options.verbose && progress.phase_label) {
                console.error(`progress: ${progress.phase_label}`);
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

    const { outcome } = await runStandaloneDemoPipeline({
      excelPath: options.excelPath,
      local: options.local,
      remoteSolve,
    });
    return {
      status: outcome.status,
      feasible: outcome.feasible,
      objective: outcome.objectiveValue,
    };
  }

  if (!options.identity || !options.userConfig) {
    throw new Error('PyJobShop templates require login (remote server solve)');
  }

  const excelBytes = readFileSync(options.excelPath);
  const yamlText = options.configPath ? readFileSync(options.configPath, 'utf8') : undefined;
  const client = new ApiClient(options.userConfig, options.identity);
  const solveId = await client.startTemplateSolve({
    request_id: crypto.randomUUID(),
    user_uid: options.identity.clientId,
    template_id: options.templateId,
    excel_b64: excelBytes.toString('base64'),
    yaml_text: yamlText,
    solver: {},
  });
  if (options.verbose) {
    console.error(`solve_id=${solveId}`);
  }
  const result = await client.pollSolve(solveId, (progress) => {
    if (options.verbose && progress.phase_label) {
      console.error(`progress: ${progress.phase_label}`);
    }
  });
  const excelB64 = result.excel_b64;
  if (excelB64) {
    writeFileSync(options.excelPath, Buffer.from(excelB64, 'base64'));
  }
  return {
    status: String(result.status),
    feasible: Boolean(result.feasible),
    objective: result.objective_value ?? null,
  };
}
