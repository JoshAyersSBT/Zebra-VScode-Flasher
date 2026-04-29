import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { runCommand } from './process';

export function getVenvDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, 'zebra-python-tools');
}

export function getToolPython(context: vscode.ExtensionContext): string {
  const venvDir = getVenvDir(context);
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
}

export function toolPythonExists(context: vscode.ExtensionContext): boolean {
  return fs.existsSync(getToolPython(context));
}

export async function setupToolchain(context: vscode.ExtensionContext, out: vscode.OutputChannel): Promise<void> {
  const config = vscode.workspace.getConfiguration('zebra');
  const basePython = config.get<string>('pythonPath') || (process.platform === 'win32' ? 'python' : 'python3');
  const venvDir = getVenvDir(context);
  const toolPython = getToolPython(context);

  fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });

  out.show(true);
  out.appendLine('Setting up Zebra MicroPython toolchain...');
  out.appendLine(`Virtual environment: ${venvDir}`);

  if (!fs.existsSync(toolPython)) {
    await runCommand(basePython, ['-m', 'venv', venvDir], out);
  }

  await runCommand(toolPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], out);
  await runCommand(toolPython, ['-m', 'pip', 'install', '--upgrade', 'pyserial', 'mpremote', 'esptool'], out);

  out.appendLine('Toolchain setup complete. Installed: pyserial, mpremote, esptool');
}

export async function ensureToolchain(context: vscode.ExtensionContext, out: vscode.OutputChannel): Promise<string> {
  if (!toolPythonExists(context)) {
    const choice = await vscode.window.showWarningMessage(
      'Zebra Python toolchain is not installed yet.',
      'Setup Toolchain',
      'Cancel'
    );
    if (choice !== 'Setup Toolchain') {
      throw new Error('Zebra toolchain setup was cancelled.');
    }
    await setupToolchain(context, out);
  }
  return getToolPython(context);
}
