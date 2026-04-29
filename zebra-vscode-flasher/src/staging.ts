import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SKIP_DIRS = new Set(['__pycache__', '.git', '.idea', '.vscode', '.mypy_cache', '.pytest_cache', 'node_modules', '.venv', 'venv', 'dist', 'build']);
const ALLOWED = new Set(['.py', '.mpy']);

export function buildStagedProject(projectRoot: string, runtimeRoot: string): string {
  const src = path.resolve(projectRoot);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'zbot_stage_'));

  const runtimeMain = path.join(runtimeRoot, 'main.py');
  const runtimeRobot = path.join(runtimeRoot, 'robot');
  if (!fs.existsSync(runtimeMain)) throw new Error(`Runtime main.py not found: ${runtimeMain}`);
  if (!fs.existsSync(runtimeRobot)) throw new Error(`Runtime robot folder not found: ${runtimeRobot}`);

  const studentEntry = fs.existsSync(path.join(src, 'user_main.py'))
    ? path.join(src, 'user_main.py')
    : path.join(src, 'main.py');
  if (!fs.existsSync(studentEntry)) throw new Error('Project must contain main.py or user_main.py.');

  fs.copyFileSync(runtimeMain, path.join(stage, 'main.py'));
  copyPythonTree(runtimeRobot, path.join(stage, 'robot'));
  fs.copyFileSync(studentEntry, path.join(stage, 'user_main.py'));

  copyStudentExtras(src, stage);
  return stage;
}

export function iterDeployFiles(root: string): { local: string; rel: string }[] {
  const files: { local: string; rel: string }[] = [];
  walk(root, file => {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    if (shouldCopy(file, rel)) files.push({ local: file, rel });
  });
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return files;
}

function copyStudentExtras(src: string, dst: string): void {
  walk(src, file => {
    const rel = path.relative(src, file).replace(/\\/g, '/');
    if (rel === 'main.py' || rel === 'user_main.py') return;
    if (rel.startsWith('robot/')) return;
    if (!shouldCopy(file, rel)) return;
    const dest = path.join(dst, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
  });
}

function copyPythonTree(src: string, dst: string): void {
  walk(src, file => {
    const rel = path.relative(src, file).replace(/\\/g, '/');
    if (!shouldCopy(file, rel)) return;
    const dest = path.join(dst, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
  });
  const initPy = path.join(dst, '__init__.py');
  if (!fs.existsSync(initPy)) {
    fs.writeFileSync(initPy, '# Auto-created for Zebra runtime package imports.\n');
  }
}

function walk(dir: string, onFile: (file: string) => void): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, onFile);
    } else if (entry.isFile()) {
      onFile(full);
    }
  }
}

function shouldCopy(file: string, rel: string): boolean {
  const name = path.basename(file).toLowerCase();
  const ext = path.extname(file).toLowerCase();
  if (!ALLOWED.has(ext)) return false;
  if (name.startsWith('teleop') && ext === '.py' && !rel.includes('/')) return false;
  return true;
}
