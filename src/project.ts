import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface ZebraProjectConfig {
  name: string;
  board: string;
  port: string;
  runtimePath: string;
  uploadProtocol: 'mpremote';
}

export function getWorkspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) throw new Error('Open a ZebraBot project folder first.');
  return folder;
}

export function getProjectConfigPath(root: string): string {
  return path.join(root, 'zebra.json');
}

export function readProjectConfig(root: string): ZebraProjectConfig | undefined {
  const p = getProjectConfigPath(root);
  if (!fs.existsSync(p)) return undefined;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as ZebraProjectConfig;
}

export function writeProjectConfig(root: string, cfg: ZebraProjectConfig) {
  fs.writeFileSync(getProjectConfigPath(root), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

export async function initProject(context: vscode.ExtensionContext): Promise<void> {
  const root = getWorkspaceRoot();
  const name = path.basename(root);
  const cfg: ZebraProjectConfig = {
    name,
    board: 'esp32',
    port: 'AUTO',
    runtimePath: '',
    uploadProtocol: 'mpremote'
  };

  const existing = readProjectConfig(root);
  if (existing) {
    const overwrite = await vscode.window.showWarningMessage('This folder already has zebra.json.', 'Overwrite', 'Cancel');
    if (overwrite !== 'Overwrite') return;
  }

  writeProjectConfig(root, cfg);

  const mainPath = path.join(root, 'main.py');
  if (!fs.existsSync(mainPath)) {
    fs.writeFileSync(mainPath, defaultMainPy(), 'utf8');
  }

  const vscodeDir = path.join(root, '.vscode');
  fs.mkdirSync(vscodeDir, { recursive: true });
  const settingsPath = path.join(vscodeDir, 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, JSON.stringify({
      'zebra.port': 'AUTO'
    }, null, 2) + '\n', 'utf8');
  }

  await vscode.commands.executeCommand('setContext', 'zebra.projectActive', true);
  vscode.window.showInformationMessage('Zebra project initialized.');
}

export async function updateProjectContext() {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const active = !!root && fs.existsSync(getProjectConfigPath(root));
  await vscode.commands.executeCommand('setContext', 'zebra.projectActive', active);
}

export function defaultMainPy(): string {
  return `import uasyncio as asyncio\n\n\nasync def main(zbot):\n    zbot.display("Zebra", "Hello")\n    while True:\n        await asyncio.sleep_ms(100)\n`;
}

export async function showProjectStatus(context: vscode.ExtensionContext, out: vscode.OutputChannel) {
  const root = getWorkspaceRoot();
  const cfg = readProjectConfig(root);
  out.show(true);
  out.appendLine('=== Zebra Project Status ===');
  out.appendLine(`Workspace: ${root}`);
  out.appendLine(`zebra.json: ${cfg ? 'found' : 'missing'}`);
  if (cfg) {
    out.appendLine(`Project: ${cfg.name}`);
    out.appendLine(`Board: ${cfg.board}`);
    out.appendLine(`Port: ${cfg.port}`);
    out.appendLine(`Upload protocol: ${cfg.uploadProtocol}`);
  }
  out.appendLine(`Extension storage: ${context.globalStorageUri.fsPath}`);
}
