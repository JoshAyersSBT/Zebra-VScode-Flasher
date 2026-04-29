import * as cp from 'child_process';
import * as vscode from 'vscode';

export interface RunOptions {
  cwd?: string;
  ignoreFailure?: boolean;
  env?: NodeJS.ProcessEnv;
}

export function runCommand(
  command: string,
  args: string[],
  out: vscode.OutputChannel,
  options: RunOptions = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    out.appendLine(`>> ${command} ${args.map(quoteArg).join(' ')}`);

    const child = cp.spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: process.platform === 'win32'
    });

    child.stdout.on('data', data => out.append(data.toString()));
    child.stderr.on('data', data => out.append(data.toString()));

    child.on('error', err => {
      if (options.ignoreFailure) {
        out.appendLine(`Ignored process error: ${err.message}`);
        resolve();
      } else {
        reject(err);
      }
    });

    child.on('close', code => {
      if (code !== 0 && !options.ignoreFailure) {
        reject(new Error(`Command failed with exit code ${code}: ${command}`));
      } else {
        resolve();
      }
    });
  });
}

export function captureCommand(command: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(command, args, {
      cwd,
      shell: process.platform === 'win32'
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => stdout += data.toString());
    child.stderr.on('data', data => stderr += data.toString());
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr || `Command failed with exit code ${code}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

function quoteArg(arg: string): string {
  if (/\s/.test(arg)) {
    return JSON.stringify(arg);
  }
  return arg;
}
