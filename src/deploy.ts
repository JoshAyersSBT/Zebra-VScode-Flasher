import * as path from 'path';
import * as vscode from 'vscode';
import { runCommand } from './process';
import { iterDeployFiles } from './staging';

export async function deployWithMpremote(stageRoot: string, port: string, toolPython: string, out: vscode.OutputChannel): Promise<void> {
  const files = iterDeployFiles(stageRoot);
  if (!files.length) throw new Error(`No deployable files found in ${stageRoot}`);

  const madeDirs = new Set<string>();
  out.appendLine(`Found ${files.length} file(s) to upload.`);

  for (let i = 0; i < files.length; i++) {
    const { local, rel } = files[i];
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Zebra upload ${i + 1}/${files.length}: ${rel}` }, async () => {});

    const parent = path.posix.dirname(rel);
    if (parent && parent !== '.') {
      const parts = parent.split('/');
      const acc: string[] = [];
      for (const part of parts) {
        acc.push(part);
        const remoteDir = `:/${acc.join('/')}`;
        if (!madeDirs.has(remoteDir)) {
          await runCommand(toolPython, ['-m', 'mpremote', 'connect', port, 'fs', 'mkdir', remoteDir], out, { ignoreFailure: true });
          madeDirs.add(remoteDir);
        }
      }
    }

    out.appendLine(`[${i + 1}/${files.length}] Uploading ${rel}`);
    await runCommand(toolPython, ['-m', 'mpremote', 'connect', port, 'fs', 'cp', local, `:/${rel}`], out);
  }

  await runCommand(toolPython, ['-m', 'mpremote', 'connect', port, 'reset'], out, { ignoreFailure: true });
}
