import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAsyncSubmitPayload,
  buildRunStatusPayload,
  formatV3Error,
  isTerminalRunState,
  loadRunConfig,
  resolveConfigPath,
  resolveOutDir,
} from '../dist/v3-run.js';
import { collectCsvFiles, discoverCsvFiles } from '../dist/v3-client.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
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
  writeFileSync(path, JSON.stringify({ solver: { time_limit_seconds: 30 } }), 'utf8');
  const config = loadRunConfig(path);
  assert.deepEqual(config.solver, { time_limit_seconds: 30 });
});

test('resolveConfigPath and resolveOutDir use project defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-cli-'));
  writeFileSync(join(dir, 'project.yaml'), 'model_id: m@sha256:1\ndataDir: data\ndefaultConfig: config.json\noutDir: out\n', 'utf8');
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
