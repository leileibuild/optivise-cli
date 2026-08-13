import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export interface PatchOperation {
  path: string;
  op: 'replace';
  content: string;
}

export interface PatchDocument {
  patches: PatchOperation[];
}

const ALLOWED_PREFIXES = ['src/', 'smartplanner.config.yaml'];

export function extractPatches(text: string): PatchDocument | null {
  const fenced = text.match(/```(?:json|smartplanner-patches)\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? text.trim();
  try {
    const parsed = JSON.parse(candidate) as PatchDocument;
    if (!Array.isArray(parsed.patches)) {
      return null;
    }
    return parsed;
  } catch {
    const inline = text.match(/\{\s*"patches"\s*:\s*\[[\s\S]*\]\s*\}/);
    if (!inline) {
      return null;
    }
    try {
      return JSON.parse(inline[0]) as PatchDocument;
    } catch {
      return null;
    }
  }
}

export function validatePatchPath(projectRoot: string, relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/');
  if (!ALLOWED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix))) {
    throw new Error(`Patch path not allowed: ${relPath}`);
  }
  return join(projectRoot, normalized);
}

export function applyPatches(projectRoot: string, doc: PatchDocument): string[] {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = join(projectRoot, '.smartplanner', 'backups', timestamp);
  mkdirSync(backupRoot, { recursive: true });
  const changed: string[] = [];

  for (const patch of doc.patches) {
    if (patch.op !== 'replace') {
      throw new Error(`Unsupported patch op: ${patch.op}`);
    }
    const target = validatePatchPath(projectRoot, patch.path);
    if (existsSync(target)) {
      cpSync(target, join(backupRoot, basename(patch.path)));
    } else {
      mkdirSync(resolve(target, '..'), { recursive: true });
    }
    writeFileSync(target, patch.content, 'utf8');
    changed.push(patch.path);
  }

  return changed;
}

export function loadYamlConfig(projectRoot: string): Record<string, unknown> {
  const configPath = join(projectRoot, 'smartplanner.config.yaml');
  if (!existsSync(configPath)) {
    return {};
  }
  const text = readFileSync(configPath, 'utf8');
  const lines = text.split('\n');
  const config: Record<string, unknown> = {};
  for (const line of lines) {
    const match = /^(\w+):\s*(.+)$/.exec(line.trim());
    if (match) {
      config[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return config;
}
