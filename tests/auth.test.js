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

test('first-use discovery selects the backend exposed by FC or cloud code', () => {
  const previousHome = process.env.OPTIVISE_HOME;
  const names = [
    'SMART_PLANNER_BACKEND_URL', 'OPTIVISE_BACKEND_URL',
    'SMART_PLANNER_FC_BACKEND_URL', 'OPTIVISE_FC_BACKEND_URL', 'FC_BACKEND_URL', 'FC_ENDPOINT',
    'SMART_PLANNER_CLOUD_CODE_BACKEND_URL', 'OPTIVISE_CLOUD_CODE_BACKEND_URL',
    'CLOUD_CODE_BACKEND_URL', 'CLOUD_CODE_ENDPOINT',
    'FC_ENV', 'FC_FUNCTION_NAME', 'FC_SERVICE_NAME', 'FC_REGION',
    'CLOUD_CODE_ENV', 'CLOUD_CODE_PROJECT', 'CLOUDCODE_ENV',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.OPTIVISE_HOME = mkdtempSync(join(tmpdir(), 'optivise-discovery-'));
    for (const name of names) delete process.env[name];
    process.env.FC_ENV = '1';
    process.env.FC_BACKEND_URL = 'https://fc.example.com/';
    process.env.CLOUD_CODE_BACKEND_URL = 'https://cloud.example.com/';
    assert.equal(resolveBackendUrl().backendUrl, 'https://fc.example.com');

    delete process.env.FC_ENV;
    process.env.CLOUD_CODE_ENV = '1';
    assert.equal(resolveBackendUrl().backendUrl, 'https://cloud.example.com');
  } finally {
    if (previousHome === undefined) delete process.env.OPTIVISE_HOME;
    else process.env.OPTIVISE_HOME = previousHome;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
