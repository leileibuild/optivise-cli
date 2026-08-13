import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTemplateSpec } from '@smart-planner/adapter-sdk';

function templatesRoot(): string {
  return join(fileURLToPath(new URL('.', import.meta.url)), '..', 'templates');
}

async function writeStandaloneSampleExcel(path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const input = workbook.addWorksheet('Input');
  input.addRow(['x_max', 'y_max', 'capacity']);
  input.addRow([10, 10, 15]);
  await workbook.xlsx.writeFile(path);
}

function copyIfExists(src: string, dest: string): void {
  if (existsSync(src)) {
    cpSync(src, dest);
  }
}

export async function scaffoldTemplateProject(
  templateId: string,
  targetDir: string,
): Promise<void> {
  const spec = getTemplateSpec(templateId);
  mkdirSync(targetDir, { recursive: true });
  mkdirSync(join(targetDir, 'data'), { recursive: true });

  const projectYaml = [
    `template_id: ${templateId}`,
    `defaultExcel: ${spec.examples.excel}`,
    spec.examples.yaml ? `defaultConfig: ${spec.examples.yaml}` : '',
    '',
  ]
    .filter(Boolean)
    .join('\n');
  writeFileSync(join(targetDir, 'project.yaml'), projectYaml, 'utf8');

  if (templateId === 'standalone_demo') {
    await writeStandaloneSampleExcel(join(targetDir, 'data', 'sample.xlsx'));
  }

  if (templateId === 'manufacturing') {
    const srcYaml = join(templatesRoot(), 'manufacturing', 'supplemental.yaml');
    copyIfExists(srcYaml, join(targetDir, 'supplemental.yaml'));
    writeFileSync(
      join(targetDir, 'README.md'),
      [
        '# Manufacturing template project',
        '',
        '1. Place your Excel at `data/production_planning.xlsx` (主生产计划 + 详细生产计划 sheets)',
        '2. Edit `supplemental.yaml` (epoch, workshops, solver)',
        '3. `smart-planner validate --template manufacturing --excel data/production_planning.xlsx --config supplemental.yaml`',
        '4. `smart-planner login --backend-url <url>` then `smart-planner solve --template manufacturing ...`',
        '',
      ].join('\n'),
      'utf8',
    );
  } else {
    writeFileSync(
      join(targetDir, 'README.md'),
      [
        `# ${spec.display_name}`,
        '',
        ...spec.next_steps.map((s) => `- ${s}`),
        '',
      ].join('\n'),
      'utf8',
    );
  }
}

export function readBundledExample(relativePath: string): string | undefined {
  const full = join(templatesRoot(), relativePath);
  if (!existsSync(full)) {
    return undefined;
  }
  return readFileSync(full, 'utf8');
}
