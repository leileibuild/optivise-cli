import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { applyPatches, extractPatches } from '../dist/patches.js';
import { generateIdentity, signRequest } from '../dist/auth.js';

test('extractPatches parses fenced json', () => {
  const text = 'hello\n```json\n{"patches":[{"path":"src/model.ts","op":"replace","content":"x"}]}\n```';
  const doc = extractPatches(text);
  assert.ok(doc);
  assert.equal(doc.patches.length, 1);
});

test('applyPatches writes files and backup', () => {
  const root = mkdtempSync(join(tmpdir(), 'sp-cli-'));
  try {
    const doc = {
      patches: [{ path: 'src/model.ts', op: 'replace', content: 'export const x = 1;\n' }],
    };
    const changed = applyPatches(root, doc);
    assert.deepEqual(changed, ['src/model.ts']);
    assert.equal(readFileSync(join(root, 'src/model.ts'), 'utf8'), 'export const x = 1;\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('signRequest produces stable headers', () => {
  const identity = generateIdentity();
  const headers = signRequest(identity, 'GET', '/v1/solve/runs/abc', '');
  assert.ok(headers['X-Client-Id']);
  assert.ok(headers['X-Signature']);
});
