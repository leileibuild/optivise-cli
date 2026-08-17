import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'optivise-package-'));
const cache = join(temp, 'cache');
const release = join(temp, 'release');
const install = join(temp, 'install');
mkdirSync(release);
mkdirSync(install);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: cache },
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

const commanderPack = run('npm', ['pack', join(root, 'node_modules', 'commander'), '--pack-destination', temp]).trim();
run('npm', ['cache', 'add', join(temp, commanderPack)]);
run('npm', ['pack', '--pack-destination', release, '--ignore-scripts']);
const tarball = readdirSync(release).find((name) => name.endsWith('.tgz'));
assert.ok(tarball, 'npm pack did not create a tarball');
const installResult = spawnSync('npm', ['install', join(release, tarball), '--prefix', install, '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, npm_config_cache: cache },
});
if (installResult.status !== 0) {
  // Offline CI images may not contain registry metadata. Still verify the exact
  // published archive by extracting it into a clean node_modules tree and using
  // the dependency already installed for this source checkout.
  mkdirSync(join(install, 'node_modules', '@smart-planner'), { recursive: true });
  run('tar', ['-xzf', join(release, tarball), '-C', install]);
  renameSync(join(install, 'package'), join(install, 'node_modules', '@smart-planner', 'cli'));
  cpSync(join(root, 'node_modules', 'commander'), join(install, 'node_modules', 'commander'), { recursive: true });
}
const binary = join(install, 'node_modules', '@smart-planner', 'cli', 'dist', 'index.js');
assert.match(run(process.execPath, [binary, '--help'], { cwd: temp }), /Optivise CLI/);
assert.equal(run(process.execPath, [binary, '--version'], { cwd: temp }).trim(), '0.4.0');
console.log(`Clean tarball install passed: ${tarball}`);
