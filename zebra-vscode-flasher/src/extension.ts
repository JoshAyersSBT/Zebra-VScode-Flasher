import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { deployWithMpremote } from './deploy';
import { flashFirmware, pickFirmwareBin } from './flash';
import { openSerialMonitor } from './monitor';
import { pickSerialPort, resolveSerialPort, openDriverHelp } from './serial';
import { buildStagedProject } from './staging';
import { ensureToolchain, getToolPython, setupToolchain } from './toolchain';

export function activate(context: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel('Zebra MicroPython Flasher');

  context.subscriptions.push(
    vscode.commands.registerCommand('zebra.setupToolchain', async () => {
      try {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Setting up Zebra toolchain' }, async () => {
          await setupToolchain(context, out);
        });
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
        vscode.window.showInformationMessage(`Zebra serial port set to ${port}`);
      } catch (err) {
        vscode.window.showErrorMessage(errorMessage(err));
      }
    }),

    vscode.commands.registerCommand('zebra.deployProject', async () => {
      try {
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!folder) throw new Error('Open a ZebraBot project folder first.');

        const config = vscode.workspace.getConfiguration('zebra');
        const toolPython = await ensureToolchain(context, out);
        const port = await resolveSerialPort(toolPython);
        const runtimeRoot = getRuntimeRoot(context, config);

        out.show(true);
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Deploying ZebraBot project to ${port}` }, async () => {
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
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Flashing MicroPython firmware on ${port}` }, async () => {
          await flashFirmware(port, firmwarePath, baud, toolPython, out);
        });

        vscode.window.showInformationMessage('Firmware flash complete.');
      } catch (err) {
        vscode.window.showErrorMessage(errorMessage(err));
      }
    }),

    vscode.commands.registerCommand('zebra.openDriverHelp', async () => {
      await openDriverHelp();
    }),

    vscode.commands.registerCommand('zebra.openSerialMonitor', async () => {
      try {
        const toolPython = getToolPython(context);
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
  const root = configured || path.join(context.extensionPath, 'resources', 'runtime');
  if (!fs.existsSync(path.join(root, 'main.py'))) {
    throw new Error(`Runtime main.py not found. Set zebra.runtimePath or add resources/runtime/main.py. Checked: ${root}`);
  }
  if (!fs.existsSync(path.join(root, 'robot'))) {
    throw new Error(`Runtime robot/ folder not found. Set zebra.runtimePath or add resources/runtime/robot. Checked: ${root}`);
  }
  return root;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
