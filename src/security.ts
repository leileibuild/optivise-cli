import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep));
}

export function assertSafeName(value: string, label: string): string {
  if (!SAFE_NAME.test(value) || value === '.' || value === '..') {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
  return value;
}

export function assertSafeFilename(filename: string): string {
  assertSafeName(filename, 'artifact filename');
  if (basename(filename) !== filename || !filename.endsWith('.csv')) {
    throw new Error(`Unsafe artifact filename: ${filename}`);
  }
  return filename;
}

export function resolveDatasetFile(dataDir: string, dataset: string): string {
  const safeDataset = assertSafeName(dataset, 'dataset name');
  const root = realpathSync(dataDir);
  const candidate = resolve(root, `${safeDataset}.csv`);
  let actual: string;
  try {
    actual = realpathSync(candidate);
  } catch {
    throw new Error(`Missing dataset file: ${candidate}`);
  }
  if (!isInside(root, actual) || !statSync(actual).isFile()) {
    throw new Error(`Dataset file escapes the data directory: ${candidate}`);
  }
  return actual;
}

export function resolveOutputFile(outDir: string, filename: string): string {
  const safeFilename = assertSafeFilename(filename);
  const root = resolve(outDir);
  const candidate = resolve(root, safeFilename);
  if (!isInside(root, candidate)) {
    throw new Error(`Artifact path escapes the output directory: ${filename}`);
  }
  try {
    if (lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`Artifact path is a symbolic link: ${filename}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Artifact path is a symbolic link:')) {
      throw error;
    }
    // A new artifact is expected not to exist yet.
  }
  return candidate;
}

export function normalizeBackendUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error(`Invalid backend URL: ${raw}`);
  }
  const localHttp = parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !localHttp) {
    throw new Error('Backend URL must use HTTPS. Plain HTTP is allowed only for localhost development.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Backend URL must not contain credentials, a query string, or a fragment.');
  }
  return parsed.toString().replace(/\/$/, '');
}

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function inspectFile(path: string): { path: string; bytes: number; sha256: string } {
  const content = readFileSync(path);
  return {
    path: realpathSync(path),
    bytes: content.byteLength,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}
