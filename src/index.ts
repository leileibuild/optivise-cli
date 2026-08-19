#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { toAgentSpecBundle } from './agent-spec.js';
import { clearCredentials, loadSession, resolveBackendUrl, saveConfig, type UserConfig } from './auth.js';
import { loginWithBrowser, sessionSummary } from './login.js';
import { V3ApiClient } from './v3-client.js';
import { inspectFile } from './security.js';
import { applyMapping, loadMapping, saveCsv } from './mapping.js';
import { validateDatasetFiles } from './dataset-validation.js';
import { cleanupStore, listRuns, loadManifest, recordRun, saveManifest } from './local-store.js';
import { buildRunStatusPayload, buildV3DryRun, downloadV3RunArtifacts, fetchV3RunStatus, loadProjectJson, loadRunConfig, manifestId, resolveConfigPath, resolveDataDir, resolveModelId, resolveOutDir, runV3Validate, scaffoldCanonicalProject, submitV3Run, waitV3Run } from './v3-run.js';
import { VERSION } from './version.js';
import { doctorSkill, installSkill, parseSkillTarget } from './skill.js';

const program = new Command();
program.name('optivise').description('Optivise CLI: deterministic optimization runs for AI agents').version(VERSION);
program.addHelpText('after', `\nAgent setup: after installing this package, run `
  + '`optivise setup --target workpartner` (or `codex`) to install and verify the full skill bundle.\n');
function ctx(explicit?: string): { config: UserConfig; session: ReturnType<typeof loadSession> } { cleanupStore(); return { config: resolveBackendUrl(explicit), session: loadSession() }; }
function out(value: unknown, format = 'json'): void { if (format === 'text') console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2)); else console.log(JSON.stringify(value, null, 2)); }
async function resolveModelReference(client: V3ApiClient, reference: string): Promise<string> { if (reference.includes('@sha256:')) return reference; const listed = await client.listModels(); const match = listed.models.find((item) => item.family === reference || item.model_id === reference); if (!match) throw new Error(`Unknown model family or immutable model: ${reference}`); return match.model_id; }
function assertV3Config(value: Record<string, unknown>): void { if ('weights' in value) throw new Error('Legacy top-level weights are not supported; configure objectives.<id>.weight'); const objectives = value.objectives; if (objectives != null && (typeof objectives !== 'object' || Array.isArray(objectives))) throw new Error('objectives must be an object of {enabled, weight}'); if (objectives && typeof objectives === 'object') for (const [id, item] of Object.entries(objectives as Record<string, any>)) { if (!item || typeof item !== 'object' || typeof item.enabled !== 'boolean' || !Number.isFinite(Number(item.weight)) || Number(item.weight) <= 0) throw new Error(`Invalid objective configuration: ${id}`); } }
function parseRunMode(value: string): 'validate' | 'solve' { if (value !== 'validate' && value !== 'solve') throw new InvalidArgumentError("must be 'validate' or 'solve'; there is no local mode"); return value; }

program.command('describe-models').option('--backend-url <url>').option('--format <format>', 'json|text', 'json').option('--all').action(async (o) => { const { config, session } = ctx(o.backendUrl); const all: unknown[] = []; let cursor: string | undefined; do { const page = await new V3ApiClient(config, session).listModels(cursor); all.push(...page.models); cursor = page.next_cursor ?? undefined; } while (o.all && cursor); out({ models: all }, o.format); });
program.command('model-info').requiredOption('--model <id>').option('--backend-url <url>').option('--format <format>', 'json|text', 'json').action(async (o) => { const { config, session } = ctx(o.backendUrl); const client = new V3ApiClient(config, session); out(await client.getModel(await resolveModelReference(client, o.model)), o.format); });
program.command('schema-template').requiredOption('--model <id>').requiredOption('--dataset <name>').option('--out <path>').option('--backend-url <url>').action(async (o) => { const { config, session } = ctx(o.backendUrl); const csv = await new V3ApiClient(config, session).downloadTemplate(o.model, o.dataset); const path = resolve(o.out ?? `${o.dataset}.csv`); writeFileSync(path, csv); out({ path }); });
program.command('scaffold').requiredOption('--model <id>').requiredOption('--profile <profile>').requiredOption('--project <dir>').option('--backend-url <url>').action(async (o) => { const { config, session } = ctx(o.backendUrl); out({ project: await scaffoldCanonicalProject(config, o.model, o.profile, resolve(o.project), session) }); });
program.command('convert').requiredOption('--project <dir>').requiredOption('--input <path>').requiredOption('--mapping <path>').action((o) => { const doc = loadMapping(resolve(o.mapping)); const inputPath = resolve(o.input); const input = readFileSync(inputPath, 'utf8'); const format = inputPath.toLowerCase().endsWith('.json') ? 'json' : 'csv'; const outputs: string[] = []; for (const rule of doc.rules) { if (doc.rules.length > 1 && resolve(rule.source) !== inputPath) continue; const target = join(resolve(o.project), 'data', `${rule.target_dataset}.csv`); mkdirSync(resolve(o.project, 'data'), { recursive: true }); saveCsv(target, applyMapping(input, rule, format)); outputs.push(target); } if (!outputs.length) throw new Error(`Mapping has no rule for input: ${inputPath}`); out({ outputs }); });
program.command('save-profile').requiredOption('--project <dir>').requiredOption('--name <name>').action((o) => { const projectRoot = resolve(o.project); const root = process.env.OPTIVISE_HOME ?? join(process.env.HOME ?? '.', '.optivise'); const p = join(root, 'profiles', o.name, 'profile.json'); mkdirSync(resolve(p, '..'), { recursive: true }); const project = loadProjectJson(projectRoot); const configPath = resolveConfigPath(projectRoot); writeFileSync(p, JSON.stringify({ name: o.name, model_id: project.model_id, profile_id: project.profile_id, config: configPath ? loadRunConfig(configPath) : {}, project: projectRoot, saved_at: new Date().toISOString() }, null, 2) + '\n'); out({ name: o.name, path: p }); });
program.command('lint').requiredOption('--project <dir>').option('--format <format>', 'json|text', 'json').option('--backend-url <url>').action(async (o) => { const root = resolve(o.project); const p = loadProjectJson(root); const diagnostics: Array<Record<string, unknown>> = []; for (const file of ['project.json', 'config.json', 'mapping.json']) if (!existsSync(join(root, file))) diagnostics.push({ code: 'missing_file', file }); if (!p.model_id) diagnostics.push({ code: 'missing_model_id' }); try { const c = loadRunConfig(resolveConfigPath(root)); assertV3Config(c); const { config, session } = ctx(o.backendUrl); const descriptor = p.model_id ? await new V3ApiClient(config, session).getModel(p.model_id) : null; if (descriptor) { const ids = new Set([...descriptor.constraints.map((x) => x.id), ...descriptor.objectives.map((x) => x.id)]); for (const id of Object.keys((c.constraints ?? {}) as object)) if (!ids.has(id)) diagnostics.push({ code: 'unknown_term', id }); for (const id of Object.keys((c.objectives ?? {}) as object)) if (!ids.has(id)) diagnostics.push({ code: 'unknown_term', id }); const profile = typeof c.profile_id === 'string' ? descriptor.profiles?.find((x) => x.id === c.profile_id) : undefined; if (c.profile_id && !profile) diagnostics.push({ code: 'unknown_profile', id: c.profile_id }); const required = new Set(descriptor.datasets.filter((x) => x.required !== false).map((x) => x.name)); for (const name of profile?.required_datasets ?? []) required.add(name); for (const term of [...descriptor.constraints, ...descriptor.objectives]) { const configured = term.id in ((c.constraints ?? {}) as object) ? (c.constraints as any)[term.id] === true : term.id in ((c.objectives ?? {}) as object) ? Boolean((c.objectives as any)[term.id]?.enabled) : (term as any).default_enabled !== false; if (configured) for (const name of term.required_datasets ?? []) required.add(name); } const dataDir = resolveDataDir(root); const files: Array<{ dataset: string; path: string }> = []; for (const name of required) { const path = join(dataDir, `${name}.csv`); if (!existsSync(path)) diagnostics.push({ code: 'missing_dataset', dataset: name }); else files.push({ dataset: name, path }); } diagnostics.push(...validateDatasetFiles(descriptor, files).map((item) => ({ ...item }))); } } catch (e) { diagnostics.push({ code: 'invalid_config_or_descriptor', message: String(e) }); } out({ valid: diagnostics.length === 0, diagnostics }, o.format); if (diagnostics.length) process.exitCode = 1; });
async function dry(mode: 'validate' | 'solve', root: string, backendUrl?: string, outPath?: string): Promise<any> { const projectRoot = resolve(root); const { config, session } = ctx(backendUrl); const model = resolveModelId(projectRoot); assertV3Config(loadRunConfig(resolveConfigPath(projectRoot))); const manifest = await buildV3DryRun({ modelId: model, dataDir: resolveDataDir(projectRoot), configPath: resolveConfigPath(projectRoot), mode, outDir: resolveOutDir(projectRoot), session, userConfig: config }); const enriched: any = { ...manifest, profile_id: loadProjectJson(projectRoot).profile_id, project_path: projectRoot }; enriched.manifest_id = manifestId(enriched); saveManifest(enriched.manifest_id, enriched); if (outPath) writeFileSync(resolve(outPath), JSON.stringify(enriched, null, 2) + '\n'); return enriched; }
program.command('dryrun').requiredOption('--project <dir>').requiredOption('--mode <validate|solve>', 'request mode', parseRunMode).option('--backend-url <url>').option('--out <path>').action(async (o) => out(await dry(o.mode, resolve(o.project), o.backendUrl, o.out)));
program.command('prepare').requiredOption('--project <dir>').requiredOption('--out <path>').option('--backend-url <url>').action(async (o) => out(await dry('solve', resolve(o.project), o.backendUrl, o.out)));
program.command('run').requiredOption('--manifest <path>').requiredOption('--approve <digest>').option('--backend-url <url>').option('--wait <seconds>', 'wait for completion before returning', '60').option('--out <dir>').action(async (o) => {
  const manifestPath = resolve(o.manifest);
  const loaded = loadManifest(manifestPath);
  const id = manifestId(loaded.value);
  if (id !== o.approve || loaded.value.manifest_id !== o.approve) throw new Error('manifest_stale or approval digest mismatch; rerun prepare');
  if (loaded.value.request?.mode !== 'solve') throw new Error('run requires a solve manifest created by optivise prepare');
  const projectPath = loaded.value.project_path;
  if (typeof projectPath !== 'string') throw new Error('manifest_missing_project: rerun prepare with this CLI version');
  const root = resolve(projectPath);
  const requestedOut = resolve(o.out ?? resolveOutDir(root));
  if (requestedOut !== resolveOutDir(root)) throw new Error('manifest_stale: output directory differs from the approved manifest; rerun prepare');
  const { config, session } = ctx(o.backendUrl);
  const current = await buildV3DryRun({ modelId: resolveModelId(root), dataDir: resolveDataDir(root), configPath: resolveConfigPath(root), mode: 'solve', outDir: resolveOutDir(root), session, userConfig: config });
  const currentWithProject: any = { ...current, profile_id: loadProjectJson(root).profile_id, project_path: root };
  if (manifestId(currentWithProject) !== id) throw new Error('manifest_stale: project, model, config, profile, backend, or input changed; rerun prepare');
  assertV3Config(loadRunConfig(resolveConfigPath(root)));
  const run = await submitV3Run({ projectRoot: root, modelId: loaded.value.request.model_id, dataDir: resolveDataDir(root), configPath: resolveConfigPath(root), mode: 'solve', session, userConfig: config, idempotencyKey: `${id}:solve:0` });
  recordRun({ run_id: run.run_id, model_id: run.model_id, mode: run.mode, status: run.state, created_at: new Date().toISOString(), manifest_id: id });
  const waited = await waitV3Run({ runId: run.run_id, userConfig: config, session, timeoutSec: Number(o.wait) });
  if (waited.timedOut || waited.run.state !== 'succeeded') {
    out({ ...waited.run, timed_out: waited.timedOut, output_files: [] });
    return;
  }
  const fetched = await downloadV3RunArtifacts({ runId: run.run_id, outDir: requestedOut, userConfig: config, session });
  out({ ...waited.run, timed_out: false, output_files: fetched.outputFiles });
});
program.command('status').requiredOption('--run <id>').option('--backend-url <url>').option('--format <format>', 'json|text', 'json').action(async (o) => { const { config, session } = ctx(o.backendUrl); const { run } = await fetchV3RunStatus({ runId: o.run, userConfig: config, session }); out(buildRunStatusPayload(run), o.format); });
program.command('fetch').requiredOption('--run <id>').option('--out <dir>', './results').option('--backend-url <url>').action(async (o) => { const { config, session } = ctx(o.backendUrl); out(await downloadV3RunArtifacts({ runId: o.run, outDir: resolve(o.out), userConfig: config, session })); });
program.command('cancel').requiredOption('--run <id>').option('--backend-url <url>').action(async (o) => { const { config, session } = ctx(o.backendUrl); out(await new V3ApiClient(config, session).cancelRun(o.run)); });
const runs = program.command('runs'); runs.command('list').option('--backend-url <url>').action(async (o) => { try { const { config, session } = ctx(o.backendUrl); out(await new V3ApiClient(config, session).listRuns()); } catch { out({ runs: listRuns() }); } });
runs.command('status').requiredOption('--run <id>').option('--backend-url <url>').action(async (o) => { const { config, session } = ctx(o.backendUrl); const { run } = await fetchV3RunStatus({ runId: o.run, userConfig: config, session }); out(buildRunStatusPayload(run)); });
runs.command('wait').requiredOption('--run <id>').option('--timeout <sec>', '60').option('--backend-url <url>').action(async (o) => { const { config, session } = ctx(o.backendUrl); const x = await waitV3Run({ runId: o.run, timeoutSec: Number(o.timeout), userConfig: config, session }); out({ ...x.run, timed_out: x.timedOut }); });
runs.command('download').requiredOption('--run <id>').option('--out-dir <dir>', './out').option('--backend-url <url>').action(async (o) => { const { config, session } = ctx(o.backendUrl); out(await downloadV3RunArtifacts({ runId: o.run, outDir: resolve(o.outDir), userConfig: config, session })); });
program.command('recover').requiredOption('--run <id>').option('--backend-url <url>').action(async (o) => { const { config, session } = ctx(o.backendUrl); try { const { run } = await fetchV3RunStatus({ runId: o.run, userConfig: config, session }); out({ run_id: o.run, recoverable: Boolean((run as any).recoverable), remote: run, action: 'rerun dryrun and obtain fresh approval' }); } catch { out({ run_id: o.run, recoverable: true, record: listRuns().find((x) => x.run_id === o.run) ?? null, action: 'rerun dryrun and obtain fresh approval' }); } });
program.command('explain').requiredOption('--run <id>').option('--backend-url <url>').option('--format <format>', 'short|detailed', 'short').action(async (o) => { const { config, session } = ctx(o.backendUrl); const { run } = await fetchV3RunStatus({ runId: o.run, userConfig: config, session }); const result: any = run.result ?? {}; const detailed = { run_id: run.run_id, status: result.status ?? run.state, objective_value: result.objective_value ?? null, optimality_gap: result.optimality_gap ?? null, feasibility: result.feasibility ?? null, objective_components: result.objective_components ?? [], key_decisions: result.key_decisions ?? {}, artifacts: result.artifacts ?? run.artifacts ?? [], sensitivity_summary: result.sensitivity_summary ?? null, logs: result.logs ?? [], meta: result.meta ?? {} }; out(o.format === 'detailed' ? detailed : { run_id: detailed.run_id, status: detailed.status, feasible: (detailed.feasibility as any)?.feasible ?? null, key_decisions: detailed.key_decisions, artifacts: detailed.artifacts }); });
program.command('configure').requiredOption('--backend-url <url>').action((o) => { const c = resolveBackendUrl(o.backendUrl); saveConfig(c); out({ backend_url: c.backendUrl }); });
program.command('login').requiredOption('--backend-url <url>').option('--local-dev').action(async (o) => { const config = resolveBackendUrl(o.backendUrl); saveConfig(config); const session = await loginWithBrowser(config, { localDev: o.localDev }); out({ logged_in: true, principal_id: session.principalId }); });
program.command('whoami').action(() => out({ session: sessionSummary(loadSession()), mode: loadSession() ? 'bearer' : 'anonymous' })); program.command('logout').action(() => { clearCredentials(); out({ logged_out: true }); });
const skill = program.command('skill');
program.command('setup')
  .requiredOption('--target <target>', 'codex|workpartner')
  .option('--dir <dir>')
  .action((o) => {
    const target = parseSkillTarget(o.target);
    const installed = installSkill(target, o.dir);
    const doctor = doctorSkill(target, o.dir);
    if (!doctor.ok) throw new Error(`skill_setup_failed: ${JSON.stringify(doctor)}`);
    out({ ready: true, target, skill_definition_hash: doctor.skill_definition_hash, installed: installed.installed });
  });
skill.command('install')
  .requiredOption('--target <target>', 'codex|workpartner')
  .option('--dir <dir>')
  .action((o) => out(installSkill(parseSkillTarget(o.target), o.dir)));
skill.command('doctor')
  .requiredOption('--target <target>', 'codex|workpartner')
  .option('--dir <dir>')
  .option('--format <format>', 'json|text', 'json')
  .action((o) => {
    const result = doctorSkill(parseSkillTarget(o.target), o.dir);
    out(result, o.format);
    if (!result.ok) process.exitCode = 1;
  });
program.parseAsync(process.argv).catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; });
