import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import * as https from 'https';

import {
  SerialCandidate,
  listSerialCandidates,
  pickSerialPort,
  resolveSerialPort,
  openDriverHelp,
} from './serial';
import {
  ProjectSetupAction,
  ProjectSetupPanel,
  ProjectSetupState,
} from './projectSetupPanel';

const REQUIRED_PYTHON_PACKAGES = ['pyserial', 'mpremote', 'esptool', 'bleak'];
const DEFAULT_DRIVER_REPO = 'https://github.com/JoshAyersSBT/Zebra_SOL_Flasher.git';
const DEFAULT_MICROPYTHON_FIRMWARE_URL = 'https://micropython.org/resources/firmware/ESP32_GENERIC-20260406-v1.28.0.bin';
const DEFAULT_NATIVE_BUILD_ROOT = '~/zbot-fw';
const DEFAULT_WSL_FLASHER_USERNAME = 'flasher';
const DEFAULT_WSL_FLASHER_PASSWORD = 'flasher';
const MICROPYTHON_TAG = 'v1.28.0';
const ESP_IDF_TAG = 'v5.5.1';
const SKIP_DIRS = new Set(['__pycache__', '.git', '.vscode', '.idea', '.mypy_cache', '.pytest_cache', 'node_modules', '.venv', 'venv', 'dist', 'build']);
const DEPLOY_SUFFIXES = new Set(['.py', '.mpy']);

let output: vscode.OutputChannel;
let extensionContext: vscode.ExtensionContext;
let explorerProvider: ZebraExplorerProvider | undefined;

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

interface BleDeviceInfo {
  address: string;
  name: string;
  localName: string;
  services: string[];
  isZebraCandidate: boolean;
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  output = vscode.window.createOutputChannel('Zebra Flasher');

  explorerProvider = new ZebraExplorerProvider();

  context.subscriptions.push(output);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('zebraExplorer', explorerProvider));

  registerCommand(context, 'zebra.refreshExplorer', refreshExplorerCommand, false);
  registerCommand(context, 'zebra.welcome', projectSetupCommand, false);
  registerCommand(context, 'zebra.projectSetup', projectSetupCommand, false);
  registerCommand(context, 'zebra.projectStatus', projectSetupCommand, false);

  registerCommand(context, 'zebra.initProject', initializeProjectCommand, true);
  registerCommand(context, 'zebra.initializeProject', initializeProjectCommand, true);

  registerCommand(context, 'zebra.checkProject', checkProjectCommand, true);
  registerCommand(context, 'zebra.setupToolchain', setupToolchainCommand, true);
  registerCommand(context, 'zebra.setupNativeToolchain', setupNativeToolchainCommand, true);
  registerCommand(context, 'zebra.installPython', installPythonCommand, true);

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
}

async function projectSetupCommand(): Promise<void> {
  await ProjectSetupPanel.show(extensionContext.extensionUri, getProjectSetupState, runProjectSetupAction);
}

async function getProjectSetupState(): Promise<ProjectSetupState> {
  const root = getWorkspaceRoot();
  const status = root ? inspectProject(root) : undefined;
  const toolPython = getToolPythonPath();
  const toolchainReady = fs.existsSync(toolPython);
  const configuredPort = getWorkspaceConfig<string>('port', 'AUTO');
  const deployTransportRaw = getWorkspaceConfig<string>('deployTransport', 'serial').trim().toLowerCase();
  const deployTransport = deployTransportRaw === 'ble' ? 'ble' : 'serial';
  const bleName = getWorkspaceConfig<string>('bleName', 'ZebraBot') || 'ZebraBot';
  const bleChunkSize = Math.max(1, Math.min(128, getWorkspaceConfig<number>('bleChunkSize', 12) || 12));
  const serialPorts: ProjectSetupState['serial']['ports'] = [];
  let serialSummary = toolchainReady ? 'Not checked' : 'Install the toolchain first';
  let serialChecked = false;

  if (toolchainReady) {
    serialChecked = true;
    try {
      const ports = await listSerialCandidates(toolPython);
      serialPorts.push(
        ...ports.map((candidate: SerialCandidate) => ({
          device: candidate.device,
          description: candidate.description || '',
          manufacturer: candidate.manufacturer || '',
          score: candidate.score,
        })),
      );
      serialSummary = ports.length
        ? `${ports.length} port${ports.length === 1 ? '' : 's'} found; best match ${ports[0].device}`
        : 'No serial ports found';
    } catch (err: unknown) {
      serialSummary = `Serial check failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return {
    workspaceRoot: root || null,
    project: status
      ? {
          valid: status.valid,
          hasMain: status.hasMain,
          hasUserMain: status.hasUserMain,
          hasRobotDir: status.hasRobotDir,
          hasZebraJson: status.hasZebraJson,
          hasRuntimeMain: status.hasRuntimeMain,
          hasRuntimeRobot: status.hasRuntimeRobot,
          problems: status.problems,
        }
      : null,
    toolchain: {
      installed: toolchainReady,
      pythonPath: toolPython,
      nativeSummary: getNativeToolchainSummary(),
    },
    serial: {
      checked: serialChecked,
      configuredPort,
      summary: serialSummary,
      ports: serialPorts,
    },
    deploy: {
      transport: deployTransport,
      bleName,
      bleChunkSize,
    },
  };
}

async function runProjectSetupAction(action: ProjectSetupAction): Promise<void> {
  switch (action) {
    case 'openFolder':
      await vscode.commands.executeCommand('vscode.openFolder');
      break;
    case 'refresh':
      await refreshExplorerCommand();
      break;
    case 'setupToolchain':
      await setupToolchainCommand();
      break;
    case 'setupNativeToolchain':
      await setupNativeToolchainCommand();
      break;
    case 'installPython':
      await installPythonCommand();
      break;
    case 'initializeProject':
      await initializeProjectCommand();
      break;
    case 'installRobotDrivers':
      await installRobotDriversCommand();
      break;
    case 'refreshRobotDriverCache':
      await refreshRobotDriverCacheCommand();
      break;
    case 'detectSerialPort':
      await detectSerialPortCommand();
      break;
    case 'checkProject':
      await checkProjectCommand();
      break;
    case 'deployProject':
      await deployProjectCommand();
      break;
    case 'flashFirmware':
      await flashFirmwareCommand();
      break;
    case 'openSerialMonitor':
      await openSerialMonitorCommand();
      break;
    case 'openDriverHelp':
      await openDriverHelp();
      break;
    case 'setSerialDeploy':
      await vscode.workspace.getConfiguration('zebra').update('deployTransport', 'serial', vscode.ConfigurationTarget.Workspace);
      break;
    case 'setBleDeploy':
      await vscode.workspace.getConfiguration('zebra').update('deployTransport', 'ble', vscode.ConfigurationTarget.Workspace);
      break;
  }

  await updateProjectContext();
  explorerProvider?.refresh();
}


async function installPythonCommand(): Promise<void> {
  output.show(true);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Zebra: Installing Python 3', cancellable: false },
    async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
      const python = await resolveOrInstallPythonCommand(progress);
      output.appendLine(`Python ready: ${python.display}`);
      void vscode.window.showInformationMessage(`Python is ready: ${python.display}`);
    },
  );
}

async function setupToolchainCommand(): Promise<string> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Zebra: Setting up MicroPython toolchain', cancellable: false },
    async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
      await fs.promises.mkdir(extensionContext.globalStorageUri.fsPath, { recursive: true });

      const python = await resolveOrInstallPythonCommand(progress);
      const toolPython = getToolPythonPath();
      const venvDir = getVenvDir();

      output.appendLine(`Using Python: ${python.display}`);

      if (!fs.existsSync(toolPython)) {
        progress.report({ message: 'Creating Python virtual environment...' });
        await runCommand(python.command, [...python.argsPrefix, '-m', 'venv', venvDir]);
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

async function setupNativeToolchainCommand(): Promise<void> {
  await setupToolchainCommand();

  if (process.platform === 'win32') {
    const distro = await ensureWindowsWslDebian();
    if (!distro) {
      return;
    }

    await ensureWindowsWslFlasherUser(distro);

    const script = nativeLinuxSetupScript(getNativeBuildRoot());
    const terminal = vscode.window.createTerminal('Zebra Native C Setup');
    terminal.show();
    terminal.sendText(`wsl.exe -d ${quotePowerShellArg(distro)} -- bash -lc ${quotePowerShellArg(script)}`, true);
    output.appendLine(`Opened WSL native C setup in distro: ${distro}`);
    void vscode.window.showInformationMessage('Zebra native C setup started in a terminal. Re-run after it finishes if sudo prompts were needed.');
    return;
  }

  const script = nativeLinuxSetupScript(getNativeBuildRoot());
  const terminal = vscode.window.createTerminal('Zebra Native C Setup');
  terminal.show();
  terminal.sendText(`bash -lc ${quoteShell(script)}`, true);
  output.appendLine('Opened native C setup terminal.');
  void vscode.window.showInformationMessage('Zebra native C setup started in a terminal.');
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
  const deployTransport = getWorkspaceConfig<string>('deployTransport', 'serial').trim().toLowerCase();

  if (deployTransport === 'ble') {
    await deployUserProgramWithBle(root, toolPython);
    void vscode.window.showInformationMessage('Zebra user program deployed over BLE.');
    return;
  }

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
        await runMpremoteCommand(toolPython, port, ['fs', 'cp', localPath, `:/${rel}`]);
      }

      progress.report({ message: 'Resetting device...' });
      await runMpremoteCommand(toolPython, port, ['reset'], true);
    },
  );

  void vscode.window.showInformationMessage('Zebra project deployed.');
}

async function deployUserProgramWithBle(root: string, toolPython: string): Promise<void> {
  await ensurePythonPackage(toolPython, 'bleak');

  const bleName = getWorkspaceConfig<string>('bleName', 'ZebraBot') || 'ZebraBot';
  const chunkSize = Math.max(1, Math.min(128, getWorkspaceConfig<number>('bleChunkSize', 12) || 12));
  const selectedDevice = await pickBleDevice(toolPython, bleName);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Zebra: BLE upload to ${selectedDevice.label}`, cancellable: false },
    async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
      const stage = await buildStagedProject(root);
      const userMain = path.join(stage, 'user_main.py');
      if (!fs.existsSync(userMain)) {
        throw new Error('Staged user_main.py was not created.');
      }

      output.appendLine(`BLE deploy stage: ${stage}`);
      output.appendLine(`BLE uploading ${userMain} to /user_main.py on ${selectedDevice.label} (${selectedDevice.address})`);
      progress.report({ message: 'Uploading user_main.py over BLE...' });

      await runCommand(toolPython, [
        getBlePutScriptPath(),
        userMain,
        '--name',
        bleName,
        '--address',
        selectedDevice.address,
        '--chunk-size',
        String(chunkSize),
        '--reset',
      ]);
    },
  );
}

async function pickBleDevice(toolPython: string, preferredName: string): Promise<{ address: string; label: string }> {
  const devices = await listBleDevices(toolPython, preferredName);
  if (!devices.length) {
    throw new Error('No nearby BLE devices found. Make sure the board is powered and advertising.');
  }

  const items = devices.map(device => {
    const label = device.name || device.localName || '(unnamed BLE device)';
    const services = device.services.slice(0, 3).join(', ');
    return {
      label: device.isZebraCandidate ? `$(radio-tower) ${label}` : label,
      description: device.address,
      detail: [
        device.isZebraCandidate ? 'Likely Zebra target' : 'Nearby BLE device',
        services ? `services: ${services}` : '',
      ].filter(Boolean).join(' - '),
      device,
      picked: device.isZebraCandidate,
    };
  });

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Select BLE device for Zebra upload',
    placeHolder: `Choose ${preferredName} or another nearby BLE device`,
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!picked) {
    throw new Error('BLE device selection cancelled.');
  }

  const label = picked.device.name || picked.device.localName || picked.device.address;
  output.appendLine(`Selected BLE device: ${label} (${picked.device.address})`);
  return { address: picked.device.address, label };
}

async function listBleDevices(toolPython: string, preferredName: string): Promise<BleDeviceInfo[]> {
  const raw = await runCommand(toolPython, [
    getBlePutScriptPath(),
    '--list',
    '--json',
    '--name',
    preferredName,
    '--scan-timeout',
    '8',
  ]);

  try {
    const parsed = JSON.parse(raw) as BleDeviceInfo[];
    return parsed.filter(device => !!device.address);
  } catch (err: unknown) {
    throw new Error(`Could not parse BLE device scan results: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function flashFirmwareCommand(): Promise<void> {
  const toolPython = await ensureToolPython();
  let port = getWorkspaceConfig<string>('port', 'AUTO');
  if (!port || isAutoPort(port)) {
    port = await resolveSerialPort(toolPython);
    await vscode.workspace.getConfiguration('zebra').update('port', port, vscode.ConfigurationTarget.Workspace);
    await updateZebraJson({ port });
  }

  const firmware = await pickFirmwareForFlash();
  if (!firmware) {
    return;
  }

  const baud = String(getWorkspaceConfig<number>('flashBaud', 460800));

  output.appendLine(`Using serial port: ${port}`);
  output.appendLine(`Firmware: ${firmware.label}`);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Zebra: Flashing MicroPython firmware', cancellable: false },
    async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
      progress.report({ message: 'Erasing flash...' });
      await runCommand(toolPython, ['-m', 'esptool', '--chip', 'esp32', '--port', port, 'erase_flash']);

      progress.report({ message: 'Writing firmware...' });
      if (firmware.kind === 'zebra-native') {
        await runCommand(toolPython, [
          '-m', 'esptool',
          '--chip', 'esp32',
          '--port', port,
          '--baud', baud,
          '--before', 'default_reset',
          '--after', 'hard_reset',
          'write_flash',
          '--flash_mode', 'dio',
          '--flash_size', '4MB',
          '--flash_freq', '40m',
          '0x1000', firmware.bootloader,
          '0x8000', firmware.partitionTable,
          '0x10000', firmware.micropython,
        ]);
      } else {
        await runCommand(toolPython, ['-m', 'esptool', '--chip', 'esp32', '--port', port, '--baud', baud, 'write_flash', '-z', '0x1000', firmware.path]);
      }
    },
  );

  void vscode.window.showInformationMessage('Firmware flash complete.');
}

type FirmwareSelection =
  | { kind: 'single-bin'; path: string; label: string }
  | { kind: 'zebra-native'; bootloader: string; partitionTable: string; micropython: string; label: string };

async function pickFirmwareForFlash(): Promise<FirmwareSelection | undefined> {
  const firmwareUrl = getWorkspaceConfig<string>('firmwareUrl', DEFAULT_MICROPYTHON_FIRMWARE_URL) || DEFAULT_MICROPYTHON_FIRMWARE_URL;
  const firmwareName = path.basename(new URL(firmwareUrl).pathname);

  const choice = await vscode.window.showQuickPick(
    [
      {
        label: 'Use auto-collected ESP32 MicroPython firmware',
        description: firmwareName,
        detail: firmwareUrl,
        id: 'auto',
      },
      {
        label: 'Select ESP32 firmware .bin',
        description: 'Choose a local binary',
        detail: 'Use this for a custom ESP32 MicroPython firmware image.',
        id: 'custom',
      },
      {
        label: 'Select Zebra native firmware folder',
        description: 'bootloader.bin + partition-table.bin + micropython.bin',
        detail: 'Use this for C driver/user_main builds from build_tools/zbot_firmware.',
        id: 'native-folder',
      },
    ],
    {
      title: 'Select ESP32 MicroPython firmware',
      placeHolder: 'Use the auto-collected firmware or select a local .bin',
    },
  );

  if (!choice) {
    return undefined;
  }

  if (choice.id === 'custom') {
    return pickLocalFirmwareBin();
  }

  if (choice.id === 'native-folder') {
    return pickNativeFirmwareFolder();
  }

  const firmwarePath = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Zebra: Collecting ESP32 firmware', cancellable: false },
    async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
      progress.report({ message: firmwareName });
      return ensureDefaultFirmwareDownloaded(firmwareUrl);
    },
  );
  return { kind: 'single-bin', path: firmwarePath, label: firmwarePath };
}

async function pickLocalFirmwareBin(): Promise<FirmwareSelection | undefined> {
  const picked = await vscode.window.showOpenDialog({
    title: 'Select MicroPython firmware .bin',
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { Firmware: ['bin'], All: ['*'] },
  });

  const firmware = picked?.[0]?.fsPath;
  if (!firmware) {
    return undefined;
  }

  return { kind: 'single-bin', path: firmware, label: firmware };
}

async function pickNativeFirmwareFolder(): Promise<FirmwareSelection | undefined> {
  const picked = await vscode.window.showOpenDialog({
    title: 'Select Zebra native firmware folder',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
  });

  const folder = picked?.[0]?.fsPath;
  if (!folder) {
    return undefined;
  }

  const bootloader = path.join(folder, 'bootloader.bin');
  const partitionTable = path.join(folder, 'partition-table.bin');
  const micropython = path.join(folder, 'micropython.bin');
  const missing = [];
  if (!await isUsableFile(bootloader)) missing.push('bootloader.bin');
  if (!await isUsableFile(partitionTable)) missing.push('partition-table.bin');
  if (!await isUsableFile(micropython)) missing.push('micropython.bin');

  if (missing.length) {
    throw new Error(`Native firmware folder is missing: ${missing.join(', ')}`);
  }

  return { kind: 'zebra-native', bootloader, partitionTable, micropython, label: folder };
}

async function ensureDefaultFirmwareDownloaded(firmwareUrl: string): Promise<string> {
  await fs.promises.mkdir(getFirmwareCacheDir(), { recursive: true });

  const firmwareName = path.basename(new URL(firmwareUrl).pathname);
  const destination = path.join(getFirmwareCacheDir(), firmwareName);

  if (await isUsableFile(destination)) {
    output.appendLine(`Using cached firmware: ${destination}`);
    return destination;
  }

  output.appendLine(`Downloading firmware: ${firmwareUrl}`);
  await downloadFile(firmwareUrl, destination);
  output.appendLine(`Firmware cached: ${destination}`);
  return destination;
}

async function isUsableFile(file: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(file);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

async function downloadFile(url: string, destination: string, redirects = 0): Promise<void> {
  if (redirects > 5) {
    throw new Error(`Too many redirects while downloading firmware: ${url}`);
  }

  const temp = `${destination}.download`;
  let wroteFile = false;

  await new Promise<void>((resolve, reject) => {
    const request = https.get(url, (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;

      if (status >= 300 && status < 400 && location) {
        response.resume();
        const redirected = new URL(location, url).toString();
        downloadFile(redirected, destination, redirects + 1).then(resolve, reject);
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Firmware download failed with HTTP ${status}: ${url}`));
        return;
      }

      const file = fs.createWriteStream(temp);
      wroteFile = true;
      response.pipe(file);
      file.on('finish', () => file.close((err) => err ? reject(err) : resolve()));
      file.on('error', reject);
    });

    request.on('error', reject);
  });

  if (wroteFile) {
    await fs.promises.rename(temp, destination);
  }
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

  const runtimeBoot = path.join(path.dirname(runtimeMain), 'boot.py');
  if (fs.existsSync(runtimeBoot)) {
    await fs.promises.copyFile(runtimeBoot, path.join(stage, 'boot.py'));
  }
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
    await runMpremoteCommand(toolPython, port, ['fs', 'mkdir', remote], true);
    madeDirs.add(remote);
  }
}

async function runMpremoteCommand(toolPython: string, port: string, args: string[], ignoreFailure = false): Promise<string> {
  const commandArgs = ['-m', 'mpremote', 'connect', port, ...args];

  try {
    return await runCommand(toolPython, commandArgs, ignoreFailure);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('could not enter raw repl')) {
      throw err;
    }

    output.appendLine('mpremote could not enter raw REPL; resetting device and retrying once...');
    await runCommand(toolPython, ['-m', 'mpremote', 'connect', port, 'reset'], true);
    await sleep(1500);
    return runCommand(toolPython, commandArgs, ignoreFailure);
  }
}

async function ensurePythonPackage(toolPython: string, packageName: string): Promise<void> {
  if (await canRunCommand(toolPython, ['-c', `import ${packageName}`])) {
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `The Zebra Python toolchain needs ${packageName} for BLE deploy.`,
    `Install ${packageName}`,
    'Cancel',
  );
  if (choice !== `Install ${packageName}`) {
    throw new Error(`BLE deploy requires Python package ${packageName}.`);
  }

  await runCommand(toolPython, ['-m', 'pip', 'install', '--upgrade', packageName]);
}

function getBlePutScriptPath(): string {
  return path.join(extensionContext.extensionPath, 'resources', 'tools', 'ble_put.py');
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

interface PythonCommand {
  command: string;
  argsPrefix: string[];
  display: string;
}

function getConfiguredPythonCommand(): string {
  const inspected = vscode.workspace.getConfiguration('zebra').inspect<string>('pythonPath');
  const configured =
    inspected?.workspaceFolderValue ??
    inspected?.workspaceValue ??
    inspected?.globalValue ??
    '';

  return configured.trim();
}

async function resolvePythonCommand(): Promise<PythonCommand> {
  const configured = getConfiguredPythonCommand();
  if (configured) {
    if (await canRunCommand(configured, ['--version'])) {
      return { command: configured, argsPrefix: [], display: configured };
    }
    throw new Error(`Configured Python path was not found or could not run: ${configured}`);
  }

  const found = await findPythonCommand();
  if (found) {
    return found;
  }

  const macHint = process.platform === 'darwin'
    ? ' On macOS, install Python 3 with Homebrew using: brew install python. If VS Code was opened from Finder, restart VS Code after installing Python.'
    : '';

  throw new Error(`Python 3 was not found. Set zebra.pythonPath in VS Code settings or install Python 3.${macHint}`);
}

async function findPythonCommand(): Promise<PythonCommand | undefined> {
  for (const candidate of getPythonCandidates()) {
    if (await canRunCommand(candidate.command, [...candidate.argsPrefix, '--version'])) {
      return candidate;
    }
  }

  return undefined;
}


async function resolveOrInstallPythonCommand(
  progress?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<PythonCommand> {
  try {
    return await resolvePythonCommand();
  } catch (err: unknown) {
    const configured = getConfiguredPythonCommand();
    if (configured) {
      throw err;
    }

    progress?.report({ message: 'Python 3 was not found. Preparing installer...' });
    output.appendLine('Python 3 was not found. Attempting platform installer.');

    const installed = await installPython3IfPossible(progress);
    if (!installed) {
      throw new Error(getPythonInstallInstructions());
    }

    progress?.report({ message: 'Python install finished. Re-checking Python...' });
    return await resolvePythonCommand();
  }
}

async function installPython3IfPossible(
  progress?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<boolean> {
  if (process.platform === 'darwin') {
    return installPython3OnMac(progress);
  }

  if (process.platform === 'win32') {
    return installPython3OnWindows(progress);
  }

  return installPython3OnLinux(progress);
}

async function installPython3OnMac(
  progress?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<boolean> {
  const brew = await resolveBrewCommand();

  if (brew) {
    progress?.report({ message: 'Installing Python 3 with Homebrew...' });
    output.appendLine(`Using Homebrew to install Python: ${brew}`);
    await runCommand(brew, ['install', 'python']);
    return true;
  }

  const choice = await vscode.window.showWarningMessage(
    'Python 3 was not found and Homebrew is not installed. Zebra can open the Homebrew installer instructions, then you can run Setup Toolchain again.',
    'Open Homebrew Instructions',
    'Open Python Downloads',
    'Cancel',
  );

  if (choice === 'Open Homebrew Instructions') {
    await vscode.env.openExternal(vscode.Uri.parse('https://brew.sh/'));
  } else if (choice === 'Open Python Downloads') {
    await vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/macos/'));
  }

  return false;
}

async function installPython3OnWindows(
  progress?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<boolean> {
  if (await canRunCommand('winget', ['--version'])) {
    progress?.report({ message: 'Installing Python 3.12 with winget...' });
    output.appendLine('Using winget to install Python 3.12.');
    await runCommand('winget', [
      'install',
      '-e',
      '--id',
      'Python.Python.3.12',
      '--accept-package-agreements',
      '--accept-source-agreements',
    ], true);
    return canResolvePythonAfterInstaller();
  }

  if (await canRunCommand('powershell.exe', [
    '-NoProfile',
    '-Command',
    'if (Get-Command winget -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }',
  ])) {
    progress?.report({ message: 'Installing Python 3.12 with winget...' });
    output.appendLine('Using winget through PowerShell to install Python 3.12.');
    await runCommand('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements',
    ], true);
    return canResolvePythonAfterInstaller();
  }

  const choice = await vscode.window.showWarningMessage(
    'Python 3 was not found and winget is unavailable. Zebra can open the Python download page.',
    'Open Python Downloads',
    'Cancel',
  );

  if (choice === 'Open Python Downloads') {
    await vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/windows/'));
  }

  return false;
}

async function canResolvePythonAfterInstaller(): Promise<boolean> {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const found = await findPythonCommand();
    if (found) {
      output.appendLine(`Python detected after installer: ${found.display}`);
      return true;
    }

    output.appendLine(`Python not visible yet after installer; retry ${attempt}/6...`);
    await sleep(1000);
  }

  output.appendLine('Python installer finished, but Python was not found in known locations.');
  return false;
}

async function installPython3OnLinux(
  progress?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<boolean> {
  const apt = await firstRunnableCommand(['apt-get', '/usr/bin/apt-get'], ['--version']);
  if (apt) {
    const terminal = vscode.window.createTerminal('Zebra Python Install');
    terminal.show();
    terminal.sendText('sudo apt-get update && sudo apt-get install -y python3 python3-venv python3-pip', true);
    progress?.report({ message: 'Opened a terminal for apt install. Re-run Setup Toolchain when it finishes.' });
    output.appendLine('Opened terminal for Linux Python install. Re-run Setup Toolchain after apt finishes.');
    return false;
  }

  const dnf = await firstRunnableCommand(['dnf', '/usr/bin/dnf'], ['--version']);
  if (dnf) {
    const terminal = vscode.window.createTerminal('Zebra Python Install');
    terminal.show();
    terminal.sendText('sudo dnf install -y python3 python3-pip', true);
    progress?.report({ message: 'Opened a terminal for dnf install. Re-run Setup Toolchain when it finishes.' });
    output.appendLine('Opened terminal for Linux Python install with dnf. Re-run Setup Toolchain after dnf finishes.');
    return false;
  }

  const pacman = await firstRunnableCommand(['pacman', '/usr/bin/pacman'], ['--version']);
  if (pacman) {
    const terminal = vscode.window.createTerminal('Zebra Python Install');
    terminal.show();
    terminal.sendText('sudo pacman -Sy --needed python python-pip', true);
    progress?.report({ message: 'Opened a terminal for pacman install. Re-run Setup Toolchain when it finishes.' });
    output.appendLine('Opened terminal for Linux Python install with pacman. Re-run Setup Toolchain after pacman finishes.');
    return false;
  }

  const choice = await vscode.window.showWarningMessage(
    'Python 3 was not found. Install python3, python3-venv, and python3-pip with your distro package manager, then run Setup Toolchain again.',
    'Open Python Downloads',
    'Cancel',
  );

  if (choice === 'Open Python Downloads') {
    await vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/'));
  }

  return false;
}

async function resolveBrewCommand(): Promise<string | undefined> {
  return firstRunnableCommand(['/opt/homebrew/bin/brew', '/usr/local/bin/brew', 'brew'], ['--version']);
}

async function firstRunnableCommand(commands: string[], args: string[]): Promise<string | undefined> {
  for (const command of commands) {
    if (await canRunCommand(command, args)) {
      return command;
    }
  }
  return undefined;
}

function getPythonInstallInstructions(): string {
  if (process.platform === 'darwin') {
    return 'Python 3 could not be installed automatically. Install Homebrew from https://brew.sh/ and run: brew install python. Then restart VS Code and run Zebra: Setup Toolchain again.';
  }

  if (process.platform === 'win32') {
    return 'Python 3 could not be installed automatically. Install Python from python.org or with winget, then restart VS Code and run Zebra: Setup Toolchain again.';
  }

  return 'Python 3 could not be installed automatically. Install python3, python3-venv, and python3-pip with your distro package manager, then run Zebra: Setup Toolchain again.';
}

function getPythonCandidates(): PythonCommand[] {
  if (process.platform === 'win32') {
    return dedupePythonCandidates([
      { command: 'py', argsPrefix: ['-3'], display: 'py -3' },
      { command: path.join(process.env.SystemRoot || 'C:\\Windows', 'py.exe'), argsPrefix: ['-3'], display: 'py -3' },
      { command: 'python', argsPrefix: [], display: 'python' },
      { command: 'python3', argsPrefix: [], display: 'python3' },
      ...getWindowsInstalledPythonCandidates(),
    ]);
  }

  if (process.platform === 'darwin') {
    return [
      { command: 'python3', argsPrefix: [], display: 'python3' },
      { command: '/opt/homebrew/bin/python3', argsPrefix: [], display: '/opt/homebrew/bin/python3' },
      { command: '/usr/local/bin/python3', argsPrefix: [], display: '/usr/local/bin/python3' },
      { command: '/usr/bin/python3', argsPrefix: [], display: '/usr/bin/python3' },
      { command: 'python', argsPrefix: [], display: 'python' },
    ];
  }

  return [
    { command: 'python3', argsPrefix: [], display: 'python3' },
    { command: '/usr/bin/python3', argsPrefix: [], display: '/usr/bin/python3' },
    { command: '/usr/local/bin/python3', argsPrefix: [], display: '/usr/local/bin/python3' },
    { command: 'python', argsPrefix: [], display: 'python' },
  ];
}

function getWindowsInstalledPythonCandidates(): PythonCommand[] {
  const roots = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python') : '',
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Python') : '',
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Python') : '',
  ].filter(Boolean);

  const candidates: PythonCommand[] = [];

  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }

    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.toLowerCase().startsWith('python')) {
          continue;
        }

        const python = path.join(root, entry.name, 'python.exe');
        candidates.push({ command: python, argsPrefix: [], display: python });
      }
    } catch {
      // Ignore inaccessible install roots and keep probing the remaining candidates.
    }
  }

  candidates.sort((a, b) => b.command.localeCompare(a.command));
  return candidates;
}

function dedupePythonCandidates(candidates: PythonCommand[]): PythonCommand[] {
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = `${candidate.command}\0${candidate.argsPrefix.join('\0')}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function canRunCommand(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (ok: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };

    const child = cp.spawn(command, args, {
      shell: false,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      env: getProcessEnvForTools(),
      windowsHide: true,
    });

    child.on('error', () => finish(false));
    child.on('close', (code: number | null) => finish(code === 0));
  });
}

function getProcessEnvForTools(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (process.platform !== 'win32') {
    const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
    const currentPath = env.PATH || '';
    env.PATH = [...extraPaths, currentPath].filter(Boolean).join(path.delimiter);
  }

  return env;
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

function getFirmwareCacheDir(): string {
  return path.join(extensionContext.globalStorageUri.fsPath, 'firmware');
}

function getNativeBuildRoot(): string {
  return getWorkspaceConfig<string>('nativeBuildRoot', DEFAULT_NATIVE_BUILD_ROOT) || DEFAULT_NATIVE_BUILD_ROOT;
}

function getWslFlasherUsername(): string {
  const username = (getWorkspaceConfig<string>('wslFlasherUsername', DEFAULT_WSL_FLASHER_USERNAME) || DEFAULT_WSL_FLASHER_USERNAME).trim();
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(username)) {
    throw new Error('zebra.wslFlasherUsername must be a valid Linux username: lowercase letters, numbers, underscore, or dash; it must start with a letter or underscore.');
  }
  return username;
}

function getWslFlasherPassword(): string {
  const password = getWorkspaceConfig<string>('wslFlasherPassword', DEFAULT_WSL_FLASHER_PASSWORD) || DEFAULT_WSL_FLASHER_PASSWORD;
  if (!password || /[\r\n]/.test(password)) {
    throw new Error('zebra.wslFlasherPassword must be non-empty and cannot contain line breaks.');
  }
  return password;
}

function getNativeToolchainSummary(): string {
  const root = getNativeBuildRoot();
  if (process.platform === 'win32') {
    return `Optional WSL build root ${root}; user ${getWslFlasherUsername()}`;
  }
  return `Optional build root ${root}`;
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

function quotePowerShellArg(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteShellLiteral(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function ensureWindowsWslDebian(): Promise<string | undefined> {
  if (!await canRunCommand('wsl.exe', ['--status'])) {
    const choice = await vscode.window.showWarningMessage(
      'Native C firmware builds need WSL Debian. Zebra can open a terminal to install WSL with Debian. A reboot may be required.',
      'Install WSL Debian',
      'Open WSL Docs',
      'Cancel',
    );

    if (choice === 'Install WSL Debian') {
      openWindowsWslInstallTerminal(false);
    } else if (choice === 'Open WSL Docs') {
      await vscode.env.openExternal(vscode.Uri.parse('https://learn.microsoft.com/windows/wsl/install'));
    }
    return undefined;
  }

  const distros = await listWslDistros();
  const debian = distros.find(name => /^debian$/i.test(name)) || distros.find(name => /debian/i.test(name));
  if (debian) {
    return debian;
  }

  const choice = await vscode.window.showWarningMessage(
    'WSL is installed, but Debian is not. Zebra native firmware builds use Debian by default.',
    'Install Debian',
    'Use Other Distro',
    'Cancel',
  );

  if (choice === 'Install Debian') {
    openWindowsWslInstallTerminal(true);
    return undefined;
  }

  if (choice === 'Use Other Distro') {
    return pickWslDistroFromList(distros);
  }

  return undefined;
}

function openWindowsWslInstallTerminal(wslAlreadyInstalled: boolean): void {
  const username = getWslFlasherUsername();
  const password = getWslFlasherPassword();
  const terminal = vscode.window.createTerminal('Zebra WSL Debian Install');
  terminal.show();
  const script = windowsWslInstallPowerShellScript('Debian', username, password);
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const command = `powershell.exe -NoExit -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
  terminal.sendText(command, true);
  output.appendLine(`Opened terminal for WSL Debian install${wslAlreadyInstalled ? '' : ' and WSL bootstrap'}; default Linux user will be ${username}.`);
  void vscode.window.showInformationMessage(`WSL Debian install started. Zebra will create the ${username} Linux user when Debian is ready; reboot first if Windows asks.`);
}

function windowsWslInstallPowerShellScript(distro: string, username: string, password: string): string {
  const provisioningScript = wslFlasherUserProvisioningScript(username, password);
  return [
    '$ErrorActionPreference = "Stop"',
    `$distro = ${quotePowerShellArg(distro)}`,
    'Write-Host "Installing WSL Debian for Zebra..."',
    'wsl.exe --install -d $distro --no-launch',
    'if ($LASTEXITCODE -ne 0) {',
    '  Write-Host "If Windows requested a reboot, reboot and run Zebra: Setup Native C Firmware Toolchain again."',
    '  exit $LASTEXITCODE',
    '}',
    '$provision = @\'',
    provisioningScript,
    '\'@',
    'Write-Host "Creating Zebra WSL flasher user..."',
    '$provision | wsl.exe -d $distro -u root -- bash -s',
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    'wsl.exe --terminate $distro | Out-Null',
    'Write-Host "Zebra WSL Debian is ready. Run Zebra: Setup Native C Firmware Toolchain again to install firmware build dependencies."',
  ].join('\n');
}

async function ensureWindowsWslFlasherUser(distro: string): Promise<void> {
  const username = getWslFlasherUsername();
  const password = getWslFlasherPassword();
  output.appendLine(`Ensuring WSL distro ${distro} has Zebra flasher user ${username}.`);
  await runCommandWithInput(
    'wsl.exe',
    ['-d', distro, '-u', 'root', '--', 'bash', '-s'],
    wslFlasherUserProvisioningScript(username, password),
    `wsl.exe -d ${distro} -u root -- bash -s < Zebra flasher user setup`,
  );
  await runCommand('wsl.exe', ['--terminate', distro], true);
}

function wslFlasherUserProvisioningScript(username: string, password: string): string {
  return [
    'set -e',
    `ZEBRA_USER=${quoteShellLiteral(username)}`,
    `ZEBRA_PASSWORD=${quoteShellLiteral(password)}`,
    'if command -v apt-get >/dev/null 2>&1 && ! command -v sudo >/dev/null 2>&1; then',
    '  apt-get update',
    '  apt-get install -y sudo',
    'fi',
    'if ! id -u "$ZEBRA_USER" >/dev/null 2>&1; then',
    '  useradd -m -s /bin/bash "$ZEBRA_USER"',
    'fi',
    'printf "%s:%s\\n" "$ZEBRA_USER" "$ZEBRA_PASSWORD" | chpasswd',
    'if getent group sudo >/dev/null 2>&1; then',
    '  usermod -aG sudo "$ZEBRA_USER"',
    'elif getent group wheel >/dev/null 2>&1; then',
    '  usermod -aG wheel "$ZEBRA_USER"',
    'fi',
    'mkdir -p /etc',
    'printf "[user]\\ndefault=%s\\n" "$ZEBRA_USER" > /etc/wsl.conf',
    'mkdir -p "/home/$ZEBRA_USER"',
    'chown -R "$ZEBRA_USER:$ZEBRA_USER" "/home/$ZEBRA_USER"',
    'echo "Zebra WSL flasher user is ready: $ZEBRA_USER"',
  ].join('\n');
}

async function listWslDistros(): Promise<string[]> {
  const raw = await runCommand('wsl.exe', ['-l', '-q'], true);
  return raw
    .split(/\r?\n/)
    .map(line => line.replace(/\0/g, '').trim())
    .filter(Boolean)
    .filter(line => !/windows subsystem for linux/i.test(line));
}

async function pickWslDistro(): Promise<string | undefined> {
  const distros = await listWslDistros();
  return pickWslDistroFromList(distros);
}

async function pickWslDistroFromList(distros: string[]): Promise<string | undefined> {
  const preferred = distros.find(name => /debian/i.test(name)) || distros.find(name => /ubuntu/i.test(name));
  if (preferred && distros.length === 1) {
    return preferred;
  }

  const choice = await vscode.window.showQuickPick(distros.length ? distros : ['Debian', 'Ubuntu'], {
    title: 'Select WSL distro for native C firmware setup',
    placeHolder: preferred ? `Recommended: ${preferred}` : 'Choose the Linux distro where ESP-IDF should be installed',
  });
  return choice || preferred;
}

function nativeLinuxSetupScript(buildRootSetting: string): string {
  const buildRoot = buildRootSetting.trim() || DEFAULT_NATIVE_BUILD_ROOT;
  return [
    'set -e',
    `ZBOT_FW_ROOT="${buildRoot.replace(/"/g, '\\"')}"`,
    'case "$ZBOT_FW_ROOT" in "~"|"~/"*) ZBOT_FW_ROOT="$HOME${ZBOT_FW_ROOT#~}" ;; esac',
    'echo "Zebra native C firmware setup root: $ZBOT_FW_ROOT"',
    'if command -v brew >/dev/null 2>&1; then',
    '  brew update',
    '  brew install git cmake ninja ccache pkg-config libffi openssl dfu-util libusb python',
    'elif command -v apt-get >/dev/null 2>&1; then',
    '  sudo apt-get update',
    '  sudo apt-get install -y git make cmake ninja-build ccache gcc g++ pkg-config libffi-dev libssl-dev dfu-util libusb-1.0-0 python3 python3-venv python3-pip',
    'elif command -v dnf >/dev/null 2>&1; then',
    '  sudo dnf install -y git make cmake ninja-build ccache gcc gcc-c++ pkgconf-pkg-config libffi-devel openssl-devel dfu-util libusb1 python3 python3-pip python3-virtualenv',
    'elif command -v pacman >/dev/null 2>&1; then',
    '  sudo pacman -Sy --needed git make cmake ninja ccache gcc pkgconf libffi openssl dfu-util libusb python python-pip',
    'else',
    '  echo "Unsupported package manager. Install git, make, cmake, ninja, ccache, gcc/g++, pkg-config, libffi, openssl, dfu-util, libusb, python3, python3-venv, and python3-pip, then run this command again."',
    '  exit 1',
    'fi',
    'mkdir -p "$ZBOT_FW_ROOT"',
    `if [ ! -d "$ZBOT_FW_ROOT/micropython/.git" ]; then git clone --depth 1 --branch ${MICROPYTHON_TAG} https://github.com/micropython/micropython.git "$ZBOT_FW_ROOT/micropython"; fi`,
    `if [ ! -d "$ZBOT_FW_ROOT/esp-idf/.git" ]; then git clone --depth 1 --branch ${ESP_IDF_TAG} --recursive https://github.com/espressif/esp-idf.git "$ZBOT_FW_ROOT/esp-idf"; fi`,
    'git -C "$ZBOT_FW_ROOT/esp-idf" submodule update --init --recursive',
    'export IDF_TOOLS_PATH="$ZBOT_FW_ROOT/idf_tools"',
    '"$ZBOT_FW_ROOT/esp-idf/install.sh" esp32',
    '. "$ZBOT_FW_ROOT/esp-idf/export.sh"',
    'make -C "$ZBOT_FW_ROOT/micropython/mpy-cross"',
    'make -C "$ZBOT_FW_ROOT/micropython/ports/esp32" BOARD=ESP32_GENERIC submodules',
    'echo "Native C firmware dependencies are ready."',
    'echo "Build with: make -C $ZBOT_FW_ROOT/micropython/ports/esp32 BOARD=ESP32_GENERIC BUILD=build-ZBOT USER_C_MODULES=/mnt/c/path/to/zbotDriver/micropython/cmodules/micropython.cmake"',
  ].join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runCommand(command: string, args: string[], ignoreFailure = false): Promise<string> {
  return new Promise((resolve, reject) => {
    output.appendLine(`>> ${command} ${args.join(' ')}`);

    const child = cp.spawn(command, args, {
      shell: false,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      env: getProcessEnvForTools(),
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

function runCommandWithInput(command: string, args: string[], input: string, logLine: string, ignoreFailure = false): Promise<string> {
  return new Promise((resolve, reject) => {
    output.appendLine(`>> ${logLine}`);

    const child = cp.spawn(command, args, {
      shell: false,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      env: getProcessEnvForTools(),
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
        reject(new Error(`Command failed with code ${code}: ${logLine}\n${stderr}`));
        return;
      }
      resolve(stdout.trim());
    });

    child.stdin.end(input);
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
        commandItem('Welcome', 'zebra.welcome', 'home'),
        commandItem('Project Setup', 'zebra.projectSetup', 'gear'),
      ]);
    }

    const status = inspectProject(root);
    const items: ZebraTreeItem[] = [
      new ZebraTreeItem(status.valid ? 'Project Ready' : 'Project Needs Setup', path.basename(root), vscode.TreeItemCollapsibleState.None, status.valid ? 'pass' : 'warning'),
      commandItem('Project Setup', 'zebra.projectSetup', 'gear'),
      commandItem('Welcome', 'zebra.welcome', 'home'),
      commandItem('Initialize Project', 'zebra.initializeProject', 'new-folder'),
      commandItem('Setup Toolchain', 'zebra.setupToolchain', 'tools'),
      commandItem('Detect Serial Port', 'zebra.detectSerialPort', 'plug'),
      commandItem('Deploy Project / User Program', 'zebra.deployProject', 'cloud-upload'),
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
