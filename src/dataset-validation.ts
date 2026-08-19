import { readFileSync, statSync } from 'node:fs';

import type { V3ModelDescriptor } from './v3-client.js';

type DatasetDescriptor = V3ModelDescriptor['datasets'][number];
type FieldDescriptor = NonNullable<DatasetDescriptor['fields']>[number];

export interface DatasetDiagnostic {
  code: string;
  message: string;
  dataset: string;
  line?: number;
  column?: string;
  value?: string;
  expected?: string;
  suggestion?: string;
}

interface CsvRecord {
  values: string[];
  line: number;
}

interface CsvTable {
  headers: string[];
  records: CsvRecord[];
}

export class DatasetValidationError extends Error {
  constructor(readonly diagnostics: DatasetDiagnostic[]) {
    const first = diagnostics[0];
    const location = first?.column ? ` (${first.dataset}.${first.column}, line ${first.line ?? '?'})` : '';
    super(`Dataset validation failed: ${first?.code ?? 'invalid_dataset'}${location}: ${first?.message ?? 'invalid dataset'}`);
    this.name = 'DatasetValidationError';
  }
}

function parseStrictCsv(text: string): CsvTable {
  const source = text.replace(/^\uFEFF/, '');
  const rows: CsvRecord[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  const finishRow = (): void => {
    row.push(cell);
    if (row.some((value) => value !== '')) rows.push({ values: row, line: rowLine });
    row = [];
    cell = '';
    rowLine = line + 1;
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else { cell += ch; if (ch === '\n') line += 1; }
    } else if (ch === '"' && cell.length === 0) quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      finishRow();
      line += 1;
      rowLine = line;
    } else cell += ch;
  }
  if (quoted) throw new Error(`Unclosed quoted field at line ${rowLine}`);
  if (cell.length || row.length) finishRow();
  if (!rows.length) return { headers: [], records: [] };
  return { headers: rows[0].values, records: rows.slice(1) };
}

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

function expected(field: FieldDescriptor): string {
  if (field.type === 'boolean') return 'true or false';
  if (field.type === 'date') return 'YYYY-MM-DD';
  if (field.type === 'datetime') return 'an ISO 8601 datetime with Z or an explicit UTC offset';
  if (field.type === 'enum') return `one of: ${(field.enum_values ?? []).join(', ')}`;
  return field.type;
}

function validScalar(value: string, field: FieldDescriptor): boolean {
  if (value === '') return field.nullable === true;
  if (field.type === 'string') return true;
  if (field.type === 'integer' || field.type === 'duration') return /^[+-]?\d+$/.test(value);
  if (field.type === 'number') return Number.isFinite(Number(value));
  if (field.type === 'boolean') return value === 'true' || value === 'false';
  if (field.type === 'date') return isValidDate(value);
  if (field.type === 'datetime') return /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  if (field.type === 'enum') return (field.enum_values ?? []).includes(value);
  return false;
}

export function validateDatasetCsv(text: string, descriptor: DatasetDescriptor): DatasetDiagnostic[] {
  const fields = descriptor.fields ?? [];
  let table: CsvTable;
  try {
    table = parseStrictCsv(text);
  } catch (error) {
    return [{ code: 'invalid_csv', message: String(error), dataset: descriptor.name, line: 1, expected: 'RFC 4180-compatible CSV' }];
  }
  const expectedHeaders = fields.map((field) => field.name);
  if (!table.headers.length) {
    return [{ code: 'missing_header', message: 'CSV is empty and has no header row', dataset: descriptor.name, line: 1, expected: expectedHeaders.join(',') }];
  }
  const diagnostics: DatasetDiagnostic[] = [];
  const duplicates = [...new Set(table.headers.filter((header, index) => table.headers.indexOf(header) !== index))];
  if (duplicates.length) diagnostics.push({ code: 'duplicate_header', message: `CSV headers must be unique: ${duplicates.join(', ')}`, dataset: descriptor.name, line: 1, expected: expectedHeaders.join(',') });
  if (table.headers.length !== expectedHeaders.length || table.headers.some((header, index) => header !== expectedHeaders[index])) diagnostics.push({ code: 'header_mismatch', message: 'CSV headers do not exactly match the model template', dataset: descriptor.name, line: 1, expected: expectedHeaders.join(','), suggestion: 'Use the descriptor headers with the same spelling and order' });
  if (descriptor.max_rows != null && table.records.length > descriptor.max_rows) diagnostics.push({ code: 'too_many_rows', message: `Dataset exceeds the ${descriptor.max_rows} row limit`, dataset: descriptor.name, expected: `at most ${descriptor.max_rows} data rows` });

  for (let recordIndex = 0; recordIndex < table.records.length; recordIndex += 1) {
    const record = table.records[recordIndex];
    if (record.values.length !== fields.length) {
      diagnostics.push({ code: 'wrong_column_count', message: `Row has ${record.values.length} values but ${fields.length} are required`, dataset: descriptor.name, line: record.line, expected: expectedHeaders.join(',') });
      continue;
    }
    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
      const field = fields[fieldIndex];
      const value = record.values[fieldIndex];
      if (!validScalar(value, field)) diagnostics.push({ code: `invalid_${field.type}`, message: `${field.name} must be ${expected(field)}`, dataset: descriptor.name, line: record.line, column: field.name, value, expected: expected(field), suggestion: field.type === 'boolean' ? 'Use lowercase true or false' : undefined });
    }
  }
  return diagnostics;
}

export function validateDatasetFiles(
  descriptor: V3ModelDescriptor,
  csvFiles: Array<{ dataset: string; path: string }>,
): DatasetDiagnostic[] {
  const byName = new Map(descriptor.datasets.map((dataset) => [dataset.name, dataset]));
  const diagnostics: DatasetDiagnostic[] = [];
  for (const file of csvFiles) {
    const dataset = byName.get(file.dataset);
    if (!dataset) {
      diagnostics.push({ code: 'unknown_dataset', message: `Dataset ${file.dataset} is not declared by the model`, dataset: file.dataset });
      continue;
    }
    if (dataset.max_bytes != null && statSync(file.path).size > dataset.max_bytes) diagnostics.push({ code: 'dataset_too_large', message: `Dataset exceeds the ${dataset.max_bytes} byte limit`, dataset: file.dataset, expected: `at most ${dataset.max_bytes} bytes` });
    diagnostics.push(...validateDatasetCsv(readFileSync(file.path, 'utf8'), dataset));
  }
  return diagnostics;
}
