import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Session, UserConfig } from './auth.js';
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

export function resolveConfigPath(projectRoot: string, arg?: string): string | undefined {
  if (arg) {
    return resolve(projectRoot, arg);
  }
  const project = loadProjectYaml(projectRoot);
  if (typeof project.defaultConfig === 'string') {
    return resolve(projectRoot, project.defaultConfig);
  }
  const defaultPath = join(projectRoot, 'config.json');
  return existsSync(defaultPath) ? defaultPath : undefined;
}

export function resolveOutDir(projectRoot: string, arg?: string): string {
  if (arg) {
    return resolve(projectRoot, arg);
  }
  const project = loadProjectYaml(projectRoot);
  if (typeof project.outDir === 'string') {
    return resolve(projectRoot, project.outDir);
  }
  return resolve(projectRoot, 'results');
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

async function resolveCsvFiles(
  dataDir: string,
  modelId: string,
  client: V3ApiClient,
): Promise<Array<{ dataset: string; path: string }>> {
  const descriptor = await client.getModel(modelId);
  const requiredDatasets = descriptor.datasets
    .filter((item) => item.required !== false)
    .map((item) => item.name);
  const csvFiles =
    requiredDatasets.length > 0
      ? collectCsvFiles(dataDir, requiredDatasets)
      : discoverCsvFiles(dataDir);

  if (csvFiles.length === 0) {
    throw new Error(`No CSV files found in ${dataDir}`);
  }
  for (const file of csvFiles) {
    if (!existsSync(file.path)) {
      throw new Error(`Missing dataset file: ${file.path}`);
    }
  }
  return csvFiles;
}

export interface V3ValidateResult {
  valid: boolean;
  run_id: string;
  state: string;
  phase: string;
  progress: number;
  errors: V3ValidationError[];
  validation_report?: Record<string, unknown>;
  build_summary?: { model_built: boolean };
  metadata?: Record<string, unknown>;
  run?: V3Run;
  asyncSubmitted?: boolean;
}

export function isTerminalRunState(state: string): boolean {
  return state === 'succeeded' || state === 'failed';
}

export function buildRunStatusPayload(run: V3Run, extras: Record<string, unknown> = {}): Record<string, unknown> {
  const terminal = isTerminalRunState(run.state);
  return {
    run_id: run.run_id,
    mode: run.mode,
    model_id: run.model_id,
    state: run.state,
    phase: run.phase,
    progress: run.progress,
    terminal,
    errors: run.errors ?? [],
    summary: run.summary,
    artifacts: run.artifacts,
    validation_report: run.validation_report,
    build_summary: run.build_summary,
    metadata: run.metadata,
    ...extras,
  };
}

export function buildAsyncSubmitPayload(run: V3Run, mode: 'validate' | 'solve'): Record<string, unknown> {
  const poll = `smart-planner runs status --run-id ${run.run_id} --format json`;
  const wait = `smart-planner runs wait --run-id ${run.run_id} --timeout 60 --format json`;
  const download =
    mode === 'solve'
      ? `smart-planner runs download --run-id ${run.run_id} --out-dir ./out --format json`
      : undefined;
  return {
    async: true,
    submitted: true,
    run_id: run.run_id,
    mode,
    model_id: run.model_id,
    state: run.state,
    phase: run.phase,
    progress: run.progress,
    terminal: isTerminalRunState(run.state),
    message: 'Run submitted asynchronously. Poll status and download results in separate steps.',
    poll_command: poll,
    wait_command: wait,
    download_command: download,
  };
}

export async function submitV3Run(options: {
  projectRoot: string;
  modelId: string;
  dataDir: string;
  configPath?: string;
  mode: 'validate' | 'solve';
  session?: Session | null;
  userConfig: UserConfig;
}): Promise<V3Run> {
  const client = new V3ApiClient(options.userConfig, options.session);
  const csvFiles = await resolveCsvFiles(options.dataDir, options.modelId, client);
  const config = loadRunConfig(options.configPath);
  const { run } = await client.createRun(
    {
      mode: options.mode,
      model_id: options.modelId,
      config,
      metadata: { cli: 'smart-planner', command: options.mode, async: true },
    },
    csvFiles,
  );
  return run;
}

export async function fetchV3RunStatus(options: {
  runId: string;
  session?: Session | null;
  userConfig: UserConfig;
}): Promise<{ run: V3Run; retryAfterMs: number | null }> {
  const client = new V3ApiClient(options.userConfig, options.session);
  return client.getRun(options.runId);
}

export async function waitV3Run(options: {
  runId: string;
  session?: Session | null;
  userConfig: UserConfig;
  timeoutSec?: number;
  verbose?: boolean;
}): Promise<{ run: V3Run; timedOut: boolean }> {
  const client = new V3ApiClient(options.userConfig, options.session);
  const maxWaitMs =
    options.timeoutSec == null ? undefined : Math.max(0, Math.floor(options.timeoutSec * 1000));
  return client.pollRun(options.runId, {
    maxWaitMs,
    maxAttempts: maxWaitMs == null ? 1 : 10_000,
    onProgress: options.verbose
      ? (snapshot) => {
          if (snapshot.phase) {
            console.error(`phase=${snapshot.phase} progress=${snapshot.progress}`);
          }
        }
      : undefined,
  });
}

export async function downloadV3RunArtifacts(options: {
  runId: string;
  outDir: string;
  session?: Session | null;
  userConfig: UserConfig;
}): Promise<{ run: V3Run; outputFiles: string[] }> {
  const client = new V3ApiClient(options.userConfig, options.session);
  const { run } = await client.getRun(options.runId);
  if (run.state === 'failed') {
    const msg = (run.errors ?? []).map((e) => formatV3Error(e)).join('; ');
    throw new Error(msg || 'Run failed');
  }
  if (run.state !== 'succeeded') {
    throw new Error(`Run is not ready for download (state=${run.state}). Poll with runs status/wait.`);
  }
  mkdirSync(options.outDir, { recursive: true });
  const outputFiles: string[] = [];
  for (const artifact of run.artifacts ?? []) {
    const csv = await client.downloadArtifact(run.run_id, artifact.artifact_id);
    const outPath = join(options.outDir, artifact.filename);
    writeFileSync(outPath, csv, 'utf8');
    outputFiles.push(outPath);
  }
  return { run, outputFiles };
}

export async function runV3Validate(options: {
  projectRoot: string;
  modelId: string;
  dataDir: string;
  configPath?: string;
  session?: Session | null;
  userConfig: UserConfig;
  verbose?: boolean;
  async?: boolean;
  waitTimeoutSec?: number;
}): Promise<V3ValidateResult> {
  if (options.async) {
    const run = await submitV3Run({
      projectRoot: options.projectRoot,
      modelId: options.modelId,
      dataDir: options.dataDir,
      configPath: options.configPath,
      mode: 'validate',
      session: options.session,
      userConfig: options.userConfig,
    });
    return {
      valid: false,
      run_id: run.run_id,
      state: run.state,
      phase: run.phase,
      progress: run.progress,
      errors: [],
      run,
      asyncSubmitted: true,
    };
  }

  const client = new V3ApiClient(options.userConfig, options.session);
  const csvFiles = await resolveCsvFiles(options.dataDir, options.modelId, client);
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
  const { run: final, timedOut } = await client.pollRun(run.run_id, {
    maxWaitMs:
      options.waitTimeoutSec == null ? undefined : Math.max(0, Math.floor(options.waitTimeoutSec * 1000)),
    onProgress: (snapshot) => {
      if (options.verbose && snapshot.phase) {
        console.error(`phase=${snapshot.phase} progress=${snapshot.progress}`);
      }
    },
  });
  if (timedOut) {
    throw new Error(
      `Validate still ${final.state} (phase=${final.phase}). Re-check with: smart-planner runs status --run-id ${final.run_id} --format json`,
    );
  }

  return {
    valid: final.state === 'succeeded',
    run_id: final.run_id,
    state: final.state,
    phase: final.phase,
    progress: final.progress,
    errors: final.errors ?? [],
    validation_report: final.validation_report as Record<string, unknown> | undefined,
    build_summary: final.build_summary,
    metadata: final.metadata,
  };
}

export async function runV3Solve(options: {
  projectRoot: string;
  modelId: string;
  dataDir: string;
  configPath?: string;
  outDir?: string;
  session?: Session | null;
  userConfig: UserConfig;
  verbose?: boolean;
  async?: boolean;
  waitTimeoutSec?: number;
}): Promise<{ run: V3Run; outputFiles: string[]; asyncSubmitted?: boolean }> {
  if (options.async) {
    const run = await submitV3Run({
      projectRoot: options.projectRoot,
      modelId: options.modelId,
      dataDir: options.dataDir,
      configPath: options.configPath,
      mode: 'solve',
      session: options.session,
      userConfig: options.userConfig,
    });
    return { run, outputFiles: [], asyncSubmitted: true };
  }

  const client = new V3ApiClient(options.userConfig, options.session);
  const csvFiles = await resolveCsvFiles(options.dataDir, options.modelId, client);
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
  const { run: final, timedOut } = await client.pollRun(run.run_id, {
    maxWaitMs:
      options.waitTimeoutSec == null ? undefined : Math.max(0, Math.floor(options.waitTimeoutSec * 1000)),
    onProgress: (snapshot) => {
      if (options.verbose && snapshot.phase) {
        console.error(`phase=${snapshot.phase} progress=${snapshot.progress}`);
      }
    },
  });

  if (timedOut) {
    throw new Error(
      `Solve still ${final.state} (phase=${final.phase}). Re-check with: smart-planner runs wait --run-id ${final.run_id} --timeout 60 --format json`,
    );
  }

  if (final.state === 'failed') {
    const msg = (final.errors ?? []).map((e) => formatV3Error(e)).join('; ');
    throw new Error(msg || 'Solve failed');
  }

  const outDir = resolveOutDir(options.projectRoot, options.outDir);
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
  session?: Session | null,
): Promise<void> {
  const client = new V3ApiClient(userConfig, session);
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
    'outDir: results',
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
      '## CSV workflow',
      '',
      '1. Edit CSV files under `data/` (one file per dataset: `<name>.csv`)',
      '2. Adjust `config.json` (constraints, objectives, weights, parameters, solver)',
      '3. `smart-planner validate`',
      '4. `smart-planner solve`',
      '',
    ].join('\n'),
    'utf8',
  );
}
