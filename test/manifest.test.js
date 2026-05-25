const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
}

function registeredCommands() {
  const source = fs.readFileSync(path.join(repoRoot, 'src', 'extension.ts'), 'utf8');
  const commands = new Set();
  const pattern = /registerCommand\(\s*context,\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    commands.add(match[1]);
  }
  return [...commands].sort();
}

test('root package.json contributes every registered extension command', () => {
  const pkg = readJson('package.json');
  const contributed = new Set((pkg.contributes.commands || []).map(command => command.command));

  assert.deepEqual(
    registeredCommands().filter(command => !contributed.has(command)),
    [],
  );
});

test('root package.json activates every registered extension command', () => {
  const pkg = readJson('package.json');
  const activationEvents = new Set(pkg.activationEvents || []);

  assert.deepEqual(
    registeredCommands().filter(command => !activationEvents.has(`onCommand:${command}`)),
    [],
  );
});
