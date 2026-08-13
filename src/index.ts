#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'node:path';
import {
  getTemplateSpec,
  listTemplateSpecs,
  toAgentSpecBundle,
} from '@smart-planner/adapter-sdk';

import { ApiClient } from './api-client.js';
import {
  deleteIdentity,
  generateIdentity,
  loadConfig,
  loadIdentity,
  saveConfig,
  saveIdentity,
} from './auth.js';
import { scaffoldTemplateProject } from './init-template.js';
import {
  resolveConfigPath,
  resolveTemplateId,
  runTemplateSolve,
  runValidate,
} from './template-solve.js';
import { V3ApiClient } from './v3-client.js';
import {
  formatV3Error,
  resolveDataDir,
  resolveModelId,
  runV3Solve,
  runV3Validate,
  scaffoldV3Project,
} from './v3-run.js';

const program = new Command();

program.name('smart-planner').description('Smart Planner CLI').version('0.2.0');

const modelsCmd = program.command('models').description('Problem-agnostic v3 models (server)');

modelsCmd
  .command('list')
  .description('List immutable model revisions from GET /v3/models')
  .option('--format <fmt>', 'Output format: json or text', 'text')
  .action(async (opts: { format: string }) => {
    const config = loadConfig();
    if (!config) {
      console.error('Run: smart-planner login --backend-url <url>');
      process.exit(3);
    }
    const identity = loadIdentity() ?? undefined;
    const client = new V3ApiClient(config, identity);
    const payload = await client.listModels();
    if (opts.format === 'json') {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    for (const model of payload.models) {
      console.log(`${model.model_id}\t${model.name}`);
    }
  });

modelsCmd
  .command('get')
  .requiredOption('--model-id <id>', 'Immutable model_id')
  .option('--format <fmt>', 'json or text', 'json')
  .description('Get model descriptor from GET /v3/models/{model_id}')
  .action(async (opts: { modelId: string; format: string }) => {
    const config = loadConfig();
    if (!config) {
      console.error('Run: smart-planner login --backend-url <url>');
      process.exit(3);
    }
    const identity = loadIdentity() ?? undefined;
    const client = new V3ApiClient(config, identity);
    const descriptor = await client.getModel(opts.modelId);
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
    const config = loadConfig();
    if (!config) {
      console.error('Run: smart-planner login --backend-url <url>');
      process.exit(3);
    }
    const identity = loadIdentity() ?? undefined;
    const client = new V3ApiClient(config, identity);
    const csv = await client.downloadTemplate(opts.modelId, opts.dataset);
    const outPath = opts.out ?? `${opts.dataset}.csv`;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outPath, csv, 'utf8');
    console.log(outPath);
  });

const templatesCmd = program.command('templates').description('Built-in problem templates (local)');

templatesCmd
  .command('list')
  .description('List templates')
  .option('--format <fmt>', 'Output format: json or text', 'text')
  .action((opts: { format: string }) => {
    const specs = listTemplateSpecs();
    if (opts.format === 'json') {
      console.log(
        JSON.stringify(
          specs.map((s) => ({
            template_id: s.template_id,
            display_name: s.display_name,
            silo: s.silo,
            solve_ready: s.solve_ready,
            requires_yaml: s.requires_yaml,
          })),
          null,
          2,
        ),
      );
      return;
    }
    for (const s of specs) {
      const flag = s.solve_ready ? 'ready' : 'preview';
      console.log(`${s.template_id}\t[${flag}]\t${s.display_name} (${s.silo})`);
    }
  });

program
  .command('spec')
  .requiredOption('--template <id>', 'Template id')
  .option('--format <fmt>', 'json or text', 'json')
  .description('Agent-readable spec: schema, questions, examples, validate rules')
  .action((opts: { template: string; format: string }) => {
    const spec = getTemplateSpec(opts.template);
    const bundle = toAgentSpecBundle(spec);
    if (opts.format === 'json') {
      console.log(JSON.stringify(bundle, null, 2));
      return;
    }
    console.log(`${bundle.display_name} (${bundle.template_id})`);
    console.log(bundle.description);
    console.log(`silo=${bundle.silo} solve_ready=${bundle.solve_ready}`);
    for (const q of bundle.clarification_questions) {
      console.log(`- [${q.id}] ${q.prompt}`);
    }
  });

program
  .command('validate')
  .option('--model-id <id>', 'Immutable v3 model_id (remote CSV validation)')
  .option('--data-dir <path>', 'Directory of <dataset>.csv files for v3')
  .option('--template <id>', 'Local template id (Excel workflow)')
  .option('--excel <path>', 'Excel input path (local template workflow)')
  .option('--config <path>', 'config.json for v3 or supplemental.yaml for templates')
  .option('--format <fmt>', 'json or text', 'text')
  .option('--verbose', 'Verbose logging')
  .description('Validate inputs locally (template) or remotely via POST /v3/runs mode=validate')
  .action(async (opts: {
    modelId?: string;
    dataDir?: string;
    template?: string;
    excel?: string;
    config?: string;
    format: string;
    verbose?: boolean;
  }) => {
    const projectRoot = process.cwd();

    if (opts.modelId || opts.dataDir) {
      const config = loadConfig();
      if (!config) {
        console.error('v3 validate requires: smart-planner login --backend-url <url>');
        process.exit(3);
      }
      const modelId = resolveModelId(projectRoot, opts.modelId);
      const dataDir = resolveDataDir(projectRoot, opts.dataDir);
      const result = await runV3Validate({
        projectRoot,
        modelId,
        dataDir,
        configPath: opts.config ? resolve(projectRoot, opts.config) : undefined,
        identity: loadIdentity() ?? undefined,
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
    }

    if (!opts.template || !opts.excel) {
      console.error('Use --model-id --data-dir for v3, or --template --excel for local templates');
      process.exit(2);
    }

    const result = await runValidate({
      projectRoot,
      templateId: opts.template,
      excelPath: resolve(projectRoot, opts.excel),
      configPath: opts.config
        ? resolve(projectRoot, opts.config)
        : resolveConfigPath(projectRoot, opts.template, opts.config),
    });
    if (opts.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.valid) {
      console.log('Validation passed');
    } else {
      for (const err of result.errors) {
        console.error(`${err.path}: ${err.message}`);
      }
    }
    process.exit(result.valid ? 0 : 1);
  });

program
  .command('init')
  .option('--model-id <id>', 'Immutable v3 model_id (download CSV templates from server)')
  .option('--template <id>', 'Built-in local template id')
  .argument('[dir]', 'Project directory', '.')
  .description('Scaffold project from v3 model or built-in template')
  .action(async (dir: string, opts: { modelId?: string; template?: string }) => {
    const target = resolve(process.cwd(), dir);
    if (opts.modelId) {
      const config = loadConfig();
      if (!config) {
        console.error('v3 init requires: smart-planner login --backend-url <url>');
        process.exit(3);
      }
      await scaffoldV3Project(config, opts.modelId, target, loadIdentity() ?? undefined);
      console.log(`Created v3 project at ${target}`);
      console.log(`model_id=${opts.modelId}`);
      console.log('Next: edit data/*.csv, then validate / solve');
      return;
    }
    if (!opts.template) {
      console.error('Provide --model-id or --template');
      process.exit(2);
    }
    await scaffoldTemplateProject(opts.template, target);
    console.log(`Created template project at ${target}`);
    console.log(`template_id=${opts.template}`);
    console.log('Next: smart-planner validate / smart-planner solve');
  });

program
  .command('login')
  .requiredOption('--backend-url <url>', 'Smart Planner backend URL')
  .description('Generate identity and register with backend')
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
  .description('Print local client_id')
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

program
  .command('solve')
  .option('--model-id <id>', 'Immutable v3 model_id (remote CSV solve)')
  .option('--data-dir <path>', 'Directory of <dataset>.csv files for v3')
  .option('--out-dir <path>', 'Directory for downloaded result CSV artifacts')
  .option('--template <id>', 'Template id (or project.yaml template_id)')
  .option('--excel <path>', 'Excel input path (local template workflow)')
  .option('--config <path>', 'config.json for v3 or supplemental.yaml for templates')
  .option('--local', 'Solve cp_sat templates locally with WASM')
  .option('--verbose', 'Verbose logging')
  .description('Validate and solve via v3 CSV runs or legacy template workflow')
  .action(async (opts: {
    modelId?: string;
    dataDir?: string;
    outDir?: string;
    template?: string;
    excel?: string;
    config?: string;
    local?: boolean;
    verbose?: boolean;
  }) => {
    const projectRoot = process.cwd();

    if (opts.modelId || opts.dataDir) {
      const config = loadConfig();
      if (!config) {
        console.error('v3 solve requires: smart-planner login --backend-url <url>');
        process.exit(3);
      }
      const modelId = resolveModelId(projectRoot, opts.modelId);
      const dataDir = resolveDataDir(projectRoot, opts.dataDir);
      const { run, outputFiles } = await runV3Solve({
        projectRoot,
        modelId,
        dataDir,
        configPath: opts.config ? resolve(projectRoot, opts.config) : undefined,
        outDir: opts.outDir,
        identity: loadIdentity() ?? undefined,
        userConfig: config,
        verbose: opts.verbose,
      });
      console.log('Solve finished');
      console.log(`model_id=${modelId} state=${run.state}`);
      if (run.summary) {
        console.log(JSON.stringify(run.summary));
      }
      for (const file of outputFiles) {
        console.log(`artifact=${file}`);
      }
      return;
    }

    if (!opts.excel) {
      console.error('Use --model-id --data-dir for v3, or --template --excel for local templates');
      process.exit(2);
    }

    const templateId = resolveTemplateId(projectRoot, opts.template);
    const identity = loadIdentity();
    const config = loadConfig();
    const spec = getTemplateSpec(templateId);

    if (!opts.local && spec.silo === 'cp_sat' && (!identity || !config)) {
      console.error('Remote solve requires login or use --local');
      process.exit(3);
    }
    if (spec.silo === 'pyjobshop' && (!identity || !config)) {
      console.error('PyJobShop templates require: smart-planner login --backend-url <url>');
      process.exit(3);
    }

    const result = await runTemplateSolve({
      projectRoot,
      templateId,
      excelPath: resolve(projectRoot, opts.excel),
      configPath: opts.config
        ? resolve(projectRoot, opts.config)
        : resolveConfigPath(projectRoot, templateId, opts.config),
      local: opts.local,
      identity: identity ?? undefined,
      userConfig: config ?? undefined,
      verbose: opts.verbose,
    });

    console.log('Solve finished');
    console.log(`template=${templateId} status=${result.status} feasible=${result.feasible}`);
    if (result.objective != null) {
      console.log(`objective=${result.objective}`);
    }
    console.log(`excel=${resolve(projectRoot, opts.excel)}`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
