const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
  const testPort = process.env.ZEBRA_TEST_PORT || 'COM7';
  const extension = vscode.extensions.getExtension('zebra-robotics.zebra-vscode-flasher');
  assert.ok(extension, 'Expected Zebra extension to be loaded');
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  const expected = [
    'zebra.refreshExplorer',
    'zebra.projectSetup',
    'zebra.projectStatus',
    'zebra.initProject',
    'zebra.initializeProject',
    'zebra.checkProject',
    'zebra.setupToolchain',
    'zebra.installPython',
    'zebra.refreshDriverCache',
    'zebra.refreshRobotDriverCache',
    'zebra.installRobotDrivers',
    'zebra.detectSerialPort',
    'zebra.deployProject',
    'zebra.flashFirmware',
    'zebra.resetDevice',
    'zebra.openSerialMonitor',
    'zebra.openDriverHelp',
  ];

  for (const command of expected) {
    assert.ok(commands.includes(command), `Missing command: ${command}`);
  }

  await vscode.workspace.getConfiguration('zebra').update('port', testPort, vscode.ConfigurationTarget.Workspace);
  assert.equal(vscode.workspace.getConfiguration('zebra').get('port'), testPort);

  await vscode.commands.executeCommand('zebra.refreshExplorer');
  await vscode.commands.executeCommand('zebra.setupToolchain');
  await vscode.commands.executeCommand('zebra.checkProject');

  if (process.env.ZEBRA_TEST_RESET_DEVICE === '1') {
    await vscode.commands.executeCommand('zebra.resetDevice');
  }

  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(root, 'Expected a workspace folder');
  assert.ok(fs.existsSync(path.join(root, 'zebra.json')), 'Expected test workspace zebra.json');
  assert.ok(fs.existsSync(path.join(root, 'main.py')), 'Expected test workspace main.py');

  fs.writeFileSync(
    path.join(root, 'extension-smoke-result.json'),
    JSON.stringify(
      {
        ok: true,
        checkedCommands: expected,
        configuredPort: vscode.workspace.getConfiguration('zebra').get('port'),
        ranSetupToolchain: true,
        ranCheckProject: true,
        ranResetDevice: process.env.ZEBRA_TEST_RESET_DEVICE === '1',
      },
      null,
      2,
    ),
  );
}

module.exports = { run };

if (require.main === module) {
  run().then(
    () => process.exit(0),
    err => {
      console.error(err);
      process.exit(1);
    },
  );
}
