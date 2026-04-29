import * as vscode from 'vscode';
import { runCommand } from './process';

export async function flashFirmware(port: string, firmwarePath: string, baud: number, toolPython: string, out: vscode.OutputChannel): Promise<void> {
  out.appendLine(`Using serial port: ${port}`);
  out.appendLine(`Firmware: ${firmwarePath}`);

  await runCommand(toolPython, ['-m', 'esptool', '--chip', 'esp32', '--port', port, 'erase_flash'], out);
  await runCommand(toolPython, ['-m', 'esptool', '--chip', 'esp32', '--port', port, '--baud', String(baud), 'write_flash', '-z', '0x1000', firmwarePath], out);
}

export async function pickFirmwareBin(): Promise<string> {
  const picked = await vscode.window.showOpenDialog({
    title: 'Select MicroPython firmware .bin',
    canSelectMany: false,
    filters: { Firmware: ['bin'], All: ['*'] }
  });
  if (!picked?.length) throw new Error('Firmware selection cancelled.');
  return picked[0].fsPath;
}
