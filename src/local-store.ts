import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface RunRecord { run_id: string; model_id?: string; mode?: string; status?: string; created_at: string; [key: string]: unknown }

export function storeRoot(): string {
  return process.env.OPTIVISE_HOME?.trim() || join(homedir(), '.optivise');
}
export function ensureStore(root = storeRoot()): string {
  for (const p of [root, join(root, 'profiles'), join(root, 'manifests'), join(root, 'runs'), join(root, 'artifacts')]) mkdirSync(p, { recursive: true });
  return root;
}
export function writeJson(path: string, value: unknown): void { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8'); }
export function readJson<T>(path: string): T { return JSON.parse(readFileSync(path, 'utf8')) as T; }
export function recordRun(record: RunRecord, root = storeRoot()): void {
  ensureStore(root); const path = join(root, 'runs', 'index.jsonl');
  writeFileSync(path, JSON.stringify(record) + '\n', { encoding: 'utf8', flag: 'a' });
}
export function listRuns(root = storeRoot()): RunRecord[] {
  const path = join(root, 'runs', 'index.jsonl'); if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as RunRecord);
}
export function saveManifest(id: string, manifest: unknown, root = storeRoot()): string { ensureStore(root); const p = join(root, 'manifests', `${id}.json`); writeJson(p, manifest); return p; }
export function loadManifest(idOrPath: string, root = storeRoot()): { path: string; value: any } {
  const p = existsSync(idOrPath) ? resolve(idOrPath) : join(root, 'manifests', `${idOrPath}.json`); if (!existsSync(p)) throw new Error(`Manifest not found: ${idOrPath}`); return { path: p, value: readJson(p) };
}
export function cleanupStore(retentionHours = 24, root = storeRoot()): void {
  const cutoff = Date.now() - retentionHours * 3600_000; ensureStore(root);
  for (const dir of ['manifests', 'profiles', 'artifacts']) for (const name of readdirSync(join(root, dir))) {
    const path = join(root, dir, name); try { if (requireMtime(path) < cutoff) rmSync(path, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
function requireMtime(path: string): number { return statSync(path).mtimeMs; }
