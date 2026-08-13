#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';

import { toAgentSpecBundle } from './agent-spec.js';
import { ApiClient } from './api-client.js';
import {
  deleteIdentity,
  generateIdentity,
  loadConfig,
  loadIdentity,
  saveConfig,
  saveIdentity,
  type Identity,
  type UserConfig,
} from './auth.js';
import { V3ApiClient } from './v3-client.js';
import {
  formatV3Error,
  resolveConfigPath,
  resolveDataDir,
  resolveModelId,
  resolveOutDir,
  runV3Solve,
  runV3Validate,
  scaffoldV3Project,
} from './v3-run.js';

const program = new Command();

program
  .name('smart-planner')
  .description('Smart Planner CLI — CSV datasets, immutable models, /v3 runs')
  .version('0.3.0');

function requireBackend(): { config: UserConfig; identity: Identity | undefined } {
  const config = loadConfig();
  if (!config) {
    console.error('Not configured. Run: smart-planner login --backend-url <url>');
    process.exit(3);
  }
  return { config, identity: loadIdentity() ?? undefined };
}

const modelsCmd = program.command('models').description('Discover immutable models and CSV templates');

modelsCmd
  .command('list')
  .description('List model revisions (GET /v3/models)')
  .option('--format <fmt>', 'json or text', 'text')
  .option('--all', 'Fetch all pages')
  .action(async (opts: { format: string; all?: boolean }) => {
    const { config, identity } = requireBackend();
    const client = new V3ApiClient(config, identity);
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
    const { config, identity } = requireBackend();
    const projectRoot = process.cwd();
    const modelId = resolveModelId(projectRoot, opts.modelId);
    const client = new V3ApiClient(config, identity);
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
    const { config, identity } = requireBackend();
    const client = new V3ApiClient(config, identity);
    const csv = await client.downloadTemplate(opts.modelId, opts.dataset);
    const outPath = opts.out ?? `${opts.dataset}.csv`;
    writeFileSync(outPath, csv, 'utf8');
    console.log(outPath);
  });

program
  .command('spec')
  .option('--model-id <id>', 'Immutable model_id (default: project.yaml)')
  .option('--format <fmt>', 'json or text', 'json')
  .description('Agent-readable spec from server model descriptor')
  .action(async (opts: { modelId?: string; format: string }) => {
    const { config, identity } = requireBackend();
    const projectRoot = process.cwd();
    const modelId = resolveModelId(projectRoot, opts.modelId);
    const client = new V3ApiClient(config, identity);
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
    const { config, identity } = requireBackend();
    const target = resolve(process.cwd(), dir);
    await scaffoldV3Project(config, opts.modelId, target, identity);
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
  .description('Validate CSV datasets (POST /v3/runs mode=validate)')
  .action(async (opts: {
    modelId?: string;
    dataDir?: string;
    config?: string;
    format: string;
    verbose?: boolean;
  }) => {
    const { config, identity } = requireBackend();
    const projectRoot = process.cwd();
    const result = await runV3Validate({
      projectRoot,
      modelId: resolveModelId(projectRoot, opts.modelId),
      dataDir: resolveDataDir(projectRoot, opts.dataDir),
      configPath: resolveConfigPath(projectRoot, opts.config),
      identity,
      userConfig: config,
      verbose: opts.verbose,
    });
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
    process.exit(result.valid ? 0 : 1);
  });

program
  .command('solve')
  .option('--model-id <id>', 'Immutable model_id (default: project.yaml)')
  .option('--data-dir <path>', 'Directory of <dataset>.csv files (default: data/)')
  .option('--config <path>', 'config.json path')
  .option('--out-dir <path>', 'Directory for result CSV artifacts (default: results/)')
  .option('--format <fmt>', 'json or text', 'text')
  .option('--verbose', 'Log run_id and phase progress to stderr')
  .description('Solve and download result CSVs (POST /v3/runs mode=solve)')
  .action(async (opts: {
    modelId?: string;
    dataDir?: string;
    config?: string;
    outDir?: string;
    format: string;
    verbose?: boolean;
  }) => {
    const { config, identity } = requireBackend();
    const projectRoot = process.cwd();
    const { run, outputFiles } = await runV3Solve({
      projectRoot,
      modelId: resolveModelId(projectRoot, opts.modelId),
      dataDir: resolveDataDir(projectRoot, opts.dataDir),
      configPath: resolveConfigPath(projectRoot, opts.config),
      outDir: opts.outDir,
      identity,
      userConfig: config,
      verbose: opts.verbose,
    });

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

program
  .command('login')
  .requiredOption('--backend-url <url>', 'Smart Planner backend URL')
  .description('Save backend URL and register CLI identity')
  .action(async (opts: { backendUrl: string }) => {
    saveConfig({ backendUrl: opts.backendUrl });
    let identity = loadIdentity();
    if (!identity) {
      identity = generateIdentity();
      saveIdentity(identity);
    }
    const client = new ApiClient({ backendUrl: opts.backendUrl }, identity);
    await client.register();
    console.log('Logged in');
    console.log(`client_id=${identity.clientId}`);
  });

program
  .command('whoami')
  .description('Print local client_id (Bearer token for v3 when auth is enabled)')
  .action(() => {
    const identity = loadIdentity();
    if (!identity) {
      console.error('Not logged in. Run: smart-planner login --backend-url <url>');
      process.exit(1);
    }
    console.log(identity.clientId);
  });

program
  .command('logout')
  .description('Delete local identity file')
  .action(() => {
    deleteIdentity();
    console.log('Local identity removed');
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
