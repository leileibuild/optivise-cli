import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

const cli = resolve('dist/index.js');

test('run help exposes only the manifest-bound solve contract', () => {
  const result = spawnSync(process.execPath, [cli, 'run', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--manifest <path>/);
  assert.match(result.stdout, /--approve <digest>/);
  assert.doesNotMatch(result.stdout, /--profile|--project|--mode/);
});

test('run rejects guessed project, profile, and mode options', () => {
  const result = spawnSync(process.execPath, [
    cli,
    'run',
    '--project',
    './does-not-exist',
    '--mode',
    'local',
    '--manifest',
    './does-not-exist.json',
    '--approve',
    'not-a-digest',
  ], { encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown option '--project'/);
  assert.doesNotMatch(result.stderr, /Manifest not found|Missing --model/);
});

test('prepare fixes solve mode and requires only project and output manifest', () => {
  const result = spawnSync(process.execPath, [cli, 'prepare', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--project <dir>/);
  assert.match(result.stdout, /--out <path>/);
  assert.doesNotMatch(result.stdout, /--profile|--mode/);
});
