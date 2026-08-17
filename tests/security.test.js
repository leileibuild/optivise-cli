import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildV3DryRun, downloadV3RunArtifacts, runV3Validate } from '../dist/v3-run.js';
import {
  fetchWithTimeout,
  normalizeBackendUrl,
  resolveDatasetFile,
  resolveOutputFile,
} from '../dist/security.js';

const descriptor = {
  model_id: 'capacity@sha256:abc',
  name: 'Capacity planning',
  description: 'Allocate work.',
  adapter_revision: 'sha256:abc',
  solver_compatibility: ['reference'],
  datasets: [{ name: 'work_items', required: true }],
  result_datasets: [{ name: 'allocations' }],
  config_schema: { type: 'object' },
  constraints: [],
  objectives: [],
};
const fixtureRoot = fileURLToPath(new URL('../examples/capacity-planning', import.meta.url));

async function withMockFetch(mock, run) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await run('http://127.0.0.1:3000');
  } finally {
    globalThis.fetch = original;
  }
}

test('dry-run fetches only the descriptor, writes nothing, and redacts bearer auth', async () => {
  const root = mkdtempSync(join(tmpdir(), 'optivise-dry-run-'));
  const dataDir = join(fixtureRoot, 'data');
  const outDir = join(root, 'results');
  const configPath = join(fixtureRoot, 'config.json');
  const requests = [];

  await withMockFetch(async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ method: init.method ?? 'GET', url: `${url.pathname}${url.search}` });
    return new Response(JSON.stringify(descriptor), {
      headers: { 'Content-Type': 'application/json' },
    });
  }, async (backendUrl) => {
    const manifest = await buildV3DryRun({
      modelId: descriptor.model_id,
      dataDir,
      configPath,
      mode: 'solve',
      outDir,
      session: {
        accessToken: 'secret-token-that-must-not-appear',
        tokenType: 'Bearer',
        principalId: 'user-1',
        createdAt: new Date(0).toISOString(),
      },
      userConfig: { backendUrl },
    });
    assert.deepEqual(requests, [
      { method: 'GET', url: `/v3/models/${encodeURIComponent(descriptor.model_id)}` },
    ]);
    assert.equal(manifest.authentication.credentials, 'redacted');
    assert.equal(manifest.request.datasets[0].bytes, readFileSync(join(dataDir, 'work_items.csv')).byteLength);
    assert.match(manifest.request.datasets[0].sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(manifest.expected_local_writes, [join(outDir, 'allocations.csv')]);
    assert.doesNotMatch(JSON.stringify(manifest), /secret-token-that-must-not-appear/);
    assert.equal(await import('node:fs').then(({ existsSync }) => existsSync(outDir)), false);
  });
});

test('dataset names and escaping symlinks are rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'optivise-path-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  const outside = join(root, 'outside.csv');
  writeFileSync(outside, 'id\n1\n', 'utf8');
  symlinkSync(outside, join(dataDir, 'work_items.csv'));
  assert.throws(() => resolveDatasetFile(dataDir, '../outside'), /Unsafe dataset name/);
  assert.throws(() => resolveDatasetFile(dataDir, 'work_items'), /escapes the data directory/);
});

test('unsafe artifact filenames are rejected before download or local writes', async () => {
  const requests = [];
  const root = mkdtempSync(join(tmpdir(), 'optivise-artifact-'));
  const outDir = join(root, 'out');
  await withMockFetch(async (input) => {
    requests.push(new URL(String(input)).pathname);
    return new Response(JSON.stringify({
      run_id: 'run-1',
      mode: 'solve',
      state: 'succeeded',
      phase: 'done',
      progress: 100,
      model_id: descriptor.model_id,
      artifacts: [{ artifact_id: 'a1', dataset: 'x', filename: '../escape.csv', content_type: 'text/csv', download_url: '/x' }],
    }), { headers: { 'Content-Type': 'application/json' } });
  }, async (backendUrl) => {
    await assert.rejects(
      downloadV3RunArtifacts({ runId: 'run-1', outDir, userConfig: { backendUrl } }),
      /Unsafe artifact filename/,
    );
    assert.deepEqual(requests, ['/v3/runs/run-1']);
    assert.equal(await import('node:fs').then(({ existsSync }) => existsSync(outDir)), false);
  });
});

test('existing artifact symlinks are rejected before overwrite', () => {
  const root = mkdtempSync(join(tmpdir(), 'optivise-artifact-link-'));
  const outDir = join(root, 'out');
  const outside = join(root, 'outside.csv');
  mkdirSync(outDir);
  writeFileSync(outside, 'keep\n', 'utf8');
  symlinkSync(outside, join(outDir, 'allocations.csv'));
  assert.throws(() => resolveOutputFile(outDir, 'allocations.csv'), /symbolic link/);
  assert.equal(existsSync(outside), true);
});

test('async validation sends only the documented request fields and selected CSV', async () => {
  const root = mkdtempSync(join(tmpdir(), 'optivise-submit-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  writeFileSync(join(dataDir, 'work_items.csv'), 'item_id,required_units,priority\nA,1,1\n', 'utf8');
  const seen = [];
  await withMockFetch(async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    if (path.startsWith('/v3/models/')) {
      seen.push({ method: init.method ?? 'GET', path });
      return new Response(JSON.stringify(descriptor), { headers: { 'Content-Type': 'application/json' } });
    }
    assert.equal(path, '/v3/runs');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer test-token');
    const form = init.body;
    const request = JSON.parse(form.get('request'));
    assert.deepEqual(request, { mode: 'validate', model_id: descriptor.model_id, config: {} });
    assert.equal(form.getAll('files').length, 1);
    assert.equal(form.get('files').name, 'work_items.csv');
    seen.push({ method: init.method, path });
    return new Response(JSON.stringify({
      run_id: 'run-async',
      mode: 'validate',
      state: 'queued',
      phase: 'queued',
      progress: 0,
      model_id: descriptor.model_id,
    }), { headers: { 'Content-Type': 'application/json' } });
  }, async (backendUrl) => {
    const result = await runV3Validate({
      projectRoot: root,
      modelId: descriptor.model_id,
      dataDir,
      async: true,
      session: {
        accessToken: 'test-token',
        tokenType: 'Bearer',
        principalId: 'user-1',
        createdAt: new Date(0).toISOString(),
      },
      userConfig: { backendUrl },
    });
    assert.equal(result.asyncSubmitted, true);
    assert.deepEqual(seen.map(({ method }) => method), ['GET', 'POST']);
  });
});

test('backend URLs require HTTPS except on loopback and reject embedded secrets', () => {
  assert.equal(normalizeBackendUrl('https://api.optivise.cc/'), 'https://api.optivise.cc');
  assert.equal(normalizeBackendUrl('http://localhost:3000'), 'http://localhost:3000');
  assert.throws(() => normalizeBackendUrl('http://api.optivise.cc'), /must use HTTPS/);
  assert.throws(() => normalizeBackendUrl('https://user:pass@api.optivise.cc'), /must not contain credentials/);
  assert.throws(() => normalizeBackendUrl('https://api.optivise.cc?token=x'), /must not contain credentials/);
});

test('requests fail with a bounded timeout', async () => {
  await withMockFetch((_input, init = {}) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }), async (backendUrl) => {
    await assert.rejects(fetchWithTimeout(`${backendUrl}/slow`, {}, 10), /timed out after 10ms/);
  });
});
