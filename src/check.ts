import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { runCommand } from './process';

const SKIP_DIRS = new Set(['__pycache__', '.git', '.vscode', '.idea', '.venv', 'venv', 'dist', 'build', 'node_modules']);

export async function syntaxCheckProject(projectRoot: string, toolPython: string, out: vscode.OutputChannel): Promise<void> {
  const files = collectPythonFiles(projectRoot);
  if (!files.length) throw new Error('No Python files found to check.');

  out.show(true);
  out.appendLine(`Checking ${files.length} Python file(s)...`);

  for (const file of files) {
    out.appendLine(`Checking ${path.relative(projectRoot, file).replace(/\\/g, '/')}`);
    await runCommand(toolPython, ['-m', 'py_compile', file], out);
  }

  out.appendLine('Python syntax check complete.');
}

export function collectPythonFiles(root: string): string[] {
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.py')) files.push(full);
    }
  }
  walk(root);
  return files.sort();
}
