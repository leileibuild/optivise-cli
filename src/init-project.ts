import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function scaffoldProject(targetDir: string): Promise<void> {
  const templateRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'templates', 'standalone');
  copyDir(templateRoot, targetDir);
  mkdirSync(join(targetDir, 'data'), { recursive: true });
  await writeSampleExcel(join(targetDir, 'data', 'sample.xlsx'));
}

function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      cpSync(srcPath, destPath);
    }
  }
}

async function writeSampleExcel(path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const input = workbook.addWorksheet('Input');
  input.addRow(['x_max', 'y_max', 'capacity']);
  input.addRow([10, 10, 15]);
  await workbook.xlsx.writeFile(path);
}

export function resolveProjectRoot(cwd: string): string {
  return resolve(cwd);
}

export function assertProjectRoot(projectRoot: string): void {
  if (!existsSync(join(projectRoot, 'smartplanner.config.yaml'))) {
    throw new Error('Not a Smart Planner adapter project (missing smartplanner.config.yaml)');
  }
}
