import { createHash, createHmac, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Identity {
  clientSecret: string;
  clientId: string;
  createdAt: string;
}

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

const IDENTITY_DIR = join(homedir(), '.smartplanner');
const IDENTITY_PATH = join(IDENTITY_DIR, 'identity.json');
const SESSION_PATH = join(IDENTITY_DIR, 'session.json');
const CONFIG_PATH = join(IDENTITY_DIR, 'config.json');

export function ensureIdentityDir(): void {
  mkdirSync(IDENTITY_DIR, { recursive: true });
}

export function loadConfig(): UserConfig | null {
  if (!existsSync(CONFIG_PATH)) {
    return null;
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as UserConfig;
}

export function resolveBackendUrl(explicit?: string): UserConfig {
  if (explicit) {
    return { backendUrl: explicit.replace(/\/$/, '') };
  }
  const config = loadConfig();
  if (config?.backendUrl) {
    return { backendUrl: config.backendUrl.replace(/\/$/, '') };
  }
  const fromEnv = process.env.SMART_PLANNER_BACKEND_URL?.trim();
  if (fromEnv) {
    return { backendUrl: fromEnv.replace(/\/$/, '') };
  }
  throw new Error('Missing backend URL. Run: smart-planner login --backend-url <url>');
}

export function saveConfig(config: UserConfig): void {
  ensureIdentityDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

export function loadIdentity(): Identity | null {
  if (!existsSync(IDENTITY_PATH)) {
    return null;
  }
  return JSON.parse(readFileSync(IDENTITY_PATH, 'utf8')) as Identity;
}

export function loadSession(): Session | null {
  if (!existsSync(SESSION_PATH)) {
    return null;
  }
  return JSON.parse(readFileSync(SESSION_PATH, 'utf8')) as Session;
}

export function saveIdentity(identity: Identity): void {
  ensureIdentityDir();
  writeFileSync(IDENTITY_PATH, JSON.stringify(identity, null, 2), 'utf8');
  try {
    chmodSync(IDENTITY_PATH, 0o600);
  } catch {
    // Windows may not support chmod the same way.
  }
}

export function saveSession(session: Session): void {
  ensureIdentityDir();
  writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2), 'utf8');
  try {
    chmodSync(SESSION_PATH, 0o600);
  } catch {
    // Windows may not support chmod the same way.
  }
}

export function deleteIdentity(): void {
  if (existsSync(IDENTITY_PATH)) {
    unlinkSync(IDENTITY_PATH);
  }
}

export function deleteSession(): void {
  if (existsSync(SESSION_PATH)) {
    unlinkSync(SESSION_PATH);
  }
}

export function clearCredentials(): void {
  deleteIdentity();
  deleteSession();
}

export function generateIdentity(): Identity {
  const raw = randomBytes(32);
  const clientSecret = raw.toString('base64');
  const clientId = createHash('sha256').update(clientSecret, 'utf8').digest('hex');
  return {
    clientSecret,
    clientId,
    createdAt: new Date().toISOString(),
  };
}

export function bodySha256Hex(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

export function signRequest(
  identity: Identity,
  method: string,
  path: string,
  body: Buffer | string = '',
): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyHash = bodySha256Hex(body);
  const canonical = `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`;
  const signature = createHmac('sha256', identity.clientSecret).update(canonical).digest('hex');
  return {
    'X-Client-Id': identity.clientId,
    'X-Timestamp': timestamp,
    'X-Signature': signature,
  };
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function randomUrlSafe(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
