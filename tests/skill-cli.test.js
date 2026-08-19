import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = resolve('dist/index.js');

function run(args, home) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
}

test('workpartner installation copies the complete canonical and alias bundles', () => {
  const home = mkdtempSync(join(tmpdir(), 'optivise-workpartner-home-'));
  const install = run(['skill', 'install', '--target', 'workpartner'], home);
  assert.equal(install.status, 0, install.stderr);
  const payload = JSON.parse(install.stdout);
  assert.equal(payload.target, 'workpartner');
  assert.match(payload.skill_definition_hash, /^[a-f0-9]{64}$/);

  const root = join(home, '.aily', 'workspace', 'skills');
  for (const path of [
    'optivise-cli/SKILL.md',
    'optivise-cli/agents/openai.yaml',
    'optivise-cli/references/commands.md',
    'optivise-cli/references/security.md',
    'smart-planner-cli/SKILL.md',
  ]) assert.ok(existsSync(join(root, path)), path);

  const doctor = run(['skill', 'doctor', '--target', 'workpartner'], home);
  assert.equal(doctor.status, 0, doctor.stderr);
  const report = JSON.parse(doctor.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.implicit_invocation, true);
  assert.equal(report.skill_definition_hash, report.expected_skill_definition_hash);
});

test('setup installs and verifies the full bundle in one command', () => {
  const home = mkdtempSync(join(tmpdir(), 'optivise-setup-home-'));
  const setup = run(['setup', '--target', 'workpartner'], home);
  assert.equal(setup.status, 0, setup.stderr);
  const payload = JSON.parse(setup.stdout);
  assert.equal(payload.ready, true);
  assert.equal(payload.target, 'workpartner');
  assert.match(payload.skill_definition_hash, /^[a-f0-9]{64}$/);
});

test('skill doctor rejects a stale installed entrypoint', () => {
  const home = mkdtempSync(join(tmpdir(), 'optivise-stale-skill-home-'));
  assert.equal(run(['skill', 'install', '--target', 'codex'], home).status, 0);
  const skill = join(home, '.codex', 'skills', 'optivise-cli', 'SKILL.md');
  writeFileSync(skill, `${readFileSync(skill, 'utf8')}\n# stale\n`);
  const doctor = run(['skill', 'doctor', '--target', 'codex'], home);
  assert.equal(doctor.status, 1);
  const report = JSON.parse(doctor.stdout);
  assert.equal(report.ok, false);
  assert.notEqual(report.skill_definition_hash, report.expected_skill_definition_hash);
});
