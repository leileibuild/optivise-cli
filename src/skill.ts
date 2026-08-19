import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SkillTarget = 'codex' | 'workpartner';

const CANONICAL_FILES = [
  'SKILL.md',
  'agents/openai.yaml',
  'references/commands.md',
  'references/security.md',
] as const;
const ALIAS_FILES = ['SKILL.md'] as const;

function sourceRoot(name: 'optivise-cli' | 'smart-planner-cli'): URL {
  return new URL(`../skills/${name}/`, import.meta.url);
}

export function parseSkillTarget(value: string): SkillTarget {
  if (value !== 'codex' && value !== 'workpartner') {
    throw new Error("--target must be 'codex' or 'workpartner'");
  }
  return value;
}

export function resolveSkillsRoot(target: SkillTarget, explicitDir?: string): string {
  if (explicitDir) return resolve(explicitDir);
  const home = process.env.HOME ?? '.';
  if (target === 'workpartner') return resolve(home, '.aily', 'workspace', 'skills');
  return resolve(process.env.CODEX_HOME ?? join(home, '.codex'), 'skills');
}

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function definitionHash(root: string, files: readonly string[]): string {
  const hash = createHash('sha256');
  for (const relative of [...files].sort()) {
    hash.update(relative);
    hash.update('\0');
    hash.update(readFileSync(join(root, relative)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function inspectFiles(root: string, files: readonly string[]): Array<Record<string, unknown>> {
  return files.map((relative) => {
    const path = join(root, relative);
    if (!existsSync(path)) return { path, relative_path: relative, present: false };
    const content = readFileSync(path);
    return {
      path,
      relative_path: relative,
      present: true,
      bytes: statSync(path).size,
      sha256: sha256(content),
    };
  });
}

export function installSkill(target: SkillTarget, explicitDir?: string): Record<string, unknown> {
  const skillsRoot = resolveSkillsRoot(target, explicitDir);
  const canonicalTarget = join(skillsRoot, 'optivise-cli');
  const aliasTarget = join(skillsRoot, 'smart-planner-cli');
  mkdirSync(skillsRoot, { recursive: true });
  cpSync(sourceRoot('optivise-cli'), canonicalTarget, { recursive: true, force: true });
  cpSync(sourceRoot('smart-planner-cli'), aliasTarget, { recursive: true, force: true });
  const doctor = doctorSkill(target, explicitDir);
  return {
    installed: canonicalTarget,
    alias: aliasTarget,
    target,
    skill_definition_hash: doctor.skill_definition_hash,
    files: [...CANONICAL_FILES, ...ALIAS_FILES.map((path) => `../smart-planner-cli/${path}`)],
  };
}

export function doctorSkill(target: SkillTarget, explicitDir?: string): Record<string, unknown> {
  const skillsRoot = resolveSkillsRoot(target, explicitDir);
  const canonicalSource = fileURLToPath(new URL('../skills/optivise-cli/', import.meta.url));
  const canonicalTarget = join(skillsRoot, 'optivise-cli');
  const aliasTarget = join(skillsRoot, 'smart-planner-cli');
  const canonical = inspectFiles(canonicalTarget, CANONICAL_FILES);
  const alias = inspectFiles(aliasTarget, ALIAS_FILES);
  const allPresent = [...canonical, ...alias].every((file) => file.present === true);
  const expectedHash = definitionHash(canonicalSource, CANONICAL_FILES);
  const installedHash = allPresent ? definitionHash(canonicalTarget, CANONICAL_FILES) : null;
  const metadataPath = join(canonicalTarget, 'agents', 'openai.yaml');
  const metadata = existsSync(metadataPath) ? readFileSync(metadataPath, 'utf8') : '';
  const implicitInvocation = /allow_implicit_invocation:\s*true/.test(metadata);
  const ok = allPresent && installedHash === expectedHash && implicitInvocation;
  return {
    ok,
    target,
    skill_dir: canonicalTarget,
    alias_dir: aliasTarget,
    skill_definition_hash: installedHash,
    expected_skill_definition_hash: expectedHash,
    implicit_invocation: implicitInvocation,
    files: { canonical, alias },
  };
}
