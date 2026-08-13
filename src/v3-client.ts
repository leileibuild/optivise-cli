import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { Identity, UserConfig } from './auth.js';

export interface V3ModelSummary {
  model_id: string;
  name: string;
  description: string;
  adapter_revision: string;
  solver_compatibility: string[];
  datasets: Array<{ name: string; description?: string; required?: boolean }>;
  result_datasets: Array<{ name: string; description?: string }>;
}

export interface V3ModelDescriptor extends V3ModelSummary {
  config_schema: Record<string, unknown>;
  constraints: Array<{ id: string; label: string; description?: string; default?: boolean }>;
  objectives: Array<{ id: string; label: string; description?: string; default?: boolean }>;
  examples?: Array<{ config?: Record<string, unknown> }>;
}

export interface V3ValidationError {
  code: string;
  message: string;
  dataset?: string;
  record?: number;
  line?: number;
  column?: string;
  value?: string;
  expected?: string;
  suggestion?: string;
}

export interface V3Artifact {
  artifact_id: string;
  dataset: string;
  filename: string;
  content_type: string;
  rows?: number;
  sha256?: string;
  download_url: string;
}

export interface V3Run {
  run_id: string;
  mode: 'validate' | 'solve';
  state: 'queued' | 'running' | 'succeeded' | 'failed';
  phase: string;
  progress: number;
  model_id: string;
  resolved_config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  errors?: V3ValidationError[];
  summary?: Record<string, unknown>;
  artifacts?: V3Artifact[];
  previews?: Record<string, Array<Record<string, unknown>>>;
  validation_report?: Record<string, unknown>;
  build_summary?: { model_built: boolean };
}

export interface CreateV3RunRequest {
  mode: 'validate' | 'solve';
  model_id: string;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export class V3ApiClient {
  constructor(
    private readonly config: UserConfig,
    private readonly identity?: Identity,
  ) {}

  private url(path: string): string {
    return `${this.config.backendUrl.replace(/\/$/, '')}${path}`;
  }

  private authHeaders(): Record<string, string> {
    if (!this.identity) {
      return {};
    }
    return { Authorization: `Bearer ${this.identity.clientId}` };
  }

  async listModels(cursor?: string, limit?: number): Promise<{ models: V3ModelSummary[]; next_cursor: string | null }> {
    const params = new URLSearchParams();
    if (cursor) {
      params.set('cursor', cursor);
    }
    if (limit != null) {
      params.set('limit', String(limit));
    }
    const query = params.toString();
    const path = `/v3/models${query ? `?${query}` : ''}`;
    const resp = await fetch(this.url(path), { headers: this.authHeaders() });
    if (!resp.ok) {
      throw new Error(`List models failed (${resp.status}): ${await resp.text()}`);
    }
    return (await resp.json()) as { models: V3ModelSummary[]; next_cursor: string | null };
  }

  async getModel(modelId: string): Promise<V3ModelDescriptor> {
    const path = `/v3/models/${encodeURIComponent(modelId)}`;
    const resp = await fetch(this.url(path), { headers: this.authHeaders() });
    if (!resp.ok) {
      throw new Error(`Get model failed (${resp.status}): ${await resp.text()}`);
    }
    return (await resp.json()) as V3ModelDescriptor;
  }

  async downloadTemplate(modelId: string, dataset: string): Promise<string> {
    const path = `/v3/models/${encodeURIComponent(modelId)}/templates/${encodeURIComponent(dataset)}.csv`;
    const resp = await fetch(this.url(path), { headers: this.authHeaders() });
    if (!resp.ok) {
      throw new Error(`Download template failed (${resp.status}): ${await resp.text()}`);
    }
    return resp.text();
  }

  async createRun(
    request: CreateV3RunRequest,
    csvFiles: Array<{ dataset: string; path: string }>,
    idempotencyKey: string = randomUUID(),
  ): Promise<{ run: V3Run; location: string }> {
    const form = new FormData();
    form.append(
      'request',
      new Blob([JSON.stringify(request)], { type: 'application/json' }),
    );
    for (const file of csvFiles) {
      const content = readFileSync(file.path);
      const filename = `${file.dataset}.csv`;
      form.append('files', new File([content], filename, { type: 'text/csv' }));
    }

    const path = '/v3/runs';
    const resp = await fetch(this.url(path), {
      method: 'POST',
      headers: {
        ...this.authHeaders(),
        'Idempotency-Key': idempotencyKey,
      },
      body: form,
    });
    if (!resp.ok) {
      throw new Error(`Create run failed (${resp.status}): ${await resp.text()}`);
    }
    const location = resp.headers.get('Location') ?? '';
    return { run: (await resp.json()) as V3Run, location };
  }

  async getRun(runId: string): Promise<{ run: V3Run; retryAfterMs: number | null }> {
    const path = `/v3/runs/${encodeURIComponent(runId)}`;
    const resp = await fetch(this.url(path), { headers: this.authHeaders() });
    if (!resp.ok) {
      throw new Error(`Get run failed (${resp.status}): ${await resp.text()}`);
    }
    const retryAfter = resp.headers.get('Retry-After');
    return {
      run: (await resp.json()) as V3Run,
      retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : null,
    };
  }

  async pollRun(
    runId: string,
    onProgress?: (run: V3Run) => void,
    maxAttempts = 120,
  ): Promise<V3Run> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const { run, retryAfterMs } = await this.getRun(runId);
      if (onProgress) {
        onProgress(run);
      }
      if (run.state === 'succeeded' || run.state === 'failed') {
        return run;
      }
      const delay = retryAfterMs ?? 2000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    throw new Error('Run timed out');
  }

  async downloadArtifact(runId: string, artifactId: string): Promise<string> {
    const path = `/v3/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`;
    const resp = await fetch(this.url(path), {
      headers: {
        ...this.authHeaders(),
        Accept: 'text/csv',
      },
    });
    if (!resp.ok) {
      throw new Error(`Download artifact failed (${resp.status}): ${await resp.text()}`);
    }
    return resp.text();
  }
}

export function collectCsvFiles(dataDir: string, datasetNames: string[]): Array<{ dataset: string; path: string }> {
  return datasetNames.map((dataset) => ({
    dataset,
    path: join(dataDir, `${dataset}.csv`),
  }));
}

export function discoverCsvFiles(dataDir: string): Array<{ dataset: string; path: string }> {
  return readdirSync(dataDir)
    .filter((name: string) => name.endsWith('.csv'))
    .map((name: string) => ({
      dataset: basename(name, '.csv'),
      path: join(dataDir, name),
    }));
}
