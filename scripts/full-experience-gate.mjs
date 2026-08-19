import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = join(root, 'dist', 'index.js');
const backend = process.env.SMART_PLANNER_BACKEND_URL?.trim();
assert.ok(backend, 'SMART_PLANNER_BACKEND_URL is required');

const smartPlannerRoot = resolve(
  process.env.SMART_PLANNER_ROOT ?? join(root, '..', 'smart-planner'),
);
const examplesRoot = join(smartPlannerRoot, 'examples', 'model_platform');
const gateRoot = mkdtempSync(join(tmpdir(), 'optivise-full-gate-'));
const env = {
  ...process.env,
  OPTIVISE_HOME: join(gateRoot, 'home'),
  SMART_PLANNER_BACKEND_URL: backend,
};

const scenarios = [
  {
    family: 'assignment',
    profile: 'shift_scheduling',
    source: join(examplesRoot, 'assignment', 'call_center_shifts'),
  },
  {
    family: 'capacity_scheduling',
    profile: 'production_scheduling',
    source: join(examplesRoot, 'capacity_scheduling', 'small_factory'),
  },
  {
    family: 'selection',
    profile: 'project_portfolio',
    source: join(examplesRoot, 'selection', 'project_portfolio'),
  },
  {
    family: 'routing',
    profile: 'last_mile_delivery',
    source: join(examplesRoot, 'routing', 'last_mile_delivery'),
  },
];

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
  if (result.status !== 0) {
    throw new Error(
      `optivise ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

function serverRunCount() {
  const listed = run(['runs', 'list']);
  return Array.isArray(listed.runs) ? listed.runs.length : 0;
}

function writeIdentityMapping(sourcePath, dataset, mappingPath) {
  const header = readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
  const fields = header.split(',');
  const columns = Object.fromEntries(fields.map((field) => [field, field]));
  writeFileSync(
    mappingPath,
    `${JSON.stringify({
      schema_version: 1,
      rules: [{ source: sourcePath, target_dataset: dataset, columns }],
    }, null, 2)}\n`,
  );
}

try {
  const discovered = run(['describe-models']);
  const modelByFamily = new Map(
    discovered.models.map((model) => [model.family, model.model_id]),
  );
  assert.deepEqual(
    new Set(modelByFamily.keys()),
    new Set(scenarios.map((scenario) => scenario.family)),
  );

  for (const scenario of scenarios) {
    const modelId = modelByFamily.get(scenario.family);
    const project = join(gateRoot, scenario.family);
    run([
      'scaffold',
      '--model', modelId,
      '--profile', scenario.profile,
      '--project', project,
    ]);

    const config = JSON.parse(readFileSync(join(scenario.source, 'config.json'), 'utf8'));
    config.solver = {
      max_time_in_seconds: 1,
      num_workers: 1,
      random_seed: 0,
      log_search_progress: false,
    };
    writeFileSync(join(project, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);

    for (const filename of readdirSync(scenario.source).filter((name) => name.endsWith('.csv'))) {
      const sourcePath = join(scenario.source, filename);
      const dataset = basename(filename, '.csv');
      const mappingPath = join(gateRoot, `${scenario.family}-${dataset}-mapping.json`);
      writeIdentityMapping(sourcePath, dataset, mappingPath);
      run([
        'convert',
        '--project', project,
        '--input', sourcePath,
        '--mapping', mappingPath,
      ]);
    }

    const lint = run(['lint', '--project', project]);
    assert.equal(lint.valid, true, JSON.stringify(lint.diagnostics));

    const beforePrepare = serverRunCount();
    const manifestPath = join(project, 'manifest.solve.json');
    const manifest = run([
      'prepare',
      '--project', project,
      '--out', manifestPath,
    ]);
    assert.equal(manifest.request.mode, 'solve');
    assert.equal(manifest.network.not_executed[0].method, 'POST');
    assert.equal(serverRunCount(), beforePrepare, 'prepare created a server run');

    const solved = run([
      'run',
      '--manifest', manifestPath,
      '--approve', manifest.manifest_id,
      '--wait', '60',
      '--out', join(project, 'results'),
    ]);
    assert.equal(solved.state, 'succeeded', JSON.stringify(solved.errors ?? []));
    assert.ok(solved.run_id);
    assert.ok(solved.output_files.length > 0);

    const fetched = run([
      'fetch',
      '--run', solved.run_id,
      '--out', join(project, 'results'),
    ]);
    assert.equal(fetched.run.run_id, solved.run_id);
    assert.ok(fetched.outputFiles.length > 0);

    const explained = run(['explain', '--run', solved.run_id, '--format', 'short']);
    assert.equal(explained.run_id, solved.run_id);
    assert.ok(!('objective_value' in explained));
    assert.ok(!('optimality_gap' in explained));
  }

  console.log(`Four-model full-experience gate passed: ${scenarios.length} families`);
} finally {
  if (process.env.KEEP_OPTIVISE_GATE !== '1') {
    rmSync(gateRoot, { recursive: true, force: true });
  } else {
    console.error(`Gate workspace retained at ${gateRoot}`);
  }
}
