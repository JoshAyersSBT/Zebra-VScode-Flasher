import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';

import {
  listSerialCandidates,
  pickSerialPort,
  resolveSerialPort,
  openDriverHelp,
} from './serial';
import { ProjectSetupPanel, ProjectSetupAction, ProjectSetupState } from './projectSetupPanel';

const REQUIRED_PYTHON_PACKAGES = ['pyserial', 'mpremote', 'esptool'];
const DEFAULT_DRIVER_REPO = 'https://github.com/JoshAyersSBT/Zebra_SOL_Flasher.git';

let output: vscode.OutputChannel;
let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  output = vscode.window.createOutputChannel('Zebra Flasher');

  context.subscriptions.push(output);

  registerCommand(context, 'zebra.setupToolchain', setupToolchainCommand);
  registerCommand(context, 'zebra.initializeProject', initializeProjectCommand);
  registerCommand(context, 'zebra.projectStatus', projectStatusCommand);
  registerCommand(context, 'zebra.projectSetup', projectSetupCommand);
  registerCommand(context, 'zebra.detectSerialPort', detectSerialPortCommand);
  registerCommand(context, 'zebra.openDriverHelp', openDriverHelp);
  registerCommand(context, 'zebra.refreshRobotDriverCache', refreshRobotDriverCacheCommand);
  registerCommand(context, 'zebra.installRobotDrivers', installRobotDriversCommand);
  registerCommand(context, 'zebra.deployProject', deployProjectCommand);
  registerCommand(context, 'zebra.flashFirmware', flashFirmwareCommand);
  registerCommand(context, 'zebra.resetDevice', resetDeviceCommand);
  registerCommand(context, 'zebra.openSerialMonitor', openSerialMonitorCommand);

  output.appendLine('Zebra Flasher extension activated.');
}

export function deactivate() {}

function registerCommand(
  context: vscode.ExtensionContext,
  command: string,
  callback: (...args: any[]) => any | Promise<any>,
) {
  context.subscriptions.push(
    vscode.commands.registerCommand(command, async (...args: any[]) => {
      try {
        if (!['zebra.projectSetup', 'zebra.projectStatus'].includes(command)) {
          output.show(true);
        }
        await callback(...args);
      } catch (err: any) {
        const message = err?.message || String(err);
        output.appendLine(`ERROR: ${message}`);
        vscode.window.showErrorMessage(message);
      }
    }),
  );
}

async function setupToolchainCommand(): Promise<string> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Zebra: Setting up MicroPython toolchain',
      cancellable: false,
    },
    async progress => {
      await fs.promises.mkdir(extensionContext.globalStorageUri.fsPath, { recursive: true });

      progress.report({ message: 'Creating Python virtual environment...' });
      const python = getConfiguredPythonCommand();
      const toolPython = getToolPythonPath();
      const venvDir = getVenvDir();

      if (!fs.existsSync(toolPython)) {
        await runCommand(python, ['-m', 'venv', venvDir]);
      }

      progress.report({ message: 'Upgrading pip...' });
      await runCommand(toolPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);

      progress.report({ message: `Installing ${REQUIRED_PYTHON_PACKAGES.join(', ')}...` });
      await runCommand(toolPython, ['-m', 'pip', 'install', '--upgrade', ...REQUIRED_PYTHON_PACKAGES]);

      progress.report({ message: 'Checking serial support...' });
      const ports = await listSerialCandidates(toolPython);
      output.appendLine(`Detected ${ports.length} serial device(s).`);
      for (const p of ports) {
        output.appendLine(`  - ${p.device} | ${p.description || p.manufacturer || 'serial device'} | score=${p.score}`);
      }

      vscode.window.showInformationMessage('Zebra toolchain setup complete.');
      return toolPython;
    },
  );
}

async function initializeProjectCommand(): Promise<void> {
  const root = requireWorkspaceRoot();

  await setupToolchainCommand();

  await fs.promises.mkdir(root, { recursive: true });

  const zebraJson = path.join(root, 'zebra.json');
  if (!fs.existsSync(zebraJson)) {
    const config = {
      name: path.basename(root),
      board: 'esp32',
      framework: 'micropython',
      runtime: 'zebra',
      port: 'AUTO',
      baud: 460800,
      driverRepo: DEFAULT_DRIVER_REPO,
    };
    await fs.promises.writeFile(zebraJson, JSON.stringify(config, null, 2) + os.EOL, 'utf8');
    output.appendLine(`Created ${zebraJson}`);
  }

  const mainPy = path.join(root, 'main.py');
  if (!fs.existsSync(mainPy) && !fs.existsSync(path.join(root, 'user_main.py'))) {
    await fs.promises.writeFile(mainPy, starterMainPy(), 'utf8');
    output.appendLine(`Created ${mainPy}`);
  }

  const vscodeDir = path.join(root, '.vscode');
  await fs.promises.mkdir(vscodeDir, { recursive: true });

  const settingsJson = path.join(vscodeDir, 'settings.json');
  if (!fs.existsSync(settingsJson)) {
    await fs.promises.writeFile(
      settingsJson,
      JSON.stringify(
        {
          'python.analysis.extraPaths': ['./robot'],
          'zebra.port': 'AUTO',
        },
        null,
        2,
      ) + os.EOL,
      'utf8',
    );
    output.appendLine(`Created ${settingsJson}`);
  }

  await ensureRobotDriversInstalled(root);

  vscode.window.showInformationMessage('Zebra project initialized.');
}

async function projectStatusCommand(): Promise<void> {
  await projectSetupCommand();
}

async function projectSetupCommand(): Promise<void> {
  await ProjectSetupPanel.show(
    extensionContext.extensionUri,
    getProjectSetupState,
    runProjectSetupAction,
  );
}

async function getProjectSetupState(): Promise<ProjectSetupState> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
  const toolPython = getToolPythonPath();
  const toolchainInstalled = fs.existsSync(toolPython);

  let serialSummary = 'Toolchain not installed';
  let ports: ProjectSetupState['serial']['ports'] = [];
  let serialChecked = false;

  if (toolchainInstalled) {
    try {
      const candidates = await listSerialCandidates(toolPython);
      serialChecked = true;
      ports = candidates.map(p => ({
        device: p.device,
        description: p.description,
        manufacturer: p.manufacturer,
        score: p.score,
      }));
      serialSummary = candidates.length
        ? `${candidates.length} found, best: ${candidates[0].device}`
        : 'No USB serial devices found';
    } catch (err: any) {
      serialChecked = true;
      serialSummary = `Serial check failed: ${err?.message || err}`;
    }
  }

  return {
    workspaceRoot: root,
    project: root ? inspectProject(root) : null,
    toolchain: {
      installed: toolchainInstalled,
      pythonPath: toolPython,
    },
    serial: {
      checked: serialChecked,
      summary: serialSummary,
      ports,
    },
  };
}

async function runProjectSetupAction(action: ProjectSetupAction): Promise<void> {
  switch (action) {
    case 'refresh':
      return;
    case 'setupToolchain':
      await setupToolchainCommand();
      return;
    case 'initializeProject':
      await initializeProjectCommand();
      return;
    case 'installRobotDrivers':
      await installRobotDriversCommand();
      return;
    case 'refreshRobotDriverCache':
      await refreshRobotDriverCacheCommand();
      return;
    case 'detectSerialPort':
      await detectSerialPortCommand();
      return;
    case 'openDriverHelp':
      await openDriverHelp();
      return;
    case 'deployProject':
      await deployProjectCommand();
      return;
    default:
      throw new Error(`Unknown project setup action: ${action}`);
  }
}

async function detectSerialPortCommand(): Promise<void> {
  const toolPython = await ensureToolPython();
  const port = await pickSerialPort(toolPython);

  await vscode.workspace
    .getConfiguration('zebra')
    .update('port', port, vscode.ConfigurationTarget.Workspace);

  await updateZebraJson({ port });

  vscode.window.showInformationMessage(`Zebra serial port set to ${port}`);
}

async function refreshRobotDriverCacheCommand(): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Zebra: Refreshing robot driver cache',
      cancellable: false,
    },
    async () => {
      await refreshRobotDriverCache();
    },
  );
  vscode.window.showInformationMessage('Robot driver cache refreshed.');
}

async function installRobotDriversCommand(): Promise<void> {
  const root = requireWorkspaceRoot();
  await ensureRobotDriversInstalled(root, true);
  vscode.window.showInformationMessage('Robot drivers installed into project.');
}

async function deployProjectCommand(): Promise<void> {
  const root = await requireUsableProject();
  if (!root) return;

  const toolPython = await ensureToolPython();
  let port = getWorkspaceConfig<string>('port', 'AUTO');
  if (!port || isAutoPort(port)) {
    port = await resolveSerialPort(toolPython);
    await vscode.workspace.getConfiguration('zebra').update('port', port, vscode.ConfigurationTarget.Workspace);
    await updateZebraJson({ port });
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Zebra: Deploying project to ESP32',
      cancellable: false,
    },
    async progress => {
      const stage = await buildStagedProject(root);
      const files = await collectDeployFiles(stage);
      if (!files.length) throw new Error('No deployable .py or .mpy files found.');

      output.appendLine(`Deploy stage: ${stage}`);
      output.appendLine(`Deploying ${files.length} file(s) to ${port}`);

      const madeDirs = new Set<string>();
      for (let i = 0; i < files.length; i++) {
        const localPath = files[i];
        const rel = normalizePath(path.relative(stage, localPath));
        progress.report({ message: `${i + 1}/${files.length}: ${rel}` });
        output.appendLine(`[${i + 1}/${files.length}] ${rel}`);

        await ensureRemoteDirs(toolPython, port, rel, madeDirs);
        await runCommand(toolPython, ['-m', 'mpremote', 'connect', port, 'fs', 'cp', localPath, `:/${rel}`]);
      }

      progress.report({ message: 'Resetting device...' });
      await runCommand(toolPython, ['-m', 'mpremote', 'connect', port, 'reset'], true);
    },
  );

  vscode.window.showInformationMessage('Zebra project deployed.');
}

async function flashFirmwareCommand(): Promise<void> {
  const toolPython = await ensureToolPython();
  let port = getWorkspaceConfig<string>('port', 'AUTO');
  if (!port || isAutoPort(port)) {
    port = await resolveSerialPort(toolPython);
    await vscode.workspace.getConfiguration('zebra').update('port', port, vscode.ConfigurationTarget.Workspace);
    await updateZebraJson({ port });
  }

  const picked = await vscode.window.showOpenDialog({
    title: 'Select MicroPython firmware .bin',
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { Firmware: ['bin'], All: ['*'] },
  });

  const firmware = picked?.[0]?.fsPath;
  if (!firmware) return;

  const baud = String(getWorkspaceConfig<number>('baud', 460800));

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Zebra: Flashing MicroPython firmware',
      cancellable: false,
    },
    async progress => {
      progress.report({ message: 'Erasing flash...' });
      await runCommand(toolPython, ['-m', 'esptool', '--chip', 'esp32', '--port', port, 'erase_flash']);

      progress.report({ message: 'Writing firmware...' });
      await runCommand(toolPython, [
        '-m',
        'esptool',
        '--chip',
        'esp32',
        '--port',
        port,
        '--baud',
        baud,
        'write_flash',
        '-z',
        '0x1000',
        firmware,
      ]);
    },
  );

  vscode.window.showInformationMessage('Firmware flash complete.');
}

async function resetDeviceCommand(): Promise<void> {
  const toolPython = await ensureToolPython();
  const port = await resolveSerialPort(toolPython);
  await runCommand(toolPython, ['-m', 'mpremote', 'connect', port, 'reset'], true);
  vscode.window.showInformationMessage(`Reset sent to ${port}.`);
}

async function openSerialMonitorCommand(): Promise<void> {
  const toolPython = await ensureToolPython();
  const port = await resolveSerialPort(toolPython);
  const baud = String(getWorkspaceConfig<number>('monitorBaud', 115200));

  const terminal = vscode.window.createTerminal({ name: `Zebra Monitor ${port}` });
  terminal.show();
  terminal.sendText(`${quoteShell(toolPython)} -m mpremote connect ${quoteShell(port)} repl`);

  output.appendLine(`Opened serial monitor on ${port} @ ${baud}.`);
}

async function requireUsableProject(): Promise<string | undefined> {
  const root = requireWorkspaceRoot();
  const status = inspectProject(root);

  if (status.valid) return root;

  const choice = await vscode.window.showWarningMessage(
    `This workspace is missing Zebra project files:\n${status.problems.join('\n')}`,
    'Initialize Project',
    'Continue Anyway',
    'Cancel',
  );

  if (choice === 'Initialize Project') {
    await initializeProjectCommand();
    return root;
  }
  if (choice === 'Continue Anyway') return root;
  return undefined;
}

function inspectProject(root: string) {
  const hasMain = fs.existsSync(path.join(root, 'main.py'));
  const hasUserMain = fs.existsSync(path.join(root, 'user_main.py'));
  const hasRobotDir = fs.existsSync(path.join(root, 'robot'));
  const hasZebraJson = fs.existsSync(path.join(root, 'zebra.json'));
  const problems: string[] = [];

  if (!hasMain && !hasUserMain) problems.push('Missing main.py or user_main.py');
  if (!hasRobotDir) problems.push('Missing robot/ driver directory');
  if (!hasZebraJson) problems.push('Missing zebra.json project config');

  return {
    root,
    valid: problems.length === 0,
    hasMain,
    hasUserMain,
    hasRobotDir,
    hasZebraJson,
    problems,
  };
}

async function ensureToolPython(): Promise<string> {
  const toolPython = getToolPythonPath();
  if (fs.existsSync(toolPython)) return toolPython;

  const choice = await vscode.window.showWarningMessage(
    'Zebra toolchain is not installed yet.',
    'Setup Toolchain',
    'Cancel',
  );

  if (choice !== 'Setup Toolchain') {
    throw new Error('Toolchain setup is required.');
  }

  return setupToolchainCommand();
}

function getVenvDir(): string {
  return path.join(extensionContext.globalStorageUri.fsPath, '.zebra-venv');
}

function getToolPythonPath(): string {
  const venv = getVenvDir();
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
}

function getConfiguredPythonCommand(): string {
  const configured = getWorkspaceConfig<string>('pythonPath', '');
  if (configured && configured.trim()) return configured.trim();
  return process.platform === 'win32' ? 'python' : 'python3';
}

async function refreshRobotDriverCache(): Promise<string> {
  const cacheRoot = getDriverCacheRoot();
  const repoDir = path.join(cacheRoot, 'Zebra_SOL_Flasher');
  const repoUrl = getWorkspaceConfig<string>('driverRepo', DEFAULT_DRIVER_REPO) || DEFAULT_DRIVER_REPO;

  await fs.promises.mkdir(cacheRoot, { recursive: true });

  if (fs.existsSync(repoDir)) {
    await runCommand('git', ['-C', repoDir, 'pull', '--ff-only'], true);
  } else {
    await runCommand('git', ['clone', repoUrl, repoDir]);
  }

  const robotDir = path.join(repoDir, 'robot');
  if (!fs.existsSync(robotDir)) {
    throw new Error(`Driver repo does not contain robot/: ${robotDir}`);
  }

  return repoDir;
}

async function ensureRobotDriversInstalled(root: string, force = false): Promise<void> {
  const projectRobot = path.join(root, 'robot');

  if (fs.existsSync(projectRobot) && !force) {
    output.appendLine('robot/ already exists; leaving existing project drivers in place.');
    return;
  }

  const cachedRobot = await findCachedRobotDir();
  if (cachedRobot) {
    await copyDir(cachedRobot, projectRobot, force);
    output.appendLine(`Installed robot drivers from cache: ${cachedRobot}`);
    return;
  }

  const repoDir = await refreshRobotDriverCache();
  const repoRobot = path.join(repoDir, 'robot');
  await copyDir(repoRobot, projectRobot, force);
  output.appendLine(`Installed robot drivers from repo: ${repoRobot}`);
}

async function findCachedRobotDir(): Promise<string | undefined> {
  const candidates = [
    path.join(getDriverCacheRoot(), 'robot'),
    path.join(getDriverCacheRoot(), 'Zebra_SOL_Flasher', 'robot'),
    path.join(extensionContext.extensionPath, 'resources', 'runtime', 'robot'),
    path.join(extensionContext.extensionPath, 'resources', 'robot'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  return undefined;
}

function getDriverCacheRoot(): string {
  return path.join(extensionContext.globalStorageUri.fsPath, 'driver-cache');
}

async function buildStagedProject(root: string): Promise<string> {
  const stage = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zbot_stage_'));

  const sourceMain = fs.existsSync(path.join(root, 'user_main.py'))
    ? path.join(root, 'user_main.py')
    : path.join(root, 'main.py');

  if (!fs.existsSync(sourceMain)) {
    throw new Error('Project must contain main.py or user_main.py.');
  }

  const robotDir = path.join(root, 'robot');
  if (!fs.existsSync(robotDir)) {
    throw new Error('Project must contain robot/ before deploy. Run Zebra: Initialize Project.');
  }

  const runtimeMain = await findRuntimeMain(root);
  if (runtimeMain) {
    await fs.promises.copyFile(runtimeMain, path.join(stage, 'main.py'));
    await fs.promises.copyFile(sourceMain, path.join(stage, 'user_main.py'));
  } else if (path.basename(sourceMain) === 'user_main.py' && fs.existsSync(path.join(root, 'main.py'))) {
    await fs.promises.copyFile(path.join(root, 'main.py'), path.join(stage, 'main.py'));
    await fs.promises.copyFile(sourceMain, path.join(stage, 'user_main.py'));
  } else {
    await fs.promises.copyFile(sourceMain, path.join(stage, 'main.py'));
  }

  await copyDir(robotDir, path.join(stage, 'robot'), true);

  for (const entry of await fs.promises.readdir(root, { withFileTypes: true })) {
    if (shouldSkipTopLevel(entry.name)) continue;
    const from = path.join(root, entry.name);
    const to = path.join(stage, entry.name);
    if (entry.isDirectory()) {
      await copyProjectTree(from, to);
    } else if (isDeployFile(from) && !['main.py', 'user_main.py'].includes(entry.name)) {
      await fs.promises.copyFile(from, to);
    }
  }

  return stage;
}

async function findRuntimeMain(root: string): Promise<string | undefined> {
  const candidates = [
    path.join(extensionContext.extensionPath, 'resources', 'runtime', 'main.py'),
    path.join(extensionContext.extensionPath, 'resources', 'main.py'),
    path.join(root, '.zebra', 'runtime', 'main.py'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return undefined;
}

async function collectDeployFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string) {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (isDeployFile(full)) files.push(full);
    }
  }

  await walk(root);
  return files.sort((a, b) => normalizePath(path.relative(root, a)).localeCompare(normalizePath(path.relative(root, b))));
}

async function ensureRemoteDirs(toolPython: string, port: string, relFile: string, madeDirs: Set<string>): Promise<void> {
  const parent = path.posix.dirname(relFile);
  if (!parent || parent === '.') return;

  const parts = parent.split('/');
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    if (madeDirs.has(current)) continue;
    await runCommand(toolPython, ['-m', 'mpremote', 'connect', port, 'fs', 'mkdir', `:${current}`], true);
    madeDirs.add(current);
  }
}

const SKIP_DIRS = new Set([
  '__pycache__',
  '.git',
  '.idea',
  '.vscode',
  '.mypy_cache',
  '.pytest_cache',
  'node_modules',
  '.venv',
  'venv',
  'dist',
  'build',
]);

function shouldSkipTopLevel(name: string): boolean {
  return ['robot', 'main.py', 'user_main.py', 'zebra.json'].includes(name) || SKIP_DIRS.has(name) || name.startsWith('.');
}

async function copyProjectTree(src: string, dst: string): Promise<void> {
  for (const entry of await fs.promises.readdir(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyProjectTree(from, to);
    } else if (isDeployFile(from)) {
      await fs.promises.mkdir(path.dirname(to), { recursive: true });
      await fs.promises.copyFile(from, to);
    }
  }
}

async function copyDir(src: string, dst: string, overwrite: boolean): Promise<void> {
  if (overwrite && fs.existsSync(dst)) {
    await fs.promises.rm(dst, { recursive: true, force: true });
  }
  await fs.promises.mkdir(dst, { recursive: true });

  for (const entry of await fs.promises.readdir(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to, overwrite);
    } else if (isDeployFile(from) || entry.name === '__init__.py') {
      await fs.promises.mkdir(path.dirname(to), { recursive: true });
      await fs.promises.copyFile(from, to);
    }
  }
}

function isDeployFile(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file).toLowerCase();
  if (!['.py', '.mpy'].includes(ext)) return false;
  if (base.startsWith('teleop') && ext === '.py') return false;
  return true;
}

async function updateZebraJson(patch: Record<string, any>): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return;

  const file = path.join(root, 'zebra.json');
  let data: Record<string, any> = {};
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    } catch {
      data = {};
    }
  }

  data = { ...data, ...patch };
  await fs.promises.writeFile(file, JSON.stringify(data, null, 2) + os.EOL, 'utf8');
}

function requireWorkspaceRoot(): string {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) throw new Error('Open a Zebra project folder first.');
  return root;
}

function getWorkspaceConfig<T>(key: string, fallback: T): T {
  const config = vscode.workspace.getConfiguration('zebra');
  return config.get<T>(key, fallback);
}

function isAutoPort(port: string): boolean {
  return ['AUTO', 'AUTO-DETECT', 'AUTODETECT'].includes(port.trim().toUpperCase());
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function quoteShell(value: string): string {
  if (process.platform === 'win32') return `"${value.replace(/"/g, '\\"')}"`;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function runCommand(command: string, args: string[], ignoreFailure = false): Promise<string> {
  return new Promise((resolve, reject) => {
    output.appendLine(`>> ${command} ${args.join(' ')}`);

    const child = cp.spawn(command, args, {
      shell: false,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => {
      const text = data.toString();
      stdout += text;
      output.append(text);
    });

    child.stderr.on('data', data => {
      const text = data.toString();
      stderr += text;
      output.append(text);
    });

    child.on('error', err => {
      if (ignoreFailure) resolve(stdout.trim());
      else reject(err);
    });

    child.on('close', code => {
      if (code !== 0 && !ignoreFailure) {
        reject(new Error(`Command failed with code ${code}: ${command} ${args.join(' ')}\n${stderr}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function starterMainPy(): string {
  return `import uasyncio as asyncio\nimport gc\n\n\nasync def main(zbot):\n    gc.collect()\n\n    zbot.display("ZebraBot", "Ready")\n\n    while True:\n        await asyncio.sleep_ms(100)\n`;
}
