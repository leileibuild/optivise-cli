import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface MappingRule { source: string; target_dataset: string; columns?: Record<string, string>; select?: string[]; defaults?: Record<string, string | number | boolean | null>; types?: Record<string, 'string' | 'number' | 'integer' | 'boolean'> }
export interface MappingDocument { schema_version: number; rules: MappingRule[] }
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.length === 0) quoted = true;
    else if (ch === ',') { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && source[i + 1] === '\n') i += 1; row.push(cell.trim()); cell = ''; if (row.some((v) => v !== '')) rows.push(row); row = []; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell.trim()); if (row.some((v) => v !== '')) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift()!;
  return rows.map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ''])));
}

export function parseInput(text: string, format: 'csv' | 'json'): Record<string, unknown>[] {
  if (format === 'csv') return parseCsv(text);
  const value = JSON.parse(text) as unknown;
  if (Array.isArray(value)) return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('JSON input must be an array of objects');
    return item as Record<string, unknown>;
  });
  if (value && typeof value === 'object' && !Array.isArray(value)) return [value as Record<string, unknown>];
  throw new Error('JSON input must be an object or an array of objects');
}
export function toCsv(rows: Record<string, unknown>[]): string { if (!rows.length) return ''; const headers = Object.keys(rows[0]); const q = (v: unknown) => { const s = String(v ?? ''); return /[,"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s }; return [headers.join(','), ...rows.map((r) => headers.map((h) => q(r[h])).join(','))].join('\n') + '\n'; }
function convert(value: unknown, type?: 'string' | 'number' | 'integer' | 'boolean'): unknown { if (!type) return value; if (type === 'number') { const n = Number(value); if (!Number.isFinite(n)) throw new Error(`Cannot convert value to number: ${value}`); return n; } if (type === 'integer') { const n = Number(value); if (!Number.isInteger(n)) throw new Error(`Cannot convert value to integer: ${value}`); return n; } if (type === 'boolean') { if (value === true || value === 1) return true; if (value === false || value === 0) return false; if (typeof value === 'string') { const normalized = value.trim().toLowerCase(); if (normalized === 'true' || normalized === '1') return true; if (normalized === 'false' || normalized === '0') return false; } throw new Error(`Cannot convert value to boolean: ${value}`); } return String(value); }
export function applyMapping(input: string, rule: MappingRule, format: 'csv' | 'json' = 'csv'): Record<string, unknown>[] { const rows = parseInput(input, format); return rows.map((row) => { const out: Record<string, unknown> = {}; for (const [target, source] of Object.entries(rule.columns ?? {})) { if (!(source in row)) throw new Error(`Missing source column: ${source}`); out[target] = convert(row[source], rule.types?.[target]); } for (const [target, value] of Object.entries(rule.defaults ?? {})) if (out[target] == null || out[target] === '') out[target] = value; if (rule.select) for (const key of Object.keys(out)) if (!rule.select.includes(key)) delete out[key]; return out; }); }
export function loadMapping(path: string): MappingDocument { const value = JSON.parse(readFileSync(resolve(path), 'utf8')) as MappingDocument; if (value.schema_version !== 1 || !Array.isArray(value.rules)) throw new Error('mapping.json must have schema_version=1 and rules[]'); return value; }
export function saveCsv(path: string, rows: Record<string, unknown>[]): void { writeFileSync(path, toCsv(rows), 'utf8'); }
