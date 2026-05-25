const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

const repoRoot = path.resolve(__dirname, '..');
const workspace = path.join(repoRoot, '.vscode-test-workspace');
const testPort = process.env.ZEBRA_TEST_PORT || 'COM7';

function writeFile(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, 'utf8');
}

function findVSCodeExecutable() {
  if (process.env.VSCODE_TEST_EXECUTABLE) {
    return process.env.VSCODE_TEST_EXECUTABLE;
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    const candidates = [
      localAppData && path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      localAppData && path.join(localAppData, 'Programs', 'VSCodium', 'VSCodium.exe'),
      'C:\\Program Files\\Microsoft VS Code\\Code.exe',
      'C:\\Program Files\\VSCodium\\VSCodium.exe',
    ].filter(Boolean);

    return candidates.find(candidate => fs.existsSync(candidate));
  }

  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
      '/Applications/VSCodium.app/Contents/MacOS/Electron',
    ];
    return candidates.find(candidate => fs.existsSync(candidate));
  }

  if (process.platform === 'linux') {
    const candidates = [
      '/usr/share/code/code',
      '/usr/share/codium/codium',
      '/snap/code/current/usr/share/code/code',
      '/snap/codium/current/usr/share/codium/codium',
    ];
    return candidates.find(candidate => fs.existsSync(candidate));
  }

  return undefined;
}

async function main() {
  fs.mkdirSync(workspace, { recursive: true });
  const resultPath = path.join(workspace, 'extension-smoke-result.json');
  fs.rmSync(resultPath, { force: true });

  writeFile(
    path.join(workspace, 'zebra.json'),
    JSON.stringify(
      {
        name: 'extension-smoke',
        board: 'esp32',
        port: testPort,
        runtimePath: '',
        uploadProtocol: 'mpremote',
      },
      null,
      2,
    ),
  );
  writeFile(
    path.join(workspace, 'main.py'),
    'import uasyncio as asyncio\n\nasync def main(zbot):\n    while True:\n        await asyncio.sleep_ms(100)\n',
  );

  await runTests({
    vscodeExecutablePath: findVSCodeExecutable(),
    extensionDevelopmentPath: repoRoot,
    extensionTestsPath: path.join(repoRoot, 'test', 'vscode-extension-smoke.js'),
    launchArgs: [
      workspace,
      '--disable-extensions',
      '--user-data-dir',
      path.join(repoRoot, '.vscode-test-user-data'),
      '--extensions-dir',
      path.join(repoRoot, '.vscode-test-extensions'),
    ],
    extensionTestsEnv: {
      ZEBRA_TEST_PORT: testPort,
      ZEBRA_TEST_RESET_DEVICE: process.env.ZEBRA_TEST_RESET_DEVICE || '1',
      TMPDIR: os.tmpdir(),
      TEMP: os.tmpdir(),
      TMP: os.tmpdir(),
    },
  });

  if (!fs.existsSync(resultPath)) {
    throw new Error(`VS Code smoke test did not write ${resultPath}`);
  }

  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  if (result.configuredPort !== testPort) {
    throw new Error(`VS Code smoke test used ${result.configuredPort}, expected ${testPort}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
