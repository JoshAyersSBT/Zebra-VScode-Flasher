import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { syntaxCheckProject } from './check';
import { deployWithMpremote } from './deploy';
import { ZebraExplorerProvider } from './explorer';
import { flashFirmware, pickFirmwareBin } from './flash';
import { openSerialMonitor } from './monitor';
import { runCommand } from './process';
import { getWorkspaceRoot, initProject, readProjectConfig, showProjectStatus, updateProjectContext } from './project';
import { pickSerialPort, resolveSerialPort, openDriverHelp } from './serial';
import { buildStagedProject } from './staging';
import { ensureToolchain, getToolPython, setupToolchain } from './toolchain';

export function activate(context: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel('Zebra MicroPython');
  const explorer = new ZebraExplorerProvider();
  context.subscriptions.push(vscode.window.registerTreeDataProvider('zebraExplorer', explorer));

  updateProjectContext();
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => updateProjectContext()));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc => {
    if (doc.fileName.endsWith('zebra.json')) updateProjectContext();
  }));

  context.subscriptions.push(
    vscode.commands.registerCommand('zebra.refreshExplorer', () => explorer.refresh()),

    vscode.commands.registerCommand('zebra.initProject', async () => {
      try {
        await initProject(context);
        explorer.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(errorMessage(err));
      }
    }),

    vscode.commands.registerCommand('zebra.projectStatus', async () => {
      try {
        await showProjectStatus(context, out);
      } catch (err) {
        vscode.window.showErrorMessage(errorMessage(err));
      }
    }),

    vscode.commands.registerCommand('zebra.checkProject', async () => {
      try {
        const root = getWorkspaceRoot();
        const toolPython = await ensureToolchain(context, out);
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Zebra: checking Python files' }, async () => {
          await syntaxCheckProject(root, toolPython, out);
        });
        vscode.window.showInformationMessage('Zebra syntax check complete.');
      } catch (err) {
        vscode.window.showErrorMessage(errorMessage(err));
      }
    }),

    vscode.commands.registerCommand('zebra.setupToolchain', async () => {
      try {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Setting up Zebra toolchain' }, async () => {
          await setupToolchain(context, out);
        });
        explorer.refresh();
        vscode.window.showInformationMessage('Zebra toolchain setup complete.');
      } catch (err) {
        vscode.window.showErrorMessage(errorMessage(err));
      }
    }),

    vscode.commands.registerCommand('zebra.detectSerialPort', async () => {
      try {
        const toolPython = await ensureToolchain(context, out);
        const port = await pickSerialPort(toolPython);
        await vscode.workspace.getConfiguration('zebra').update('port', port, vscode.ConfigurationTarget.Workspace);
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (root) updateZebraJsonPort(root, port);
        vscode.window.showInformationMessage(`Zebra serial port set to ${port}`);
      } catch (err) {
        vscode.window.showErrorMessage(errorMessage(err));
      }
    }),

    vscode.commands.registerCommand('zebra.deployProject', async () => {
      try {
        const folder = getWorkspaceRoot();
        const config = vscode.workspace.getConfiguration('zebra');
        const toolPython = await ensureToolchain(context, out);
        const port = await resolveSerialPort(toolPython);
        const runtimeRoot = getRuntimeRoot(context, config);

        out.show(true);
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Zebra: deploying to ${port}` }, async () => {
          const stage = buildStagedProject(folder, runtimeRoot);
          out.appendLine(`Staged deploy tree: ${stage}`);
          await deployWithMpremote(stage, port, toolPython, out);
        });

        vscode.window.showInformationMessage(`ZebraBot deploy complete on ${port}.`);
      } catch (err) {
        vscode.window.showErrorMessage(errorMessage(err));
      }
    }),

    vscode.commands.registerCommand('zebra.flashFirmware', async () => {
      try {
        const config = vscode.workspace.getConfiguration('zebra');
        const toolPython = await ensureToolchain(context, out);
        const port = await resolveSerialPort(toolPython);
        const baud = config.get<number>('flashBaud') || 460800;
        const firmwarePath = await pickFirmwareBin();

        out.show(true);
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Zebra: flashing firmware on ${port}` }, async () => {
          await flashFirmware(port, firmwarePath, baud, toolPython, out);
        });

        vscode.window.showInformationMessage('Firmware flash complete.');
      } catch (err) {
        vscode.window.showErrorMessage(errorMessage(err));
      }
    }),

    vscode.commands.registerCommand('zebra.resetDevice', async () => {
      try {
        const toolPython = await ensureToolchain(context, out);
        const port = await resolveSerialPort(toolPython);
        out.show(true);
        await runCommand(toolPython, ['-m', 'mpremote', 'connect', port, 'reset'], out, { ignoreFailure: true });
        vscode.window.showInformationMessage(`Reset requested on ${port}.`);
      } catch (err) {
        vscode.window.showErrorMessage(errorMessage(err));
      }
    }),

    vscode.commands.registerCommand('zebra.openDriverHelp', async () => {
      await openDriverHelp();
    }),

    vscode.commands.registerCommand('zebra.openSerialMonitor', async () => {
      try {
        const toolPython = await ensureToolchain(context, out);
        const port = await resolveSerialPort(toolPython);
        const baud = vscode.workspace.getConfiguration('zebra').get<number>('serialMonitorBaud') || 115200;
        openSerialMonitor(port, baud);
      } catch (err) {
        vscode.window.showErrorMessage(errorMessage(err));
      }
    })
  );
}

export function deactivate() {}

function getRuntimeRoot(context: vscode.ExtensionContext, config: vscode.WorkspaceConfiguration): string {
  const configured = (config.get<string>('runtimePath') || '').trim();
  const projectRuntime = getWorkspaceRuntimePath();
  const root = configured || projectRuntime || path.join(context.extensionPath, 'resources', 'runtime');
  if (!fs.existsSync(path.join(root, 'main.py'))) {
    throw new Error(`Runtime main.py not found. Set zebra.runtimePath or add resources/runtime/main.py. Checked: ${root}`);
  }
  if (!fs.existsSync(path.join(root, 'robot'))) {
    throw new Error(`Runtime robot/ folder not found. Set zebra.runtimePath or add resources/runtime/robot. Checked: ${root}`);
  }
  return root;
}

function getWorkspaceRuntimePath(): string {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return '';
  const cfg = readProjectConfig(root);
  if (!cfg?.runtimePath) return '';
  return path.isAbsolute(cfg.runtimePath) ? cfg.runtimePath : path.join(root, cfg.runtimePath);
}

function updateZebraJsonPort(root: string, port: string) {
  const cfg = readProjectConfig(root);
  if (!cfg) return;
  cfg.port = port;
  fs.writeFileSync(path.join(root, 'zebra.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
