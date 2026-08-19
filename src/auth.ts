import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { normalizeBackendUrl } from './security.js';

export interface Session {
  accessToken: string;
  tokenType: string;
  principalId: string;
  email?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface UserConfig {
  backendUrl: string;
}

// Replaced in dist/auth.js by scripts/inject-packaged-backend.mjs.
export const PACKAGED_BACKEND_URL = '__OPTIVISE_PACKAGED_BACKEND_URL__';

function identityDir(): string { return process.env.OPTIVISE_HOME?.trim() || join(homedir(), '.optivise'); }
function identityPath(name: string): string { return join(identityDir(), name); }

export function ensureIdentityDir(): void {
  mkdirSync(identityDir(), { recursive: true });
}

export function loadConfig(): UserConfig | null {
  const path = identityPath('config.json');
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as UserConfig;
}

export function resolveBackendUrl(explicit?: string): UserConfig {
  if (explicit) {
    return { backendUrl: normalizeBackendUrl(explicit) };
  }
  const config = loadConfig();
  if (config?.backendUrl) {
    return { backendUrl: normalizeBackendUrl(config.backendUrl) };
  }
  const fromEnv = process.env.SMART_PLANNER_BACKEND_URL?.trim();
  if (fromEnv) {
    return { backendUrl: normalizeBackendUrl(fromEnv) };
  }
  if (PACKAGED_BACKEND_URL && !PACKAGED_BACKEND_URL.startsWith('__OPTIVISE_')) {
    return { backendUrl: normalizeBackendUrl(PACKAGED_BACKEND_URL) };
  }
  throw new Error('backend_not_configured');
}

export function saveConfig(config: UserConfig): void {
  ensureIdentityDir();
  writeFileSync(identityPath('config.json'), JSON.stringify(config, null, 2), 'utf8');
}

export function loadSession(): Session | null {
  const path = identityPath('session.json');
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Session;
}

export function saveSession(session: Session): void {
  ensureIdentityDir();
  const path = identityPath('session.json');
  writeFileSync(path, JSON.stringify(session, null, 2), 'utf8');
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows may not support chmod the same way.
  }
}

export function deleteIdentity(): void {
  const path = identityPath('identity.json');
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function deleteSession(): void {
  const path = identityPath('session.json');
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function clearCredentials(): void {
  deleteIdentity();
  deleteSession();
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function randomUrlSafe(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
