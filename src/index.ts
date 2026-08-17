#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';

import { toAgentSpecBundle } from './agent-spec.js';
import {
  clearCredentials,
  loadSession,
  resolveBackendUrl,
  saveConfig,
  type UserConfig,
} from './auth.js';
import { loginWithBrowser, sessionSummary } from './login.js';
import { V3ApiClient } from './v3-client.js';
import { assertSafeName } from './security.js';
import {
  buildAsyncSubmitPayload,
  buildRunStatusPayload,
  buildV3DryRun,
  downloadV3RunArtifacts,
  formatV3Error,
  fetchV3RunStatus,
  isTerminalRunState,
  resolveConfigPath,
  resolveDataDir,
  resolveModelId,
  resolveOutDir,
  runV3Solve,
  runV3Validate,
  scaffoldV3Project,
  waitV3Run,
} from './v3-run.js';
import { VERSION } from './version.js';

const program = new Command();

program
  .name('smart-planner')
  .description('Optivise CLI: transparent optimization runs for AI agents')
  .version(VERSION);

function getClientContext(explicitBackendUrl?: string): {
  config: UserConfig;
  session: ReturnType<typeof loadSession>;
} {
  try {
    return {
      config: resolveBackendUrl(explicitBackendUrl),
      session: loadSession(),
    };
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(3);
  }
}

const modelsCmd = program.command('models').description('Discover immutable models and CSV templates');

modelsCmd
  .command('list')
  .description('List model revisions (GET /v3/models)')
  .option('--format <fmt>', 'json or text', 'text')
  .option('--all', 'Fetch all pages')
  .action(async (opts: { format: string; all?: boolean }) => {
    const { config, session } = getClientContext();
    const client = new V3ApiClient(config, session);
    const models = [];
    let cursor: string | undefined;
    do {
      const page = await client.listModels(cursor);
      models.push(...page.models);
      cursor = page.next_cursor ?? undefined;
    } while (opts.all && cursor);

    if (opts.format === 'json') {
      console.log(JSON.stringify({ models }, null, 2));
      return;
    }
    for (const model of models) {
      console.log(`${model.model_id}\t${model.name}`);
    }
  });

modelsCmd
  .command('get')
  .option('--model-id <id>', 'Immutable model_id (default: project.yaml)')
  .option('--format <fmt>', 'json or text', 'json')
  .description('Model descriptor (GET /v3/models/{model_id})')
  .action(async (opts: { modelId?: string; format: string }) => {
    const { config, session } = getClientContext();
    const projectRoot = process.cwd();
    const modelId = resolveModelId(projectRoot, opts.modelId);
    const client = new V3ApiClient(config, session);
    const descriptor = await client.getModel(modelId);
    if (opts.format === 'json') {
      console.log(JSON.stringify(descriptor, null, 2));
      return;
    }
    console.log(`${descriptor.name} (${descriptor.model_id})`);
    console.log(descriptor.description);
    for (const dataset of descriptor.datasets) {
      console.log(`dataset=${dataset.name}${dataset.required === false ? ' (optional)' : ''}`);
    }
  });

modelsCmd
  .command('template')
  .requiredOption('--model-id <id>', 'Immutable model_id')
  .requiredOption('--dataset <name>', 'Dataset name')
  .option('--out <path>', 'Output CSV path')
  .description('Download one CSV template')
  .action(async (opts: { modelId: string; dataset: string; out?: string }) => {
    const dataset = assertSafeName(opts.dataset, 'dataset name');
    const { config, session } = getClientContext();
    const client = new V3ApiClient(config, session);
    const csv = await client.downloadTemplate(opts.modelId, dataset);
    const outPath = opts.out ?? `${dataset}.csv`;
    writeFileSync(outPath, csv, 'utf8');
    console.log(outPath);
  });

program
  .command('spec')
  .option('--model-id <id>', 'Immutable model_id (default: project.yaml)')
  .option('--format <fmt>', 'json or text', 'json')
  .description('Agent-readable spec from server model descriptor')
  .action(async (opts: { modelId?: string; format: string }) => {
    const { config, session } = getClientContext();
    const projectRoot = process.cwd();
    const modelId = resolveModelId(projectRoot, opts.modelId);
    const client = new V3ApiClient(config, session);
    const bundle = toAgentSpecBundle(await client.getModel(modelId));
    if (opts.format === 'json') {
      console.log(JSON.stringify(bundle, null, 2));
      return;
    }
    console.log(`${bundle.name} (${bundle.model_id})`);
    console.log(String(bundle.description));
    for (const dataset of bundle.datasets as Array<{ name: string; csv_filename: string }>) {
      console.log(`- ${dataset.name} → ${dataset.csv_filename}`);
    }
  });

program
  .command('init')
  .requiredOption('--model-id <id>', 'Immutable model_id')
  .argument('[dir]', 'Project directory', '.')
  .description('Download CSV templates and scaffold project.yaml + config.json')
  .action(async (dir: string, opts: { modelId: string }) => {
    const { config, session } = getClientContext();
    const target = resolve(process.cwd(), dir);
    await scaffoldV3Project(config, opts.modelId, target, session);
    console.log(`Created project at ${target}`);
    console.log(`model_id=${opts.modelId}`);
    console.log('Next: edit data/*.csv, then validate / solve');
  });

program
  .command('validate')
  .option('--model-id <id>', 'Immutable model_id (default: project.yaml)')
  .option('--data-dir <path>', 'Directory of <dataset>.csv files (default: data/)')
  .option('--config <path>', 'config.json path (default: project.yaml defaultConfig)')
  .option('--format <fmt>', 'json or text', 'text')
  .option('--verbose', 'Log run_id and phase progress to stderr')
  .option('--dry-run', 'Inspect the exact request without submitting or writing files')
  .option('--async', 'Submit run and return immediately with run_id (poll with runs status/wait)')
  .option('--wait-timeout <sec>', 'Max seconds to wait when not using --async', parseWaitTimeout)
  .description('Validate CSV datasets (POST /v3/runs mode=validate)')
  .action(async (opts: {
    modelId?: string;
    dataDir?: string;
    config?: string;
    format: string;
    verbose?: boolean;
    dryRun?: boolean;
    async?: boolean;
    waitTimeout?: number;
  }) => {
    const { config, session } = getClientContext();
    const projectRoot = process.cwd();
    const modelId = resolveModelId(projectRoot, opts.modelId);
    const dataDir = resolveDataDir(projectRoot, opts.dataDir);
    const configPath = resolveConfigPath(projectRoot, opts.config);
    if (opts.dryRun) {
      console.log(
        JSON.stringify(
          await buildV3DryRun({
            modelId,
            dataDir,
            configPath,
            mode: 'validate',
            session,
            userConfig: config,
          }),
          null,
          2,
        ),
      );
      return;
    }
    const result = await runV3Validate({
      projectRoot,
      modelId,
      dataDir,
      configPath,
      session,
      userConfig: config,
      verbose: opts.verbose,
      async: opts.async,
      waitTimeoutSec: opts.waitTimeout,
    });
    if (opts.async && result.run) {
      const payload = buildAsyncSubmitPayload(result.run, 'validate');
      if (opts.format === 'json') {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Submitted validate run_id=${result.run_id} state=${result.state}`);
        console.log(`Poll: smart-planner runs status --run-id ${result.run_id}`);
      }
      return;
    }
    if (opts.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.valid) {
      console.log('Validation passed');
      console.log(`run_id=${result.run_id}`);
    } else {
      for (const err of result.errors) {
        console.error(formatV3Error(err));
      }
    }
    process.exitCode = result.valid ? 0 : 1;
  });

program
  .command('solve')
  .option('--model-id <id>', 'Immutable model_id (default: project.yaml)')
  .option('--data-dir <path>', 'Directory of <dataset>.csv files (default: data/)')
  .option('--config <path>', 'config.json path')
  .option('--out-dir <path>', 'Directory for result CSV artifacts (default: results/)')
  .option('--format <fmt>', 'json or text', 'text')
  .option('--verbose', 'Log run_id and phase progress to stderr')
  .option('--dry-run', 'Inspect the exact request and expected writes without submitting')
  .option('--async', 'Submit solve and return immediately with run_id (poll with runs status/wait/download)')
  .option('--wait-timeout <sec>', 'Max seconds to wait when not using --async', parseWaitTimeout)
  .description('Solve and download result CSVs (POST /v3/runs mode=solve)')
  .action(async (opts: {
    modelId?: string;
    dataDir?: string;
    config?: string;
    outDir?: string;
    format: string;
    verbose?: boolean;
    dryRun?: boolean;
    async?: boolean;
    waitTimeout?: number;
  }) => {
    const { config, session } = getClientContext();
    const projectRoot = process.cwd();
    const modelId = resolveModelId(projectRoot, opts.modelId);
    const dataDir = resolveDataDir(projectRoot, opts.dataDir);
    const configPath = resolveConfigPath(projectRoot, opts.config);
    const outDir = resolveOutDir(projectRoot, opts.outDir);
    if (opts.dryRun) {
      console.log(
        JSON.stringify(
          await buildV3DryRun({
            modelId,
            dataDir,
            configPath,
            mode: 'solve',
            outDir,
            session,
            userConfig: config,
          }),
          null,
          2,
        ),
      );
      return;
    }
    const { run, outputFiles, asyncSubmitted } = await runV3Solve({
      projectRoot,
      modelId,
      dataDir,
      configPath,
      outDir: opts.outDir,
      session,
      userConfig: config,
      verbose: opts.verbose,
      async: opts.async,
      waitTimeoutSec: opts.waitTimeout,
    });

    if (asyncSubmitted) {
      const payload = buildAsyncSubmitPayload(run, 'solve');
      if (opts.format === 'json') {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Submitted solve run_id=${run.run_id} state=${run.state}`);
        console.log(`Poll: smart-planner runs status --run-id ${run.run_id}`);
      }
      return;
    }

    if (opts.format === 'json') {
      console.log(JSON.stringify({ run, output_files: outputFiles }, null, 2));
      return;
    }

    console.log('Solve finished');
    console.log(`model_id=${run.model_id} state=${run.state}`);
    if (run.summary) {
      console.log(JSON.stringify(run.summary));
    }
    for (const file of outputFiles) {
      console.log(`artifact=${file}`);
    }
  });

const runsCmd = program.command('runs').description('Poll and download asynchronous /v3/runs');

runsCmd
  .command('status')
  .requiredOption('--run-id <id>', 'Run id returned by validate/solve --async')
  .option('--format <fmt>', 'json or text', 'json')
  .description('Fetch current run state once (GET /v3/runs/{run_id})')
  .action(async (opts: { runId: string; format: string }) => {
    const { config, session } = getClientContext();
    const { run, retryAfterMs } = await fetchV3RunStatus({
      runId: opts.runId,
      session,
      userConfig: config,
    });
    const payload = buildRunStatusPayload(run, {
      timed_out: false,
      retry_after_seconds: retryAfterMs == null ? null : Math.ceil(retryAfterMs / 1000),
      next_wait_command: `smart-planner runs wait --run-id ${run.run_id} --timeout 60 --format json`,
      next_download_command:
        run.mode === 'solve' && run.state === 'succeeded'
          ? `smart-planner runs download --run-id ${run.run_id} --out-dir ./out --format json`
          : undefined,
    });
    if (opts.format === 'json') {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`${run.run_id}\t${run.state}\t${run.phase}\t${run.progress}`);
    if (!isTerminalRunState(run.state)) {
      process.exitCode = 2;
    } else if (run.state === 'failed') {
      process.exitCode = 1;
    }
  });

runsCmd
  .command('wait')
  .requiredOption('--run-id <id>', 'Run id to poll until terminal or timeout')
  .option('--timeout <sec>', 'Max seconds to wait (0 = single status check)', parseWaitTimeout, 60)
  .option('--format <fmt>', 'json or text', 'json')
  .option('--verbose', 'Log phase progress to stderr')
  .description('Poll run until succeeded/failed or timeout')
  .action(async (opts: { runId: string; timeout: number; format: string; verbose?: boolean }) => {
    const { config, session } = getClientContext();
    const { run, timedOut } = await waitV3Run({
      runId: opts.runId,
      session,
      userConfig: config,
      timeoutSec: opts.timeout,
      verbose: opts.verbose,
    });
    const payload = buildRunStatusPayload(run, {
      timed_out: timedOut,
      next_status_command: `smart-planner runs status --run-id ${run.run_id} --format json`,
      next_download_command:
        run.mode === 'solve' && run.state === 'succeeded'
          ? `smart-planner runs download --run-id ${run.run_id} --out-dir ./out --format json`
          : undefined,
    });
    if (opts.format === 'json') {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`${run.run_id}\t${run.state}\t${run.phase}\t${run.progress}`);
      if (timedOut) {
        console.log('Still in progress — check again later.');
      }
    }
    if (timedOut) {
      process.exitCode = 2;
    } else if (run.state === 'failed') {
      process.exitCode = 1;
    }
  });

runsCmd
  .command('download')
  .requiredOption('--run-id <id>', 'Succeeded solve run id')
  .option('--out-dir <path>', 'Directory for result CSV artifacts', './out')
  .option('--format <fmt>', 'json or text', 'json')
  .description('Download artifacts for a succeeded solve run')
  .action(async (opts: { runId: string; outDir: string; format: string }) => {
    const { config, session } = getClientContext();
    const outDir = resolve(process.cwd(), opts.outDir);
    const { run, outputFiles } = await downloadV3RunArtifacts({
      runId: opts.runId,
      outDir,
      session,
      userConfig: config,
    });
    if (opts.format === 'json') {
      console.log(JSON.stringify({ run, output_files: outputFiles }, null, 2));
      return;
    }
    for (const file of outputFiles) {
      console.log(`artifact=${file}`);
    }
  });

function parseWaitTimeout(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid timeout seconds: ${value}`);
  }
  return parsed;
}

program
  .command('login')
  .requiredOption('--backend-url <url>', 'Optivise backend URL')
  .option('--local-dev', 'Skip browser and authorize local test account (dev only)')
  .description('Open browser sign-in and save a local bearer session')
  .action(async (opts: { backendUrl: string; localDev?: boolean }) => {
    const config = resolveBackendUrl(opts.backendUrl);
    saveConfig(config);
    const session = await loginWithBrowser(config, { localDev: opts.localDev });
    console.log('Logged in');
    console.log(`principal_id=${session.principalId}`);
    if (session.email) {
      console.log(`email=${session.email}`);
    }
  });

program
  .command('whoami')
  .description('Print current principal (logged in) or anonymous')
  .action(() => {
    const session = loadSession();
    console.log(sessionSummary(session));
    if (session?.email) {
      console.log(`email=${session.email}`);
    }
    if (!session) {
      console.log('mode=anonymous');
    }
  });

program
  .command('logout')
  .description('Clear the saved session and remove legacy identity credentials')
  .action(() => {
    clearCredentials();
    console.log('Signed out');
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
