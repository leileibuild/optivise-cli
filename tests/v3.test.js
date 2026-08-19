import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAsyncSubmitPayload,
  buildRunStatusPayload,
  downloadArtifactsAtomically,
  formatV3Error,
  isTerminalRunState,
  loadRunConfig,
  resolveConfigPath,
  resolveOutDir,
} from '../dist/v3-run.js';
import { collectCsvFiles, discoverCsvFiles } from '../dist/v3-client.js';
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
