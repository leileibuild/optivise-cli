import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PACKAGED_BACKEND_URL, resolveBackendUrl } from '../dist/auth.js';

test('packaged backend is the final default and environment still overrides it', () => {
  const previousHome = process.env.OPTIVISE_HOME;
  const previousBackend = process.env.SMART_PLANNER_BACKEND_URL;
  process.env.OPTIVISE_HOME = mkdtempSync(join(tmpdir(), 'optivise-auth-'));
  delete process.env.SMART_PLANNER_BACKEND_URL;
  try {
    assert.equal(resolveBackendUrl().backendUrl, PACKAGED_BACKEND_URL);
    assert.equal(PACKAGED_BACKEND_URL, 'https://api.optivise.cc');
    process.env.SMART_PLANNER_BACKEND_URL = 'https://test.example.com/';
    assert.equal(resolveBackendUrl().backendUrl, 'https://test.example.com');
  } finally {
    if (previousHome === undefined) delete process.env.OPTIVISE_HOME;
    else process.env.OPTIVISE_HOME = previousHome;
    if (previousBackend === undefined) delete process.env.SMART_PLANNER_BACKEND_URL;
    else process.env.SMART_PLANNER_BACKEND_URL = previousBackend;
  }
});
