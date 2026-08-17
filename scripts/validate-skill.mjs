import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skill = readFileSync(new URL('../skills/smart-planner-cli/SKILL.md', import.meta.url), 'utf8');
assert.match(skill, /^---\nname: smart-planner-cli\n/);
assert.match(skill, /--dry-run/);
assert.match(skill, /explicit user approval/);
assert.match(skill, /references\/commands\.md/);
const agent = readFileSync(new URL('../skills/smart-planner-cli/agents/openai.yaml', import.meta.url), 'utf8');
assert.match(agent, /display_name: "Optivise CLI"/);
assert.match(agent, /\$smart-planner-cli/);
console.log('Skill metadata and approval workflow passed');
