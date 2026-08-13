import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Identity, UserConfig } from './auth.js';
import {
  collectCsvFiles,
  discoverCsvFiles,
  V3ApiClient,
  type V3Run,
  type V3ValidationError,
} from './v3-client.js';

export function loadProjectYaml(projectRoot: string): Record<string, unknown> {
  const path = join(projectRoot, 'project.yaml');
  if (!existsSync(path)) {
    return {};
  }
  const text = readFileSync(path, 'utf8');
  const result: Record<string, unknown> = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^([a-zA-Z0-9_]+):\s*(.+)$/);
    if (match) {
      result[match[1]] = match[2].trim();
    }
  }
  return result;
}

export function resolveModelId(projectRoot: string, arg?: string): string {
  if (arg) {
    return arg;
  }
  const project = loadProjectYaml(projectRoot);
  if (typeof project.model_id === 'string') {
    return project.model_id;
  }
  throw new Error('Missing --model-id (or model_id in project.yaml)');
}

export function resolveDataDir(projectRoot: string, arg?: string): string {
  if (arg) {
    return resolve(projectRoot, arg);
  }
  const project = loadProjectYaml(projectRoot);
  if (typeof project.dataDir === 'string') {
    return resolve(projectRoot, project.dataDir);
  }
  return resolve(projectRoot, 'data');
}

export function loadRunConfig(configPath?: string): Record<string, unknown> {
  if (!configPath) {
    return {};
  }
  const text = readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Config file must contain a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export interface V3ValidateResult {
  valid: boolean;
  run_id: string;
  errors: V3ValidationError[];
  build_summary?: { model_built: boolean };
}

export async function runV3Validate(options: {
  projectRoot: string;
  modelId: string;
  dataDir: string;
  configPath?: string;
  identity?: Identity;
  userConfig: UserConfig;
  verbose?: boolean;
}): Promise<V3ValidateResult> {
  const client = new V3ApiClient(options.userConfig, options.identity);
  const descriptor = await client.getModel(options.modelId);
  const requiredDatasets = descriptor.datasets
    .filter((item) => item.required !== false)
    .map((item) => item.name);
  const csvFiles =
    requiredDatasets.length > 0
      ? collectCsvFiles(options.dataDir, requiredDatasets)
      : discoverCsvFiles(options.dataDir);

  if (csvFiles.length === 0) {
    throw new Error(`No CSV files found in ${options.dataDir}`);
  }
  for (const file of csvFiles) {
    if (!existsSync(file.path)) {
      throw new Error(`Missing dataset file: ${file.path}`);
    }
  }

  const config = loadRunConfig(options.configPath);
  const { run } = await client.createRun(
    {
      mode: 'validate',
      model_id: options.modelId,
      config,
      metadata: { cli: 'smart-planner', command: 'validate' },
    },
    csvFiles,
  );
  if (options.verbose) {
    console.error(`run_id=${run.run_id}`);
  }
  const final = await client.pollRun(run.run_id, (snapshot) => {
    if (options.verbose && snapshot.phase) {
      console.error(`phase=${snapshot.phase} progress=${snapshot.progress}`);
    }
  });

  return {
    valid: final.state === 'succeeded',
    run_id: final.run_id,
    errors: final.errors ?? [],
    build_summary: final.build_summary,
  };
}

export async function runV3Solve(options: {
  projectRoot: string;
  modelId: string;
  dataDir: string;
  configPath?: string;
  outDir?: string;
  identity?: Identity;
  userConfig: UserConfig;
  verbose?: boolean;
}): Promise<{ run: V3Run; outputFiles: string[] }> {
  const validation = await runV3Validate(options);
  if (!validation.valid) {
    const msg = validation.errors.map((e) => formatV3Error(e)).join('; ');
    throw new Error(`Validation failed: ${msg}`);
  }

  const client = new V3ApiClient(options.userConfig, options.identity);
  const descriptor = await client.getModel(options.modelId);
  const requiredDatasets = descriptor.datasets
    .filter((item) => item.required !== false)
    .map((item) => item.name);
  const csvFiles =
    requiredDatasets.length > 0
      ? collectCsvFiles(options.dataDir, requiredDatasets)
      : discoverCsvFiles(options.dataDir);

  const config = loadRunConfig(options.configPath);
  const { run } = await client.createRun(
    {
      mode: 'solve',
      model_id: options.modelId,
      config,
      metadata: { cli: 'smart-planner', command: 'solve' },
    },
    csvFiles,
  );
  if (options.verbose) {
    console.error(`run_id=${run.run_id}`);
  }
  const final = await client.pollRun(run.run_id, (snapshot) => {
    if (options.verbose && snapshot.phase) {
      console.error(`phase=${snapshot.phase} progress=${snapshot.progress}`);
    }
  });

  if (final.state === 'failed') {
    const msg = (final.errors ?? []).map((e) => formatV3Error(e)).join('; ');
    throw new Error(msg || 'Solve failed');
  }

  const outDir = resolve(options.projectRoot, options.outDir ?? 'results');
  mkdirSync(outDir, { recursive: true });
  const outputFiles: string[] = [];
  for (const artifact of final.artifacts ?? []) {
    const csv = await client.downloadArtifact(final.run_id, artifact.artifact_id);
    const outPath = join(outDir, artifact.filename);
    writeFileSync(outPath, csv, 'utf8');
    outputFiles.push(outPath);
  }

  return { run: final, outputFiles };
}

export function formatV3Error(error: V3ValidationError): string {
  const parts = [error.message];
  if (error.dataset) {
    parts.unshift(`${error.dataset}`);
  }
  if (error.line != null && error.column) {
    parts.push(`line ${error.line} col ${error.column}`);
  }
  if (error.suggestion) {
    parts.push(`suggestion: ${error.suggestion}`);
  }
  return parts.join(': ');
}

export async function scaffoldV3Project(
  userConfig: UserConfig,
  modelId: string,
  targetDir: string,
  identity?: Identity,
): Promise<void> {
  const client = new V3ApiClient(userConfig, identity);
  const descriptor = await client.getModel(modelId);
  mkdirSync(join(targetDir, 'data'), { recursive: true });

  for (const dataset of descriptor.datasets) {
    const csv = await client.downloadTemplate(modelId, dataset.name);
    writeFileSync(join(targetDir, 'data', `${dataset.name}.csv`), csv, 'utf8');
  }

  const projectYaml = [
    `model_id: ${modelId}`,
    'dataDir: data',
    'defaultConfig: config.json',
    '',
  ].join('\n');
  writeFileSync(join(targetDir, 'project.yaml'), projectYaml, 'utf8');

  const exampleConfig = descriptor.examples?.[0]?.config ?? {
    constraints: Object.fromEntries(
      (descriptor.constraints ?? []).map((item) => [item.id, item.default ?? true]),
    ),
    objectives: Object.fromEntries(
      (descriptor.objectives ?? []).map((item) => [item.id, item.default ?? true]),
    ),
    solver: { time_limit_seconds: 60, workers: 4 },
  };
  writeFileSync(join(targetDir, 'config.json'), JSON.stringify(exampleConfig, null, 2), 'utf8');

  writeFileSync(
    join(targetDir, 'README.md'),
    [
      `# ${descriptor.name}`,
      '',
      descriptor.description,
      '',
      '## Workflow',
      '',
      '1. Edit CSV files under `data/`',
      '2. Adjust `config.json` if needed',
      '3. `smart-planner validate --model-id ... --data-dir data`',
      '4. `smart-planner solve --model-id ... --data-dir data --out-dir results`',
      '',
    ].join('\n'),
    'utf8',
  );
}
