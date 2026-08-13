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
  resolveExcelPath,
  resolveTemplateId,
  runTemplateSolve,
  runValidate,
} from './template-solve.js';

const program = new Command();

program.name('smart-planner').description('Smart Planner CLI').version('0.2.0');

const templatesCmd = program.command('templates').description('Built-in problem templates');

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
  .requiredOption('--template <id>', 'Template id')
  .requiredOption('--excel <path>', 'Excel input path')
  .option('--config <path>', 'supplemental.yaml path')
  .option('--format <fmt>', 'json or text', 'text')
  .action(async (opts: { template: string; excel: string; config?: string; format: string }) => {
    const projectRoot = process.cwd();
    const result = await runValidate({
      projectRoot,
      templateId: opts.template,
      excelPath: resolve(projectRoot, opts.excel),
      configPath: opts.config ? resolve(projectRoot, opts.config) : resolveConfigPath(projectRoot, opts.template, opts.config),
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
  .requiredOption('--template <id>', 'Template id')
  .argument('[dir]', 'Project directory', '.')
  .description('Scaffold project.yaml and sample data for a template')
  .action(async (dir: string, opts: { template: string }) => {
    const target = resolve(process.cwd(), dir);
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
  .option('--template <id>', 'Template id (or project.yaml template_id)')
  .requiredOption('--excel <path>', 'Excel input path')
  .option('--config <path>', 'supplemental.yaml path')
  .option('--local', 'Solve cp_sat templates locally with WASM')
  .option('--verbose', 'Verbose logging')
  .description('Validate, solve, and write results to Excel')
  .action(async (opts: {
    template?: string;
    excel: string;
    config?: string;
    local?: boolean;
    verbose?: boolean;
  }) => {
    const projectRoot = process.cwd();
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
