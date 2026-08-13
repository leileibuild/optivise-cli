import test from 'node:test';
import assert from 'node:assert/strict';

import { formatV3Error, loadRunConfig } from '../dist/v3-run.js';
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
