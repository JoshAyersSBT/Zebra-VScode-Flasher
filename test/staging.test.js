const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildStagedProject, iterDeployFiles } = require('../out/staging');

function makeTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zebra-staging-test-'));
}

function writeFile(file, contents = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, 'utf8');
}

function readFile(file) {
  return fs.readFileSync(file, 'utf8');
}

function rels(root) {
  return iterDeployFiles(root).map(file => file.rel);
}

function collectPyFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectPyFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.py')) {
      files.push(full);
    }
  }
  return files;
}

function collectRobotImports(source) {
  const modules = new Set();
  const patterns = [
    /^\s*from\s+robot\.([A-Za-z_][\w.]*)\s+import\s+/gm,
    /^\s*import\s+robot\.([A-Za-z_][\w.]*)/gm,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      modules.add(match[1].split('.')[0]);
    }
  }

  return [...modules].sort();
}

test('bundled runtime includes robot modules imported by runtime files', () => {
  const runtimeRoot = path.resolve(__dirname, '..', 'resources', 'runtime');
  const robotRoot = path.join(runtimeRoot, 'robot');
  const missing = [];

  for (const file of collectPyFiles(runtimeRoot)) {
    const source = readFile(file);
    for (const moduleName of collectRobotImports(source)) {
      const modulePath = path.join(robotRoot, `${moduleName}.py`);
      if (!fs.existsSync(modulePath)) {
        missing.push(`${path.relative(runtimeRoot, file)} imports robot.${moduleName}`);
      }
    }
  }

  assert.deepEqual(missing, []);
});

test('buildStagedProject stages runtime and project entrypoint', () => {
  const root = makeTempProject();
  const projectRoot = path.join(root, 'project');
  const runtimeRoot = path.join(root, 'runtime');

  writeFile(path.join(runtimeRoot, 'main.py'), 'runtime main');
  writeFile(path.join(runtimeRoot, 'robot', 'motors.py'), 'runtime motors');
  writeFile(path.join(runtimeRoot, 'robot', 'native_motor.mpy'), 'native motor binary');
  writeFile(path.join(projectRoot, 'main.py'), 'student main');
  writeFile(path.join(projectRoot, 'lib', 'helpers.py'), 'helper');

  const stage = buildStagedProject(projectRoot, runtimeRoot);

  assert.equal(readFile(path.join(stage, 'main.py')), 'runtime main');
  assert.equal(readFile(path.join(stage, 'user_main.py')), 'student main');
  assert.equal(readFile(path.join(stage, 'robot', 'motors.py')), 'runtime motors');
  assert.equal(readFile(path.join(stage, 'robot', 'native_motor.mpy')), 'native motor binary');
  assert.equal(readFile(path.join(stage, 'lib', 'helpers.py')), 'helper');
  assert.deepEqual(rels(stage), [
    'lib/helpers.py',
    'main.py',
    'robot/__init__.py',
    'robot/motors.py',
    'robot/native_motor.mpy',
    'user_main.py',
  ]);
});

test('buildStagedProject prefers user_main.py over project main.py', () => {
  const root = makeTempProject();
  const projectRoot = path.join(root, 'project');
  const runtimeRoot = path.join(root, 'runtime');

  writeFile(path.join(runtimeRoot, 'main.py'), 'runtime main');
  writeFile(path.join(runtimeRoot, 'robot', '__init__.py'), '');
  writeFile(path.join(projectRoot, 'main.py'), 'ignored main');
  writeFile(path.join(projectRoot, 'user_main.py'), 'preferred user main');

  const stage = buildStagedProject(projectRoot, runtimeRoot);

  assert.equal(readFile(path.join(stage, 'user_main.py')), 'preferred user main');
});

test('buildStagedProject skips local robot drivers, caches, and teleop root files', () => {
  const root = makeTempProject();
  const projectRoot = path.join(root, 'project');
  const runtimeRoot = path.join(root, 'runtime');

  writeFile(path.join(runtimeRoot, 'main.py'), 'runtime main');
  writeFile(path.join(runtimeRoot, 'robot', 'drive.py'), 'runtime drive');
  writeFile(path.join(projectRoot, 'main.py'), 'student main');
  writeFile(path.join(projectRoot, 'robot', 'old_driver.py'), 'do not copy');
  writeFile(path.join(projectRoot, 'teleop.py'), 'do not copy');
  writeFile(path.join(projectRoot, 'teleop_custom.py'), 'do not copy');
  writeFile(path.join(projectRoot, '.venv', 'ignored.py'), 'do not copy');
  writeFile(path.join(projectRoot, 'src', 'module.mpy'), 'bytecode');

  const stage = buildStagedProject(projectRoot, runtimeRoot);

  assert.deepEqual(rels(stage), [
    'main.py',
    'robot/__init__.py',
    'robot/drive.py',
    'src/module.mpy',
    'user_main.py',
  ]);
  assert.equal(fs.existsSync(path.join(stage, 'robot', 'old_driver.py')), false);
});

test('buildStagedProject does not stage driver documentation', () => {
  const root = makeTempProject();
  const projectRoot = path.join(root, 'project');
  const runtimeRoot = path.join(root, 'runtime');

  writeFile(path.join(runtimeRoot, 'main.py'), 'runtime main');
  writeFile(path.join(runtimeRoot, 'robot', 'drive.py'), 'runtime drive');
  writeFile(path.join(runtimeRoot, 'docs', 'student-api.md'), '# docs stay local');
  writeFile(path.join(projectRoot, 'main.py'), 'student main');
  writeFile(path.join(projectRoot, 'docs', 'notes.md'), '# project docs stay local');

  const stage = buildStagedProject(projectRoot, runtimeRoot);

  assert.deepEqual(rels(stage), [
    'main.py',
    'robot/__init__.py',
    'robot/drive.py',
    'user_main.py',
  ]);
  assert.equal(fs.existsSync(path.join(stage, 'docs', 'student-api.md')), false);
  assert.equal(fs.existsSync(path.join(stage, 'docs', 'notes.md')), false);
});

test('buildStagedProject reports missing runtime and entrypoint clearly', () => {
  const root = makeTempProject();
  const projectRoot = path.join(root, 'project');
  const runtimeRoot = path.join(root, 'runtime');

  assert.throws(
    () => buildStagedProject(projectRoot, runtimeRoot),
    /Runtime main\.py not found/,
  );

  writeFile(path.join(runtimeRoot, 'main.py'), 'runtime main');
  writeFile(path.join(runtimeRoot, 'robot', '__init__.py'), '');

  assert.throws(
    () => buildStagedProject(projectRoot, runtimeRoot),
    /Project must contain main\.py or user_main\.py/,
  );
});
