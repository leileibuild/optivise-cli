import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
  env: { ...process.env, npm_config_cache: fileURLToPath(new URL('../.npm-cache', import.meta.url)) },
});
if (packed.status !== 0) {
  throw new Error(packed.stderr || 'npm pack --dry-run failed');
}

const [manifest] = JSON.parse(packed.stdout);
const files = manifest.files.map((entry) => entry.path);
const allowed = /^(dist\/|skills\/(smart-planner-cli|optivise-cli)\/|LICENSE$|README\.md$|package\.json$)/;
const unexpected = files.filter((path) => !allowed.test(path));
assert.deepEqual(unexpected, [], `Unexpected files in npm package: ${unexpected.join(', ')}`);
for (const required of ['dist/index.js', 'skills/optivise-cli/SKILL.md', 'skills/optivise-cli/agents/openai.yaml', 'skills/optivise-cli/references/commands.md', 'skills/smart-planner-cli/SKILL.md', 'LICENSE', 'README.md']) {
  assert.ok(files.includes(required), `Missing required package file: ${required}`);
}
console.log(`Package allowlist passed (${files.length} files)`);
