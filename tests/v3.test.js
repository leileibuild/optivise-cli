import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAsyncSubmitPayload,
  buildRunStatusPayload,
  collectV3PreparationWarnings,
  downloadArtifactsAtomically,
  formatV3Error,
  isTerminalRunState,
  loadRunConfig,
  resolveConfigPath,
  resolveOutDir,
} from '../dist/v3-run.js';
import { collectCsvFiles, discoverCsvFiles } from '../dist/v3-client.js';
import { buildExplainPayload } from '../dist/explain.js';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('formatV3Error includes dataset and suggestion', () => {
  const text = formatV3Error({
    code: 'invalid_datetime',
    message: 'due_at must be ISO 8601',
    dataset: 'jobs',
    line: 3,
    column: 'due_at',
    suggestion: 'Use 2026-09-02T17:00:00Z',
  });
  assert.match(text, /jobs/);
  assert.match(text, /due_at must be ISO 8601/);
  assert.match(text, /suggestion/);
});

test('collectCsvFiles maps dataset names to paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-cli-'));
  writeFileSync(join(dir, 'jobs.csv'), 'job_id\nA\n', 'utf8');
  const files = collectCsvFiles(dir, ['jobs']);
  assert.equal(files.length, 1);
  assert.equal(files[0].dataset, 'jobs');
});

test('discoverCsvFiles finds csv files in directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-cli-'));
  writeFileSync(join(dir, 'operations.csv'), 'op\n1\n', 'utf8');
  const files = discoverCsvFiles(dir);
  assert.equal(files[0].dataset, 'operations');
});

const calendarDescriptor = {
  model_id: 'capacity-scheduling@sha256:test',
  name: 'Finite-capacity scheduling',
  description: 'Schedule operations.',
  adapter_revision: 'builtin-test',
  solver_compatibility: ['cp_sat'],
  datasets: [
    { name: 'resources', required: true },
    { name: 'resource_unavailability', required: false },
  ],
  result_datasets: [],
  config_schema: {},
  constraints: [{ id: 'resource_availability', default_enabled: false, required_datasets: ['resources', 'resource_unavailability'] }],
  objectives: [],
  profiles: [
    { id: 'production', constraints: { resource_availability: false } },
    { id: 'maintenance', constraints: { resource_availability: true } },
  ],
};

test('preparation warning explains ignored calendar data without invalidating input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'optivise-calendar-warning-'));
  writeFileSync(join(dir, 'resource_unavailability.csv'), 'resource_id,start_at,end_at,capacity_reduction\nR1,2026-01-01T00:00:00Z,2026-01-01T01:00:00Z,1\n', 'utf8');
  const warnings = collectV3PreparationWarnings(dir, calendarDescriptor, { profile_id: 'production' });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'dataset_ignored_by_disabled_constraint');
  assert.equal(warnings[0].severity, 'warning');
  assert.equal(warnings[0].dataset, 'resource_unavailability');
  assert.equal(warnings[0].constraint, 'resource_availability');
  assert.deepEqual(warnings[0].ignored_inputs, [{ dataset: 'resource_unavailability' }]);
  assert.match(warnings[0].message, /will not be applied/);
  assert.match(warnings[0].business_impact, /schedule may cross/);
  assert.match(warnings[0].suggestion, /enable resource_availability/);
});

test('preparation warning follows profile defaults and explicit overrides', () => {
  const dir = mkdtempSync(join(tmpdir(), 'optivise-calendar-switch-'));
  writeFileSync(join(dir, 'resource_unavailability.csv'), 'resource_id,start_at,end_at,capacity_reduction\n', 'utf8');
  assert.deepEqual(collectV3PreparationWarnings(dir, calendarDescriptor, { profile_id: 'maintenance' }), []);
  assert.equal(collectV3PreparationWarnings(dir, calendarDescriptor, {
    profile_id: 'maintenance',
    constraints: { resource_availability: false },
  }).length, 1);
  assert.deepEqual(collectV3PreparationWarnings(dir, calendarDescriptor, {
    profile_id: 'production',
    constraints: { resource_availability: true },
  }), []);
});

test('preparation warning is absent when no calendar file is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'optivise-calendar-absent-'));
  assert.deepEqual(collectV3PreparationWarnings(dir, calendarDescriptor, { profile_id: 'production' }), []);
});

test('preparation warning detects populated calendar fields in resources', () => {
  const dir = mkdtempSync(join(tmpdir(), 'optivise-resource-calendar-'));
  writeFileSync(join(dir, 'resources.csv'), 'resource_id,calendar_start_at,calendar_end_at\nR1,2026-01-01T08:00:00Z,2026-01-01T17:00:00Z\n', 'utf8');
  const warnings = collectV3PreparationWarnings(dir, calendarDescriptor, { profile_id: 'production' });
  assert.equal(warnings[0].dataset, 'resources');
  assert.deepEqual(warnings[0].ignored_inputs, [{
    dataset: 'resources',
    fields: ['calendar_start_at', 'calendar_end_at'],
  }]);
  assert.match(warnings[0].message, /resources\.calendar_start_at/);
});

test('loadRunConfig parses json object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-cli-'));
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify({ solver: { max_time_in_seconds: 1, num_workers: 1, random_seed: 0, log_search_progress: false } }), 'utf8');
  const config = loadRunConfig(path);
  assert.deepEqual(config.solver, { max_time_in_seconds: 1, num_workers: 1, random_seed: 0, log_search_progress: false });
});

test('resolveConfigPath and resolveOutDir use project defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-cli-'));
  writeFileSync(join(dir, 'project.json'), JSON.stringify({ schema_version: 1, model_id: 'm@sha256:1', data_dir: 'data', config_path: 'config.json', out_dir: 'out' }), 'utf8');
  writeFileSync(join(dir, 'config.json'), '{}', 'utf8');
  assert.equal(resolveConfigPath(dir), join(dir, 'config.json'));
  assert.equal(resolveOutDir(dir), join(dir, 'out'));
});

test('isTerminalRunState detects finished runs', () => {
  assert.equal(isTerminalRunState('succeeded'), true);
  assert.equal(isTerminalRunState('failed'), true);
  assert.equal(isTerminalRunState('running'), false);
});

test('buildAsyncSubmitPayload includes poll and wait commands', () => {
  const payload = buildAsyncSubmitPayload(
    {
      run_id: 'run_123',
      mode: 'solve',
      state: 'queued',
      phase: 'queued',
      progress: 0,
      model_id: 'm@sha256:abc',
    },
    'solve',
  );
  assert.equal(payload.async, true);
  assert.match(String(payload.poll_command), /runs status --run-id run_123/);
  assert.match(String(payload.wait_command), /runs wait --run-id run_123/);
});

test('buildRunStatusPayload marks terminal state', () => {
  const payload = buildRunStatusPayload({
    run_id: 'run_123',
    mode: 'solve',
    state: 'running',
    phase: 'solve',
    progress: 40,
    model_id: 'm@sha256:abc',
  });
  assert.equal(payload.terminal, false);
  assert.equal(payload.progress, 40);
});

test('short infeasible explanation replaces feasible decision fields', () => {
  const diagnosis = {
    schema_version: 2,
    summary: 'Hard constraints conflict.',
    conflicts: [],
    solver_symptoms: [],
    assumption_core: { status: 'available', sufficient: true, minimal: false, business_group_count: 1, note: 'Not necessarily minimal.' },
    reliability: { exact_business_conflict_identified: true, business_mapping: 'complete', log_truncated: false },
    residual_uncertainty: null,
    truncated: false,
  };
  const payload = buildExplainPayload({
    run_id: 'run_infeasible', mode: 'solve', state: 'succeeded', phase: 'completed', progress: 100,
    model_id: 'm@sha256:abc',
    result: {
      status: 'infeasible',
      feasibility: { feasible: false, proof: 'solver_infeasible', violations: [] },
      infeasibility_diagnosis: diagnosis,
    },
  }, 'short');
  assert.deepEqual(payload, {
    run_id: 'run_infeasible', status: 'infeasible', feasible: false, infeasibility_diagnosis: diagnosis,
  });
  assert.equal('key_decisions' in payload, false);
  assert.equal('artifacts' in payload, false);
  assert.equal('objective_value' in payload, false);
});

test('detailed infeasible explanation does not expose feasible or raw-log fields', () => {
  const payload = buildExplainPayload({
    run_id: 'run_infeasible', mode: 'solve', state: 'succeeded', phase: 'completed', progress: 100,
    model_id: 'm@sha256:abc',
    result: {
      status: 'infeasible',
      feasibility: { feasible: false, proof: 'solver_infeasible', violations: [] },
      infeasibility_diagnosis: { schema_version: 2 },
      meta: { diagnostic_hashes: { 'model.pb': 'abc' } },
    },
  }, 'detailed');
  assert.equal(payload.status, 'infeasible');
  assert.equal('logs' in payload, false);
  assert.equal('key_decisions' in payload, false);
  assert.equal('sensitivity_summary' in payload, false);
  assert.equal('meta' in payload, false);
  assert.equal(JSON.stringify(payload).includes('model.pb'), false);
});

test('artifact batch is published only after every download succeeds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'optivise-artifacts-ok-'));
  const outDir = join(root, 'results');
  const files = await downloadArtifactsAtomically(
    outDir,
    [{ filename: 'schedule.csv' }, { filename: 'summary.csv' }],
    async ({ filename }) => `name\n${filename}\n`,
  );
  assert.deepEqual(files, [join(outDir, 'schedule.csv'), join(outDir, 'summary.csv')]);
  assert.match(readFileSync(files[0], 'utf8'), /schedule\.csv/);
});

test('artifact failure exposes no partial result files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'optivise-artifacts-fail-'));
  const outDir = join(root, 'results');
  await assert.rejects(
    downloadArtifactsAtomically(
      outDir,
      [{ filename: 'schedule.csv' }, { filename: 'summary.csv' }],
      async ({ filename }) => {
        if (filename === 'summary.csv') throw new Error('network interrupted');
        return 'operation\nCUT\n';
      },
    ),
    /artifact_unavailable: could not retrieve the complete result; no complete result was produced/,
  );
  assert.equal(existsSync(outDir), false);
  assert.deepEqual(readdirSync(root), []);
});

test('artifact failure does not overwrite an existing result directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'optivise-artifacts-existing-'));
  const outDir = join(root, 'results');
  await downloadArtifactsAtomically(outDir, [{ filename: 'schedule.csv' }], async () => 'old\nresult\n');
  await assert.rejects(
    downloadArtifactsAtomically(
      outDir,
      [{ filename: 'schedule.csv' }, { filename: 'summary.csv' }],
      async ({ filename }) => {
        if (filename === 'summary.csv') throw new Error('network interrupted');
        return 'new\nresult\n';
      },
    ),
    /artifact_unavailable/,
  );
  assert.equal(readFileSync(join(outDir, 'schedule.csv'), 'utf8'), 'old\nresult\n');
});
