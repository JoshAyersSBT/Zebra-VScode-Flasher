import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';

import {
  SerialCandidate,
  listSerialCandidates,
  pickSerialPort,
  resolveSerialPort,
  openDriverHelp,
} from './serial';

const REQUIRED_PYTHON_PACKAGES = ['pyserial', 'mpremote', 'esptool'];
const DEFAULT_DRIVER_REPO = 'https://github.com/JoshAyersSBT/Zebra_SOL_Flasher.git';
const SKIP_DIRS = new Set(['__pycache__', '.git', '.vscode', '.idea', '.mypy_cache', '.pytest_cache', 'node_modules', '.venv', 'venv', 'dist', 'build']);
const DEPLOY_SUFFIXES = new Set(['.py', '.mpy']);

let output: vscode.OutputChannel;
let extensionContext: vscode.ExtensionContext;
let explorerProvider: ZebraExplorerProvider | undefined;
let setupPanel: vscode.WebviewPanel | undefined;

interface ProjectStatus {
  root: string;
  valid: boolean;
  hasMain: boolean;
  hasUserMain: boolean;
  hasRobotDir: boolean;
  hasZebraJson: boolean;
  hasRuntimeMain: boolean;
  hasRuntimeRobot: boolean;
  problems: string[];
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  output = vscode.window.createOutputChannel('Zebra Flasher');

  explorerProvider = new ZebraExplorerProvider();

  context.subscriptions.push(output);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('zebraExplorer', explorerProvider));

  registerCommand(context, 'zebra.refreshExplorer', refreshExplorerCommand, false);
  registerCommand(context, 'zebra.projectSetup', projectSetupCommand, false);
  registerCommand(context, 'zebra.projectStatus', projectSetupCommand, false);

  registerCommand(context, 'zebra.initProject', initializeProjectCommand, true);
  registerCommand(context, 'zebra.initializeProject', initializeProjectCommand, true);

  registerCommand(context, 'zebra.checkProject', checkProjectCommand, true);
  registerCommand(context, 'zebra.setupToolchain', setupToolchainCommand, true);

  registerCommand(context, 'zebra.refreshDriverCache', refreshRobotDriverCacheCommand, true);
  registerCommand(context, 'zebra.refreshRobotDriverCache', refreshRobotDriverCacheCommand, true);
  registerCommand(context, 'zebra.installRobotDrivers', installRobotDriversCommand, true);

  registerCommand(context, 'zebra.detectSerialPort', detectSerialPortCommand, true);
  registerCommand(context, 'zebra.deployProject', deployProjectCommand, true);
  registerCommand(context, 'zebra.flashFirmware', flashFirmwareCommand, true);
  registerCommand(context, 'zebra.resetDevice', resetDeviceCommand, true);
  registerCommand(context, 'zebra.openSerialMonitor', openSerialMonitorCommand, true);
  registerCommand(context, 'zebra.openDriverHelp', openDriverHelp, false);

  void updateProjectContext();
  vscode.workspace.onDidChangeWorkspaceFolders(() => void updateProjectContext(), null, context.subscriptions);

  output.appendLine('Zebra Flasher extension activated.');
}

export function deactivate(): void {}

function registerCommand(
  context: vscode.ExtensionContext,
  command: string,
  callback: (...args: unknown[]) => unknown | Promise<unknown>,
  showOutput: boolean,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(command, async (...args: unknown[]) => {
      try {
        if (showOutput) {
          output.show(true);
        }
        await callback(...args);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        output.appendLine(`ERROR: ${message}`);
        void vscode.window.showErrorMessage(message);
      } finally {
        refreshExplorerCommand();
      }
    }),
  );
}

async function refreshExplorerCommand(): Promise<void> {
  await updateProjectContext();
  explorerProvider?.refresh();
  if (setupPanel) {
    await renderProjectSetupPanel(setupPanel);
  }
}

async function projectSetupCommand(): Promise<void> {
  if (setupPanel) {
    setupPanel.reveal(vscode.ViewColumn.One);
    await renderProjectSetupPanel(setupPanel);
    return;
  }

  setupPanel = vscode.window.createWebviewPanel(
    'zebraProjectSetup',
    'Zebra Project Setup',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  setupPanel.onDidDispose(() => {
    setupPanel = undefined;
  });

  setupPanel.webview.onDidReceiveMessage(async (message: { command?: string }) => {
    if (!message.command) {
      return;
    }

    const commandMap: Record<string, string> = {
      refresh: 'zebra.refreshExplorer',
      init: 'zebra.initializeProject',
      setupToolchain: 'zebra.setupToolchain',
      installDrivers: 'zebra.installRobotDrivers',
      refreshDrivers: 'zebra.refreshRobotDriverCache',
      detectPort: 'zebra.detectSerialPort',
      checkProject: 'zebra.checkProject',
      deploy: 'zebra.deployProject',
      monitor: 'zebra.openSerialMonitor',
      driverHelp: 'zebra.openDriverHelp',
    };

    const mapped = commandMap[message.command];
    if (mapped) {
      await vscode.commands.executeCommand(mapped);
      await renderProjectSetupPanel(setupPanel!);
    }
  });

  await renderProjectSetupPanel(setupPanel);
}

async function renderProjectSetupPanel(panel: vscode.WebviewPanel): Promise<void> {
  const root = getWorkspaceRoot();
  const status = root ? inspectProject(root) : undefined;
  const toolPython = getToolPythonPath();
  const toolchainReady = fs.existsSync(toolPython);

  let serialSummary = 'Toolchain not installed';
  if (toolchainReady) {
    try {
      const ports = await listSerialCandidates(toolPython);
      serialSummary = ports.length ? `${ports.length} found; best ${ports[0].device} score=${ports[0].score}` : 'No serial ports found';
    } catch (err: unknown) {
      serialSummary = `Serial check failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const rows = status
    ? [
        statusRow('Workspace', status.root, true),
        statusRow('Toolchain venv', toolchainReady ? toolPython : 'missing', toolchainReady),
        statusRow('Serial ports', serialSummary, !serialSummary.startsWith('Serial check failed')),
        statusRow('main.py', status.hasMain ? 'found' : 'missing', status.hasMain),
        statusRow('user_main.py', status.hasUserMain ? 'found' : 'optional / missing', true),
        statusRow('robot/', status.hasRobotDir ? 'found' : 'missing', status.hasRobotDir),
        statusRow('zebra.json', status.hasZebraJson ? 'found' : 'missing', status.hasZebraJson),
        statusRow('resources/runtime/main.py', status.hasRuntimeMain ? 'found' : 'missing', status.hasRuntimeMain),
        statusRow('resources/runtime/robot/', status.hasRuntimeRobot ? 'found' : 'missing', status.hasRuntimeRobot),
      ].join('\n')
    : '<div class="row bad"><span>No workspace</span><strong>Open a project folder first</strong></div>';

  const problems = status?.problems.length
    ? `<ul>${status.problems.map(problem => `<li>${escapeHtml(problem)}</li>`).join('')}</ul>`
    : '<p>No project problems found.</p>';

  panel.webview.html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 18px; }
  h1 { margin-top: 0; }
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 14px; margin: 12px 0; background: var(--vscode-sideBar-background); }
  .row { display: flex; justify-content: space-between; gap: 18px; padding: 8px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  .row:last-child { border-bottom: none; }
  .row span { color: var(--vscode-descriptionForeground); }
  .row.good strong { color: #4ecf7a; }
  .row.bad strong { color: #ff6b6b; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: none; padding: 8px 10px; border-radius: 6px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  code { user-select: text; }
</style>
</head>
<body>
  <h1>Zebra Project Setup</h1>
  <p>Project setup, toolchain checks, serial detection, and deploy controls are available here.</p>
  <div class="card">${rows}</div>
  <div class="card"><h2>Problems</h2>${problems}</div>
  <div class="card">
    <h2>Actions</h2>
    <div class="actions">
      <button onclick="send('refresh')">Refresh</button>
      <button onclick="send('init')">Initialize Project</button>
      <button onclick="send('setupToolchain')">Setup Toolchain</button>
      <button onclick="send('installDrivers')">Install Robot Drivers</button>
      <button onclick="send('refreshDrivers')">Refresh Driver Cache</button>
      <button onclick="send('detectPort')">Detect Serial Port</button>
      <button onclick="send('checkProject')">Check Python</button>
      <button onclick="send('deploy')">Deploy</button>
      <button onclick="send('monitor')">Serial Monitor</button>
      <button onclick="send('driverHelp')">USB Driver Help</button>
    </div>
  </div>
<script>
  const vscode = acquireVsCodeApi();
  function send(command) { vscode.postMessage({ command }); }
</script>
</body>
</html>`;
}

function statusRow(label: string, value: string, ok: boolean): string {
  return `<div class="row ${ok ? 'good' : 'bad'}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

async function setupToolchainCommand(): Promise<string> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Zebra: Setting up MicroPython toolchain', cancellable: false },
    async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
      await fs.promises.mkdir(extensionContext.globalStorageUri.fsPath, { recursive: true });

      const python = getConfiguredPythonCommand();
      const toolPython = getToolPythonPath();
      const venvDir = getVenvDir();

      if (!fs.existsSync(toolPython)) {
        progress.report({ message: 'Creating Python virtual environment...' });
        await runCommand(python, ['-m', 'venv', venvDir]);
      }

      progress.report({ message: 'Upgrading pip...' });
      await runCommand(toolPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);

      progress.report({ message: `Installing ${REQUIRED_PYTHON_PACKAGES.join(', ')}...` });
      await runCommand(toolPython, ['-m', 'pip', 'install', '--upgrade', ...REQUIRED_PYTHON_PACKAGES]);

      progress.report({ message: 'Checking serial support...' });
      const ports = await listSerialCandidates(toolPython);
      output.appendLine(`Detected ${ports.length} serial device(s).`);
      ports.forEach((candidate: SerialCandidate) => {
        output.appendLine(`  - ${candidate.device} | ${candidate.description || candidate.manufacturer || 'serial device'} | score=${candidate.score}`);
      });

      void vscode.window.showInformationMessage('Zebra toolchain setup complete.');
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
    await fs.promises.writeFile(
      zebraJson,
      JSON.stringify(
        {
          name: path.basename(root),
          board: 'esp32',
          framework: 'micropython',
          runtime: 'zebra',
          port: 'AUTO',
          baud: getWorkspaceConfig<number>('flashBaud', 460800),
          driverRepo: getWorkspaceConfig<string>('driverRepoUrl', DEFAULT_DRIVER_REPO),
        },
        null,
        2,
      ) + os.EOL,
      'utf8',
    );
    output.appendLine(`Created ${zebraJson}`);
  }

  const mainPy = path.join(root, 'main.py');
  const userMainPy = path.join(root, 'user_main.py');
  if (!fs.existsSync(mainPy) && !fs.existsSync(userMainPy)) {
    await fs.promises.writeFile(mainPy, starterMainPy(), 'utf8');
    output.appendLine(`Created ${mainPy}`);
  }

  const vscodeDir = path.join(root, '.vscode');
  await fs.promises.mkdir(vscodeDir, { recursive: true });

  const settingsJson = path.join(vscodeDir, 'settings.json');
  if (!fs.existsSync(settingsJson)) {
    await fs.promises.writeFile(
      settingsJson,
      JSON.stringify({ 'python.analysis.extraPaths': ['./robot'], 'zebra.port': 'AUTO' }, null, 2) + os.EOL,
      'utf8',
    );
    output.appendLine(`Created ${settingsJson}`);
  }

  await ensureRobotDriversInstalled(root);
  await updateProjectContext();
  void vscode.window.showInformationMessage('Zebra project initialized.');
}

async function checkProjectCommand(): Promise<void> {
  const root = await requireUsableProject();
  if (!root) {
    return;
  }

  const toolPython = await ensureToolPython();
  const files = await collectDeployFiles(root);
  const pyFiles = files.filter((file: string) => file.endsWith('.py'));

  if (!pyFiles.length) {
    void vscode.window.showWarningMessage('No Python files found to check.');
    return;
  }

  for (const file of pyFiles) {
    output.appendLine(`Checking ${path.relative(root, file)}`);
    await runCommand(toolPython, ['-m', 'py_compile', file]);
  }

  void vscode.window.showInformationMessage(`Python syntax check passed for ${pyFiles.length} file(s).`);
}

async function detectSerialPortCommand(): Promise<void> {
  const toolPython = await ensureToolPython();
  const port = await pickSerialPort(toolPython);

  await vscode.workspace.getConfiguration('zebra').update('port', port, vscode.ConfigurationTarget.Workspace);
  await updateZebraJson({ port });

  void vscode.window.showInformationMessage(`Zebra serial port set to ${port}`);
}

async function refreshRobotDriverCacheCommand(): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Zebra: Refreshing robot driver cache', cancellable: false },
    async () => refreshRobotDriverCache(),
  );
  void vscode.window.showInformationMessage('Robot driver cache refreshed.');
}

async function installRobotDriversCommand(): Promise<void> {
  const root = requireWorkspaceRoot();
  await ensureRobotDriversInstalled(root, true);
  void vscode.window.showInformationMessage('Robot drivers installed into project.');
}

async function deployProjectCommand(): Promise<void> {
  const root = await requireUsableProject();
  if (!root) {
    return;
  }

  const toolPython = await ensureToolPython();
  let port = getWorkspaceConfig<string>('port', 'AUTO');
  if (!port || isAutoPort(port)) {
    port = await resolveSerialPort(toolPython);
    await vscode.workspace.getConfiguration('zebra').update('port', port, vscode.ConfigurationTarget.Workspace);
    await updateZebraJson({ port });
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Zebra: Deploying project to ESP32', cancellable: false },
    async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
      const stage = await buildStagedProject(root);
      const files = await collectDeployFiles(stage);
      if (!files.length) {
        throw new Error('No deployable .py or .mpy files found.');
      }

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

  void vscode.window.showInformationMessage('Zebra project deployed.');
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
  if (!firmware) {
    return;
  }

  const baud = String(getWorkspaceConfig<number>('flashBaud', 460800));

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Zebra: Flashing MicroPython firmware', cancellable: false },
    async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
      progress.report({ message: 'Erasing flash...' });
      await runCommand(toolPython, ['-m', 'esptool', '--chip', 'esp32', '--port', port, 'erase_flash']);

      progress.report({ message: 'Writing firmware...' });
      await runCommand(toolPython, ['-m', 'esptool', '--chip', 'esp32', '--port', port, '--baud', baud, 'write_flash', '-z', '0x1000', firmware]);
    },
  );

  void vscode.window.showInformationMessage('Firmware flash complete.');
}

async function resetDeviceCommand(): Promise<void> {
  const toolPython = await ensureToolPython();
  const port = await resolveSerialPort(toolPython);
  await runCommand(toolPython, ['-m', 'mpremote', 'connect', port, 'reset'], true);
  void vscode.window.showInformationMessage(`Reset sent to ${port}.`);
}

async function openSerialMonitorCommand(): Promise<void> {
  const toolPython = await ensureToolPython();
  const port = await resolveSerialPort(toolPython);
  const baud = String(getWorkspaceConfig<number>('serialMonitorBaud', 115200));
  const terminal = vscode.window.createTerminal('Zebra Serial Monitor');
  terminal.show();
  terminal.sendText(`${quoteShell(toolPython)} -m mpremote connect ${quoteShell(port)} resume repl --capture serial.log`, true);
  output.appendLine(`Opened serial monitor for ${port} at ${baud} baud. Note: mpremote controls baud internally for REPL connections.`);
}

async function ensureToolPython(): Promise<string> {
  const toolPython = getToolPythonPath();
  if (!fs.existsSync(toolPython)) {
    const choice = await vscode.window.showWarningMessage('Zebra toolchain is not installed. Run setup now?', 'Setup Toolchain', 'Cancel');
    if (choice !== 'Setup Toolchain') {
      throw new Error('Toolchain setup is required.');
    }
    return setupToolchainCommand();
  }
  return toolPython;
}

async function requireUsableProject(): Promise<string | undefined> {
  const root = getWorkspaceRoot();
  if (!root) {
    void vscode.window.showErrorMessage('Open a Zebra project folder first.');
    return undefined;
  }

  const status = inspectProject(root);
  if (status.valid) {
    return root;
  }

  const choice = await vscode.window.showWarningMessage(
    `This does not look like a complete Zebra project:\n${status.problems.join('\n')}`,
    { modal: true },
    'Open Setup',
    'Initialize Project',
    'Continue Anyway',
    'Cancel',
  );

  if (choice === 'Open Setup') {
    await projectSetupCommand();
    return undefined;
  }
  if (choice === 'Initialize Project') {
    await initializeProjectCommand();
    return root;
  }
  if (choice === 'Continue Anyway') {
    return root;
  }
  return undefined;
}

function inspectProject(root: string): ProjectStatus {
  const hasMain = fs.existsSync(path.join(root, 'main.py'));
  const hasUserMain = fs.existsSync(path.join(root, 'user_main.py'));
  const hasRobotDir = fs.existsSync(path.join(root, 'robot'));
  const hasZebraJson = fs.existsSync(path.join(root, 'zebra.json'));
  const hasRuntimeMain = fs.existsSync(getBundledRuntimeMain());
  const hasRuntimeRobot = fs.existsSync(getBundledRobotDir());

  const problems: string[] = [];
  if (!hasMain && !hasUserMain) problems.push('Missing main.py or user_main.py.');
  if (!hasRobotDir) problems.push('Missing project robot/ driver directory.');
  if (!hasZebraJson) problems.push('Missing zebra.json project config.');
  if (!hasRuntimeMain) problems.push(`Missing bundled runtime main.py at ${getBundledRuntimeMain()}.`);
  if (!hasRuntimeRobot) problems.push(`Missing bundled runtime robot/ at ${getBundledRobotDir()}.`);

  return { root, valid: problems.length === 0, hasMain, hasUserMain, hasRobotDir, hasZebraJson, hasRuntimeMain, hasRuntimeRobot, problems };
}

async function ensureRobotDriversInstalled(projectRoot: string, force = false): Promise<void> {
  const robotDst = path.join(projectRoot, 'robot');
  if (fs.existsSync(robotDst) && !force) {
    output.appendLine(`robot/ already exists: ${robotDst}`);
    return;
  }

  const source = await getRobotDriverSource();
  if (!source || !fs.existsSync(source)) {
    throw new Error('Could not find robot drivers in resources/runtime/robot, configured cache, or cloned repo cache.');
  }

  if (fs.existsSync(robotDst) && force) {
    await fs.promises.rm(robotDst, { recursive: true, force: true });
  }

  await copyTree(source, robotDst);
  output.appendLine(`Installed robot drivers from ${source} -> ${robotDst}`);
}

async function getRobotDriverSource(): Promise<string> {
  const bundled = getBundledRobotDir();
  if (fs.existsSync(bundled)) {
    return bundled;
  }

  const configuredCache = getWorkspaceConfig<string>('driverCachePath', '');
  if (configuredCache) {
    const robot = path.join(configuredCache, 'robot');
    if (fs.existsSync(robot)) return robot;
    if (fs.existsSync(configuredCache)) return configuredCache;
  }

  const cacheRobot = path.join(getDriverCacheDir(), 'robot');
  if (fs.existsSync(cacheRobot)) {
    return cacheRobot;
  }

  await refreshRobotDriverCache();
  if (fs.existsSync(cacheRobot)) {
    return cacheRobot;
  }

  return '';
}

async function refreshRobotDriverCache(): Promise<void> {
  const cacheDir = getDriverCacheDir();
  await fs.promises.rm(cacheDir, { recursive: true, force: true });
  await fs.promises.mkdir(path.dirname(cacheDir), { recursive: true });

  const repo = getWorkspaceConfig<string>('driverRepoUrl', DEFAULT_DRIVER_REPO) || DEFAULT_DRIVER_REPO;
  const branch = getWorkspaceConfig<string>('driverRepoBranch', '');
  const args = branch ? ['clone', '--depth', '1', '--branch', branch, repo, cacheDir] : ['clone', '--depth', '1', repo, cacheDir];
  await runCommand('git', args);
  output.appendLine(`Driver cache cloned to ${cacheDir}`);
}

async function buildStagedProject(projectRoot: string): Promise<string> {
  const stage = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'zbot_stage_'));
  const runtimeMain = getRuntimeMainForProject(projectRoot);
  const runtimeRobot = getRuntimeRobotForProject(projectRoot);
  const userEntry = fs.existsSync(path.join(projectRoot, 'user_main.py')) ? path.join(projectRoot, 'user_main.py') : path.join(projectRoot, 'main.py');

  if (!fs.existsSync(runtimeMain)) throw new Error(`Runtime main.py not found: ${runtimeMain}`);
  if (!fs.existsSync(runtimeRobot)) throw new Error(`Runtime robot/ folder not found: ${runtimeRobot}`);
  if (!fs.existsSync(userEntry)) throw new Error('Project must contain main.py or user_main.py.');

  await fs.promises.copyFile(runtimeMain, path.join(stage, 'main.py'));
  await copyTree(runtimeRobot, path.join(stage, 'robot'));
  await fs.promises.copyFile(userEntry, path.join(stage, 'user_main.py'));

  await copyProjectExtras(projectRoot, stage);
  return stage;
}

function getRuntimeMainForProject(projectRoot: string): string {
  const configuredRuntime = getWorkspaceConfig<string>('runtimePath', '');
  if (configuredRuntime) return path.join(configuredRuntime, 'main.py');
  const jsonRuntime = readZebraJsonRuntimePath(projectRoot);
  if (jsonRuntime) return path.join(jsonRuntime, 'main.py');
  return getBundledRuntimeMain();
}

function getRuntimeRobotForProject(projectRoot: string): string {
  const configuredRuntime = getWorkspaceConfig<string>('runtimePath', '');
  if (configuredRuntime) return path.join(configuredRuntime, 'robot');
  const jsonRuntime = readZebraJsonRuntimePath(projectRoot);
  if (jsonRuntime) return path.join(jsonRuntime, 'robot');
  return getBundledRobotDir();
}

function readZebraJsonRuntimePath(projectRoot: string): string {
  const file = path.join(projectRoot, 'zebra.json');
  if (!fs.existsSync(file)) return '';
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { runtimePath?: string };
    return data.runtimePath || '';
  } catch {
    return '';
  }
}

async function copyProjectExtras(projectRoot: string, stage: string): Promise<void> {
  const entries = await walk(projectRoot);
  for (const source of entries) {
    const rel = normalizePath(path.relative(projectRoot, source));
    if (rel === 'main.py' || rel === 'user_main.py' || rel.startsWith('robot/')) continue;
    if (shouldSkipPath(rel)) continue;
    if (!DEPLOY_SUFFIXES.has(path.extname(source).toLowerCase())) continue;
    const dest = path.join(stage, rel);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(source, dest);
  }
}

async function collectDeployFiles(root: string): Promise<string[]> {
  const files = await walk(root);
  return files
    .filter((file: string) => DEPLOY_SUFFIXES.has(path.extname(file).toLowerCase()))
    .filter((file: string) => !shouldSkipPath(normalizePath(path.relative(root, file))))
    .sort((a: string, b: string) => normalizePath(path.relative(root, a)).localeCompare(normalizePath(path.relative(root, b))));
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;

  async function visit(dir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      const rel = normalizePath(path.relative(root, full));
      if (shouldSkipPath(rel)) continue;
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }

  await visit(root);
  return out;
}

function shouldSkipPath(rel: string): boolean {
  const parts = rel.split('/');
  if (parts.some((part: string) => SKIP_DIRS.has(part))) return true;
  const name = path.basename(rel).toLowerCase();
  if (name.startsWith('teleop') && name.endsWith('.py')) return true;
  return false;
}

async function ensureRemoteDirs(toolPython: string, port: string, rel: string, madeDirs: Set<string>): Promise<void> {
  const parent = path.posix.dirname(rel);
  if (!parent || parent === '.') return;

  const parts = parent.split('/');
  const built: string[] = [];
  for (const part of parts) {
    built.push(part);
    const remote = `:/${built.join('/')}`;
    if (madeDirs.has(remote)) continue;
    await runCommand(toolPython, ['-m', 'mpremote', 'connect', port, 'fs', 'mkdir', remote], true);
    madeDirs.add(remote);
  }
}

async function updateZebraJson(patch: Record<string, unknown>): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) return;
  const file = path.join(root, 'zebra.json');
  let data: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(await fs.promises.readFile(file, 'utf8')) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }
  data = { ...data, ...patch };
  await fs.promises.writeFile(file, JSON.stringify(data, null, 2) + os.EOL, 'utf8');
}

async function copyTree(src: string, dst: string): Promise<void> {
  await fs.promises.mkdir(dst, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to);
    } else if (entry.isFile()) {
      await fs.promises.mkdir(path.dirname(to), { recursive: true });
      await fs.promises.copyFile(from, to);
    }
  }
}

async function updateProjectContext(): Promise<void> {
  const root = getWorkspaceRoot();
  const active = root ? inspectProject(root).valid : false;
  await vscode.commands.executeCommand('setContext', 'zebra.projectActive', active);
}

function requireWorkspaceRoot(): string {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('Open a Zebra project folder first.');
  return root;
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function getWorkspaceConfig<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration('zebra').get<T>(key, fallback);
}

function getConfiguredPythonCommand(): string {
  return getWorkspaceConfig<string>('pythonPath', process.platform === 'win32' ? 'python' : 'python3');
}

function getVenvDir(): string {
  return path.join(extensionContext.globalStorageUri.fsPath, '.zebra-venv');
}

function getToolPythonPath(): string {
  const venv = getVenvDir();
  return process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
}

function getDriverCacheDir(): string {
  return path.join(extensionContext.globalStorageUri.fsPath, 'driver-cache');
}

function getBundledRuntimeDir(): string {
  return path.join(extensionContext.extensionPath, 'resources', 'runtime');
}

function getBundledRobotDir(): string {
  return path.join(getBundledRuntimeDir(), 'robot');
}

function getBundledRuntimeMain(): string {
  return path.join(getBundledRuntimeDir(), 'main.py');
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
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      output.append(text);
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      output.append(text);
    });

    child.on('error', (err: Error) => {
      if (ignoreFailure) resolve(stdout.trim());
      else reject(err);
    });

    child.on('close', (code: number | null) => {
      if (code !== 0 && !ignoreFailure) {
        reject(new Error(`Command failed with code ${code}: ${command} ${args.join(' ')}\n${stderr}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function starterMainPy(): string {
  return `import uasyncio as asyncio
import gc


async def main(zbot):
    gc.collect()

    zbot.display("ZebraBot", "Ready")

    while True:
        await asyncio.sleep_ms(100)
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

class ZebraExplorerProvider implements vscode.TreeDataProvider<ZebraTreeItem> {
  private readonly emitter = new vscode.EventEmitter<ZebraTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: ZebraTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ZebraTreeItem): Thenable<ZebraTreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    const root = getWorkspaceRoot();
    if (!root) {
      return Promise.resolve([
        new ZebraTreeItem('Open a folder to start', 'No workspace', vscode.TreeItemCollapsibleState.None, 'info'),
        commandItem('Project Setup', 'zebra.projectSetup', 'gear'),
      ]);
    }

    const status = inspectProject(root);
    const items: ZebraTreeItem[] = [
      new ZebraTreeItem(status.valid ? 'Project Ready' : 'Project Needs Setup', path.basename(root), vscode.TreeItemCollapsibleState.None, status.valid ? 'pass' : 'warning'),
      commandItem('Project Setup', 'zebra.projectSetup', 'gear'),
      commandItem('Initialize Project', 'zebra.initializeProject', 'new-folder'),
      commandItem('Setup Toolchain', 'zebra.setupToolchain', 'tools'),
      commandItem('Detect Serial Port', 'zebra.detectSerialPort', 'plug'),
      commandItem('Deploy Project', 'zebra.deployProject', 'cloud-upload'),
      commandItem('Serial Monitor', 'zebra.openSerialMonitor', 'terminal'),
      commandItem('Flash Firmware', 'zebra.flashFirmware', 'zap'),
    ];

    return Promise.resolve(items);
  }
}

class ZebraTreeItem extends vscode.TreeItem {
  constructor(label: string, description: string, collapsibleState: vscode.TreeItemCollapsibleState, icon?: string) {
    super(label, collapsibleState);
    this.description = description;
    if (icon) {
      this.iconPath = new vscode.ThemeIcon(icon);
    }
  }
}

function commandItem(label: string, command: string, icon: string): ZebraTreeItem {
  const item = new ZebraTreeItem(label, '', vscode.TreeItemCollapsibleState.None, icon);
  item.command = { command, title: label };
  return item;
}
