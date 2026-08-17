import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  pkceChallenge,
  randomUrlSafe,
  saveSession,
  type Session,
  type UserConfig,
} from './auth.js';
import { fetchWithTimeout } from './security.js';

const execFileAsync = promisify(execFile);

interface DeviceStartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface DeviceTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  principal_id: string;
  email?: string;
}

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      // cmd.exe treats '&' as a command separator and drops ?state=... from auth URLs.
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${url.replace(/'/g, "''")}'`],
        { windowsHide: true },
      );
      return;
    }
    if (platform === 'darwin') {
      await execFileAsync('open', [url]);
      return;
    }
    await execFileAsync('xdg-open', [url]);
  } catch {
    console.error(`Open this URL in your browser:\n${url}`);
  }
}

function buildAuthUrl(backendUrl: string, userCode: string, state: string): string {
  const base = `${backendUrl.replace(/\/$/, '')}/auth?user_code=${encodeURIComponent(userCode)}`;
  // Put state in the hash so Windows shell openers never strip it at '&'.
  return `${base}#state=${encodeURIComponent(state)}`;
}

export async function loginWithBrowser(
  config: UserConfig,
  options?: { localDev?: boolean },
): Promise<Session> {
  const codeVerifier = randomUrlSafe(48);
  const codeChallenge = pkceChallenge(codeVerifier);
  const state = randomUrlSafe(24);
  const startResp = await fetchWithTimeout(`${config.backendUrl}/v3/auth/device/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code_challenge: codeChallenge,
      state,
    }),
  });
  if (!startResp.ok) {
    throw new Error(`Device auth start failed (${startResp.status}): ${await startResp.text()}`);
  }
  const started = (await startResp.json()) as DeviceStartResponse;
  const authUrl = buildAuthUrl(config.backendUrl, started.user_code, state);
  console.error(`Device code: ${started.user_code}`);
  console.error(`Opening browser for sign-in: ${authUrl}`);

  if (options?.localDev) {
    const approveResp = await fetchWithTimeout(`${config.backendUrl}/v3/auth/device/local-authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_code: started.user_code, state }),
    });
    if (!approveResp.ok) {
      throw new Error(`Local authorize failed (${approveResp.status}): ${await approveResp.text()}`);
    }
  } else {
    await openBrowser(authUrl);
  }

  const pollPath = '/v3/auth/device/token';
  const deadline = Date.now() + (started.expires_in ?? 600) * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, (started.interval ?? 2) * 1000));
    const tokenResp = await fetchWithTimeout(`${config.backendUrl}${pollPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_code: started.device_code,
        code_verifier: codeVerifier,
      }),
    });
    if (tokenResp.status === 428) {
      continue;
    }
    if (!tokenResp.ok) {
      throw new Error(`Device auth failed (${tokenResp.status}): ${await tokenResp.text()}`);
    }
    const payload = (await tokenResp.json()) as DeviceTokenResponse;
    const session: Session = {
      accessToken: payload.access_token,
      tokenType: payload.token_type,
      principalId: payload.principal_id,
      email: payload.email,
      expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    saveSession(session);
    return session;
  }
  throw new Error('Sign-in timed out before the browser flow completed');
}

export function sessionSummary(session: Session | null): string {
  return session?.principalId ?? 'anonymous';
}
