import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';

import type { Session, UserConfig } from './auth.js';
import { assertSafeName, fetchWithTimeout, normalizeBackendUrl, resolveDatasetFile } from './security.js';

export interface V3ModelSummary {
  model_id: string;
  name: string;
  description: string;
  adapter_revision: string;
  solver_compatibility: string[];
  family?: string;
  decision_pattern?: string;
  when_to_use?: string[];
  when_not_to_use?: string[];
  profiles?: Array<{
    id: string;
    name?: string;
    description?: string;
    required_datasets?: string[];
    use_cases?: string[];
    constraints?: Record<string, boolean>;
    objectives?: Record<string, { enabled?: boolean; weight?: number }>;
  }>;
  limits?: Record<string, unknown>;
}

export interface V3ModelDescriptor extends V3ModelSummary {
  datasets: Array<{ name: string; description?: string; required?: boolean; max_rows?: number; max_bytes?: number; fields?: Array<{ name: string; type: string; nullable?: boolean; description?: string; examples?: unknown[]; enum_values?: string[] }> }>;
  result_datasets: Array<{ name: string; description?: string }>;
  config_schema: Record<string, unknown>;
  constraints: Array<{ id: string; name?: string; label?: string; description?: string; default_enabled?: boolean; required_datasets?: string[] }>;
  objectives: Array<{ id: string; name?: string; label?: string; description?: string; default_enabled?: boolean; default_weight?: number; minimum_weight?: number; maximum_weight?: number; required_datasets?: string[] }>;
  examples?: Array<{ config?: Record<string, unknown> }>;
  key_decision_datasets?: string[];
  structural_invariants?: unknown[];
  semantic_boundaries?: {
    supported?: string[];
    not_supported?: string[];
    important_assumptions?: string[];
    configuration_effects?: Array<{
      constraint_id: string;
      when_enabled: string;
      when_disabled: string;
      business_impact?: string;
    }>;
  };
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
  state: 'queued' | 'running' | 'cancelling' | 'cancelled' | 'succeeded' | 'failed';
  phase: string;
  progress: number;
  model_id: string;
  resolved_config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  errors?: V3ValidationError[];
  artifacts?: V3Artifact[];
  previews?: Record<string, Array<Record<string, unknown>>>;
  validation_report?: Record<string, unknown>;
  build_summary?: { model_built: boolean };
  result?: Record<string, unknown>;
}

export interface CreateV3RunRequest {
  mode: 'validate' | 'solve';
  model_id: string;
  config?: Record<string, unknown>;
}

export class V3ApiClient {
  private readonly config: UserConfig;

  constructor(
    config: UserConfig,
    private readonly session?: Session | null,
  ) {
    this.config = { backendUrl: normalizeBackendUrl(config.backendUrl) };
  }

  private url(path: string): string {
    return `${this.config.backendUrl.replace(/\/$/, '')}${path}`;
  }

  private authHeaders(): Record<string, string> {
    if (this.session?.accessToken) {
      return { Authorization: `Bearer ${this.session.accessToken}` };
    }
    return {};
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
    const resp = await fetchWithTimeout(this.url(path), { headers: this.authHeaders() });
    if (!resp.ok) {
      throw new Error(`List models failed (${resp.status}): ${await resp.text()}`);
    }
    return (await resp.json()) as { models: V3ModelSummary[]; next_cursor: string | null };
  }

  async getModel(modelId: string): Promise<V3ModelDescriptor> {
    const path = `/v3/models/${encodeURIComponent(modelId)}`;
    const resp = await fetchWithTimeout(this.url(path), { headers: this.authHeaders() });
    if (!resp.ok) {
      throw new Error(`Get model failed (${resp.status}): ${await resp.text()}`);
    }
    return (await resp.json()) as V3ModelDescriptor;
  }

  async downloadTemplate(modelId: string, dataset: string): Promise<string> {
    const path = `/v3/models/${encodeURIComponent(modelId)}/templates/${encodeURIComponent(dataset)}.csv`;
    const resp = await fetchWithTimeout(this.url(path), { headers: this.authHeaders() });
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
    form.append('request', JSON.stringify(request));
    for (const file of csvFiles) {
      const content = readFileSync(file.path);
      const filename = `${file.dataset}.csv`;
      form.append('files', new Blob([content], { type: 'text/csv' }), filename);
    }

    const path = '/v3/runs';
    const resp = await fetchWithTimeout(this.url(path), {
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
    const resp = await fetchWithTimeout(this.url(path), { headers: this.authHeaders() });
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
    options: {
      onProgress?: (run: V3Run) => void;
      maxAttempts?: number;
      maxWaitMs?: number;
    } = {},
  ): Promise<{ run: V3Run; timedOut: boolean }> {
    const maxAttempts = options.maxAttempts ?? 120;
    const maxWaitMs = options.maxWaitMs;
    const startedAt = Date.now();

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const { run, retryAfterMs } = await this.getRun(runId);
      if (options.onProgress) {
        options.onProgress(run);
      }
      if (run.state === 'succeeded' || run.state === 'failed' || run.state === 'cancelled') {
        return { run, timedOut: false };
      }
      if (maxWaitMs != null && Date.now() - startedAt >= maxWaitMs) {
        return { run, timedOut: true };
      }
      const delay = retryAfterMs ?? 2000;
      if (maxWaitMs != null) {
        const remaining = maxWaitMs - (Date.now() - startedAt);
        if (remaining <= 0) {
          return { run, timedOut: true };
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(delay, remaining)));
      } else {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    const { run } = await this.getRun(runId);
    return { run, timedOut: run.state !== 'succeeded' && run.state !== 'failed' && run.state !== 'cancelled' };
  }

  async downloadArtifact(runId: string, artifactId: string): Promise<string> {
    const path = `/v3/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`;
    const resp = await fetchWithTimeout(this.url(path), {
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

  async cancelRun(runId: string): Promise<Record<string, unknown>> {
    const resp = await fetchWithTimeout(this.url(`/v3/runs/${encodeURIComponent(runId)}/cancel`), { method: 'POST', headers: this.authHeaders() });
    if (!resp.ok) throw new Error(`Cancel run failed (${resp.status}): ${await resp.text()}`);
    return await resp.json() as Record<string, unknown>;
  }

  async listRuns(): Promise<Record<string, unknown>> {
    const resp = await fetchWithTimeout(this.url('/v3/runs'), { headers: this.authHeaders() });
    if (!resp.ok) throw new Error(`List runs failed (${resp.status}): ${await resp.text()}`);
    return await resp.json() as Record<string, unknown>;
  }
}

export function collectCsvFiles(dataDir: string, datasetNames: string[]): Array<{ dataset: string; path: string }> {
  return datasetNames.map((dataset) => ({ dataset, path: resolveDatasetFile(dataDir, dataset) }));
}

export function discoverCsvFiles(dataDir: string): Array<{ dataset: string; path: string }> {
  return readdirSync(dataDir)
    .filter((name: string) => name.endsWith('.csv'))
    .sort()
    .map((name: string) => {
      const dataset = assertSafeName(basename(name, '.csv'), 'dataset name');
      return { dataset, path: resolveDatasetFile(dataDir, dataset) };
    });
}
