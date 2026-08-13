import type { Identity, UserConfig } from './auth.js';
import { signRequest } from './auth.js';

export interface RemoteSolveResult {
  status: string;
  feasible: boolean;
  objective_value?: number | null;
  runtime_seconds?: number | null;
  metadata?: Record<string, unknown>;
  excel_b64?: string;
}

export class ApiClient {
  constructor(
    private readonly config: UserConfig,
    private readonly identity: Identity,
  ) {}

  private url(path: string): string {
    return `${this.config.backendUrl.replace(/\/$/, '')}${path}`;
  }

  async register(): Promise<void> {
    const resp = await fetch(this.url('/v1/cli/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.identity.clientId,
        client_secret: this.identity.clientSecret,
      }),
    });
    if (resp.status === 409) {
      return;
    }
    if (!resp.ok) {
      throw new Error(`Register failed (${resp.status}): ${await resp.text()}`);
    }
  }

  async startTemplateSolve(body: Record<string, unknown>): Promise<string> {
    const path = '/v1/solve/template';
    const raw = Buffer.from(JSON.stringify(body));
    const resp = await fetch(this.url(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...signRequest(this.identity, 'POST', path, raw),
      },
      body: raw,
    });
    if (!resp.ok) {
      throw new Error(`Template solve start failed (${resp.status}): ${await resp.text()}`);
    }
    const payload = (await resp.json()) as { solve_id: string };
    return payload.solve_id;
  }

  async startRemoteSolve(body: Record<string, unknown>): Promise<string> {
    const path = '/v1/solve/model';
    const raw = Buffer.from(JSON.stringify(body));
    const resp = await fetch(this.url(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...signRequest(this.identity, 'POST', path, raw),
      },
      body: raw,
    });
    if (!resp.ok) {
      throw new Error(`Remote solve start failed (${resp.status}): ${await resp.text()}`);
    }
    const payload = (await resp.json()) as { solve_id: string };
    return payload.solve_id;
  }

  async pollSolve(
    solveId: string,
    onProgress?: (progress: Record<string, unknown>) => void,
  ): Promise<RemoteSolveResult> {
    const path = `/v1/solve/runs/${solveId}`;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const resp = await fetch(this.url(path), {
        headers: signRequest(this.identity, 'GET', path),
      });
      if (!resp.ok) {
        throw new Error(`Poll failed (${resp.status}): ${await resp.text()}`);
      }
      const payload = (await resp.json()) as {
        status: string;
        progress?: Record<string, unknown>;
        result?: RemoteSolveResult;
        error?: string;
      };
      if (payload.progress && onProgress) {
        onProgress(payload.progress);
      }
      if (payload.status === 'finished' && payload.result) {
        return payload.result;
      }
      if (payload.status === 'error') {
        throw new Error(payload.error ?? 'Remote solve failed');
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Remote solve timed out');
  }

  async startChat(convoId: string, message: string): Promise<string> {
    const path = '/v1/chat';
    const body = {
      convo_id: convoId,
      message,
      user_uid: this.identity.clientId,
      source_type: 'local_excel',
      source_id: '',
      access_token: '',
    };
    const raw = Buffer.from(JSON.stringify(body));
    const resp = await fetch(this.url(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...signRequest(this.identity, 'POST', path, raw),
      },
      body: raw,
    });
    if (!resp.ok) {
      throw new Error(`Chat start failed (${resp.status}): ${await resp.text()}`);
    }
    return ((await resp.json()) as { run_id: string }).run_id;
  }

  async pollChat(runId: string): Promise<{ status: string; text?: string; error?: string }> {
    const path = `/v1/chat/runs/${runId}`;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const resp = await fetch(this.url(path), {
        headers: signRequest(this.identity, 'GET', path),
      });
      if (!resp.ok) {
        throw new Error(`Chat poll failed (${resp.status}): ${await resp.text()}`);
      }
      const payload = (await resp.json()) as { status: string; text?: string; error?: string };
      if (payload.status === 'finished' || payload.status === 'error') {
        return payload;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('Chat timed out');
  }
}
