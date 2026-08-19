import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import type { Session, UserConfig } from './auth.js';
import { DatasetValidationError, validateDatasetFiles } from './dataset-validation.js';
import {
  collectCsvFiles,
  discoverCsvFiles,
  V3ApiClient,
  type V3Run,
  type V3ValidationError,
} from './v3-client.js';
import {
  assertSafeFilename,
  assertSafeName,
  inspectFile,
  resolveOutputFile,
} from './security.js';

export function resolveModelId(projectRoot: string, arg?: string): string {
  if (arg) {
    return arg;
  }
  const json = loadProjectJson(projectRoot);
  if (typeof json.model_id === 'string') return json.model_id;
  throw new Error('Missing --model (or model_id in project.json)');
}

export interface ProjectDocument { schema_version: 1; model_id: string; profile_id: string; data_dir: string; config_path: string; mapping_path: string; out_dir: string }
export function loadProjectJson(projectRoot: string): Partial<ProjectDocument> {
  const path = join(projectRoot, 'project.json'); if (!existsSync(path)) return {};
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<ProjectDocument>;
  if (value.schema_version !== 1) throw new Error('project.json must use schema_version=1'); return value;
}

export function resolveDataDir(projectRoot: string, arg?: string): string {
  if (arg) {
    return resolve(projectRoot, arg);
  }
  const project = loadProjectJson(projectRoot);
  if (typeof project.data_dir === 'string') return resolve(projectRoot, project.data_dir);
  return resolve(projectRoot, 'data');
}

export function resolveConfigPath(projectRoot: string, arg?: string): string | undefined {
  if (arg) {
    return resolve(projectRoot, arg);
  }
  const project = loadProjectJson(projectRoot);
  if (typeof project.config_path === 'string') return resolve(projectRoot, project.config_path);
  const defaultPath = join(projectRoot, 'config.json');
  return existsSync(defaultPath) ? defaultPath : undefined;
}

export function resolveOutDir(projectRoot: string, arg?: string): string {
  if (arg) {
    return resolve(projectRoot, arg);
  }
  const project = loadProjectJson(projectRoot);
  if (typeof project.out_dir === 'string') return resolve(projectRoot, project.out_dir);
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

async function prepareRun(
  dataDir: string,
  modelId: string,
  client: V3ApiClient,
  configPath?: string,
): Promise<{
  descriptor: Awaited<ReturnType<V3ApiClient['getModel']>>;
  csvFiles: Array<{ dataset: string; path: string }>;
  config: Record<string, unknown>;
}> {
  const descriptor = await client.getModel(modelId);
  const config = loadRunConfig(configPath);
  const required = new Set(descriptor.datasets.filter((item) => item.required !== false).map((item) => item.name));
  const profileId = typeof config.profile_id === 'string' ? config.profile_id : undefined;
  const profile = profileId ? descriptor.profiles?.find((item) => item.id === profileId) : undefined;
  if (profileId && !profile) throw new Error(`Unknown profile: ${profileId}`);
  for (const dataset of profile?.required_datasets ?? []) required.add(dataset);
  const constraintConfig = (config.constraints && typeof config.constraints === 'object' ? config.constraints : {}) as Record<string, unknown>;
  const objectiveConfig = (config.objectives && typeof config.objectives === 'object' ? config.objectives : {}) as Record<string, any>;
  for (const term of [...(descriptor.constraints ?? []), ...(descriptor.objectives ?? [])]) {
    const profileConstraints = (profile as any)?.constraints ?? {};
    const profileObjectives = (profile as any)?.objectives ?? {};
    const active = term.id in constraintConfig
      ? constraintConfig[term.id] === true
      : term.id in objectiveConfig
        ? Boolean(objectiveConfig[term.id]?.enabled)
        : term.id in profileConstraints
          ? profileConstraints[term.id] === true
          : term.id in profileObjectives
            ? Boolean(profileObjectives[term.id]?.enabled)
            : (term as any).default_enabled !== false;
    if (active) for (const dataset of term.required_datasets ?? []) required.add(dataset);
  }
  const requiredDatasets = [...required];
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
  const diagnostics = validateDatasetFiles(descriptor, csvFiles);
  if (diagnostics.length) throw new DatasetValidationError(diagnostics);
  return { descriptor, csvFiles, config };
}

export interface V3DryRunManifest {
  dry_run: true;
  target: {
    backend: string;
    descriptor_endpoint: string;
    submission_endpoint: string;
  };
  request: {
    mode: 'validate' | 'solve';
    model_id: string;
    config: Record<string, unknown>;
    datasets: Array<{ dataset: string; path: string; bytes: number; sha256: string }>;
  };
  authentication: { mode: 'bearer' | 'anonymous'; credentials: 'redacted' | 'none' };
  network: {
    executed: Array<{ method: 'GET'; endpoint: string; purpose: string }>;
    not_executed: Array<{ method: 'POST'; endpoint: string; purpose: string }>;
  };
  expected_local_writes: string[];
}

export async function buildV3DryRun(options: {
  modelId: string;
  dataDir: string;
  configPath?: string;
  mode: 'validate' | 'solve';
  outDir?: string;
  session?: Session | null;
  userConfig: UserConfig;
}): Promise<V3DryRunManifest> {
  const client = new V3ApiClient(options.userConfig, options.session);
  const prepared = await prepareRun(options.dataDir, options.modelId, client, options.configPath);
  const descriptorEndpoint = `${options.userConfig.backendUrl}/v3/models/${encodeURIComponent(options.modelId)}`;
  const submissionEndpoint = `${options.userConfig.backendUrl}/v3/runs`;
  const expectedLocalWrites =
    options.mode === 'solve'
      ? prepared.descriptor.result_datasets.map((dataset) => {
          const filename = `${assertSafeName(dataset.name, 'result dataset name')}.csv`;
          return resolveOutputFile(options.outDir ?? resolve(process.cwd(), 'results'), filename);
        })
      : [];

  return {
    dry_run: true,
    target: {
      backend: options.userConfig.backendUrl,
      descriptor_endpoint: descriptorEndpoint,
      submission_endpoint: submissionEndpoint,
    },
    request: {
      mode: options.mode,
      model_id: options.modelId,
      config: prepared.config,
      datasets: prepared.csvFiles.map((file) => ({ dataset: file.dataset, ...inspectFile(file.path) })),
    },
    authentication: options.session?.accessToken
      ? { mode: 'bearer', credentials: 'redacted' }
      : { mode: 'anonymous', credentials: 'none' },
    network: {
      executed: [{ method: 'GET', endpoint: descriptorEndpoint, purpose: 'resolve model datasets' }],
      not_executed: [{ method: 'POST', endpoint: submissionEndpoint, purpose: 'submit datasets and configuration' }],
    },
    expected_local_writes: expectedLocalWrites,
  };
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
  return state === 'succeeded' || state === 'failed' || state === 'cancelled';
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function manifestId(manifest: Record<string, unknown>): string {
  const copy = { ...manifest }; delete copy.manifest_id;
  return createHash('sha256').update(canonicalJson(copy)).digest('hex');
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
    result: run.result,
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
  idempotencyKey?: string;
}): Promise<V3Run> {
  const client = new V3ApiClient(options.userConfig, options.session);
  const { csvFiles, config } = await prepareRun(
    options.dataDir,
    options.modelId,
    client,
    options.configPath,
  );
  const { run } = await client.createRun(
    {
      mode: options.mode,
      model_id: options.modelId,
      config,
    },
    csvFiles,
    options.idempotencyKey,
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
  const artifacts = (run.artifacts ?? []).map((artifact) => ({
    ...artifact,
    filename: assertSafeFilename(artifact.filename),
  }));
  const outputFiles = await downloadArtifactsAtomically(
    options.outDir,
    artifacts,
    (artifact) => client.downloadArtifact(run.run_id, artifact.artifact_id),
  );
  return { run, outputFiles };
}

/**
 * Download every artifact before exposing any result file to the caller.
 * A failed artifact request must not leave a partial result directory that an
 * agent could mistake for an authoritative solution.
 */
export async function downloadArtifactsAtomically<T extends { filename: string }>(
  outDir: string,
  artifacts: T[],
  download: (artifact: T) => Promise<string>,
): Promise<string[]> {
  const parent = dirname(outDir);
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(join(parent, `.${basename(outDir)}.fetch-`));
  try {
    const staged: Array<{ artifact: T; path: string }> = [];
    for (const artifact of artifacts) {
      const csv = await download(artifact);
      const path = resolveOutputFile(staging, artifact.filename);
      writeFileSync(path, csv, 'utf8');
      staged.push({ artifact, path });
    }

    mkdirSync(outDir, { recursive: true });
    const outputFiles: string[] = [];
    for (const { artifact, path } of staged) {
      const outPath = resolveOutputFile(outDir, artifact.filename);
      renameSync(path, outPath);
      outputFiles.push(outPath);
    }
    return outputFiles;
  } catch (error) {
    throw new Error(`artifact_unavailable: could not retrieve the complete result; no complete result was produced (${String(error)})`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
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
  const { csvFiles, config } = await prepareRun(
    options.dataDir,
    options.modelId,
    client,
    options.configPath,
  );

  const { run } = await client.createRun(
    {
      mode: 'validate',
      model_id: options.modelId,
      config,
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
  const { csvFiles, config } = await prepareRun(
    options.dataDir,
    options.modelId,
    client,
    options.configPath,
  );

  const { run } = await client.createRun(
    {
      mode: 'solve',
      model_id: options.modelId,
      config,
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
  const artifacts = (final.artifacts ?? []).map((artifact) => ({
    ...artifact,
    filename: assertSafeFilename(artifact.filename),
  }));
  mkdirSync(outDir, { recursive: true });
  const outputFiles: string[] = [];
  for (const artifact of artifacts) {
    const csv = await client.downloadArtifact(final.run_id, artifact.artifact_id);
    const outPath = resolveOutputFile(outDir, artifact.filename);
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

export async function scaffoldCanonicalProject(userConfig: UserConfig, modelId: string, profileId: string, targetDir: string, session?: Session | null): Promise<ProjectDocument> {
  const client = new V3ApiClient(userConfig, session); const descriptor = await client.getModel(modelId);
  const profile = (descriptor.profiles ?? []).find((p) => p.id === profileId); if ((descriptor.profiles?.length ?? 0) > 0 && !profile) throw new Error(`Unknown profile for model: ${profileId}`);
  mkdirSync(join(targetDir, 'data'), { recursive: true }); mkdirSync(join(targetDir, 'results'), { recursive: true });
  for (const dataset of descriptor.datasets) { const name = assertSafeName(dataset.name, 'dataset name'); const csv = await client.downloadTemplate(modelId, name); writeFileSync(resolveOutputFile(join(targetDir, 'data'), `${name}.csv`), csv, 'utf8'); }
  const project: ProjectDocument = { schema_version: 1, model_id: modelId, profile_id: profileId, data_dir: 'data', config_path: 'config.json', mapping_path: 'mapping.json', out_dir: 'results' };
  writeFileSync(join(targetDir, 'project.json'), JSON.stringify(project, null, 2) + '\n', 'utf8');
  const constraints = Object.fromEntries((descriptor.constraints ?? []).map((x) => [x.id, x.default_enabled ?? true]));
  const objectives = Object.fromEntries((descriptor.objectives ?? []).map((x) => [x.id, { enabled: x.default_enabled ?? true, weight: x.default_weight ?? 1 }]));
  writeFileSync(join(targetDir, 'config.json'), JSON.stringify({ profile_id: profileId, constraints, objectives, parameters: {}, solver: { max_time_in_seconds: 1, num_workers: 1, random_seed: 0, log_search_progress: false }, extras: {} }, null, 2) + '\n', 'utf8');
  writeFileSync(join(targetDir, 'mapping.json'), JSON.stringify({ schema_version: 1, rules: [] }, null, 2) + '\n', 'utf8');
  return project;
}
