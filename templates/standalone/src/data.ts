import type {
  DataAdapter,
  ModelAdapter,
  PreparedData,
  ResolvedConfig,
  Solution,
  WorkbookSnapshot,
  WritePlan,
} from '@smart-planner/adapter-sdk';
import { ValidationError, tabToRecords } from '@smart-planner/adapter-sdk';

const INPUT_SHEET = 'Input';
const OUTPUT_SHEET = 'Output';

export const dataAdapter: DataAdapter = {
  prepare(snapshot: WorkbookSnapshot, config: ResolvedConfig): PreparedData {
    void config;
    if (!snapshot.tabs[INPUT_SHEET]) {
      throw new ValidationError('Missing required sheet: Input', { sheet: INPUT_SHEET });
    }
    const records = tabToRecords(snapshot.tabs[INPUT_SHEET] as unknown[][]);
    if (!records.length) {
      throw new ValidationError('Input sheet is empty', { sheet: INPUT_SHEET });
    }
    const row = records[0];
    const xMax = Number.parseInt(String(row.x_max ?? ''), 10);
    const yMax = Number.parseInt(String(row.y_max ?? ''), 10);
    const capacity = Number.parseInt(String(row.capacity ?? ''), 10);
    if (Number.isNaN(xMax) || Number.isNaN(yMax) || Number.isNaN(capacity)) {
      throw new ValidationError('Invalid numeric input values', { row });
    }
    return { payload: { x_max: xMax, y_max: yMax, capacity } };
  },

  buildWritePlan(solution: Solution, snapshot: WorkbookSnapshot, config: ResolvedConfig): WritePlan {
    void config;
    const values = [
      ['x', 'y', 'objective', 'status'],
      [
        solution.summary.x,
        solution.summary.y,
        solution.summary.objective_value,
        solution.status,
      ],
    ];
    return {
      operations: [{ sheet: OUTPUT_SHEET, rangeA1: 'A1', values }],
      inputFingerprint: snapshot.inputFingerprint,
      metadata: { adapter_id: 'standalone_demo_ts' },
    };
  },
};

export { modelAdapter } from './model.js';
