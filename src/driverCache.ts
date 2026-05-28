import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { runCommand } from './process';

const DEFAULT_DRIVER_REPO = 'https://github.com/JoshAyersSBT/ZbotDriver.git';
const DEFAULT_DRIVER_REPO_BRANCH = 'codex/C-Core-modules';

export function getGlobalDriverCacheDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, 'zbot-driver-cache');
}

export function getGlobalDriverCacheRobotDir(context: vscode.ExtensionContext): string {
  return path.join(getGlobalDriverCacheDir(context), 'robot');
}

export function projectRobotDir(projectRoot: string): string {
  return path.join(projectRoot, 'robot');
}

export function robotDirHasDrivers(robotDir: string): boolean {
  if (!fs.existsSync(robotDir)) return false;
  const found = findFiles(robotDir, new Set(['.py', '.mpy']));
  return found.length > 0;
}

export async function refreshDriverCache(context: vscode.ExtensionContext, out: vscode.OutputChannel): Promise<string> {
  const config = vscode.workspace.getConfiguration('zebra');
  const repoUrl = (config.get<string>('driverRepoUrl') || DEFAULT_DRIVER_REPO).trim();
  const branch = (config.get<string>('driverRepoBranch') || DEFAULT_DRIVER_REPO_BRANCH).trim();
  const cacheDir = getGlobalDriverCacheDir(context);
  const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'zbot-driver-repo-'));
  const tmpRepo = path.join(tmpParent, 'repo');

  out.show(true);
  out.appendLine('Refreshing Zebra robot driver cache...');
  out.appendLine(`Repository: ${repoUrl}`);
  out.appendLine(`Cache: ${cacheDir}`);

  const cloneArgs = ['clone', '--depth', '1'];
  if (branch) cloneArgs.push('--branch', branch);
  cloneArgs.push(repoUrl, tmpRepo);

  try {
    await runCommand('git', cloneArgs, out);
    const robotSrc = findRobotSourceDir(tmpRepo);
    if (!robotSrc) {
      throw new Error(`No robot/ driver directory found in repository: ${repoUrl}`);
    }

    clearDriverCacheDirs(context, out);
    fs.mkdirSync(cacheDir, { recursive: true });
    copyDirectory(robotSrc, path.join(cacheDir, 'robot'), shouldCopyRuntimeFile);

    const mainSrc = path.join(tmpRepo, 'main.py');
    if (fs.existsSync(mainSrc)) {
      fs.copyFileSync(mainSrc, path.join(cacheDir, 'main.py'));
    }

    out.appendLine('Driver cache refresh complete.');
    return cacheDir;
  } finally {
    fs.rmSync(tmpParent, { recursive: true, force: true });
  }
}

function clearDriverCacheDirs(context: vscode.ExtensionContext, out: vscode.OutputChannel): void {
  for (const cacheDir of [getGlobalDriverCacheDir(context), getLegacyDriverCacheDir(context)]) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    out.appendLine(`Cleared driver cache: ${cacheDir}`);
  }
}

function getLegacyDriverCacheDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, 'driver-cache');
}

export async function ensureRobotDriversForProject(
  context: vscode.ExtensionContext,
  projectRoot: string,
  out: vscode.OutputChannel,
  options: { force?: boolean } = {}
): Promise<void> {
  const robotDst = projectRobotDir(projectRoot);
  if (robotDirHasDrivers(robotDst) && !options.force) {
    out.appendLine(`Project robot/ already has drivers: ${robotDst}`);
    return;
  }

  const sourceRobot = await resolveRobotDriverSource(context, out);
  fs.mkdirSync(robotDst, { recursive: true });
  copyDirectory(sourceRobot, robotDst, shouldCopyRuntimeFile);

  const initPy = path.join(robotDst, '__init__.py');
  if (!fs.existsSync(initPy)) {
    fs.writeFileSync(initPy, '# ZebraBot robot driver package\n', 'utf8');
  }

  out.appendLine(`Robot drivers copied into project: ${robotDst}`);
}

export async function resolveRobotDriverSource(context: vscode.ExtensionContext, out: vscode.OutputChannel): Promise<string> {
  const config = vscode.workspace.getConfiguration('zebra');
  const configured = (config.get<string>('driverCachePath') || '').trim();

  if (configured) {
    const expanded = expandHome(configured);
    const robot = findRobotSourceDir(expanded);
    if (robot && robotDirHasDrivers(robot)) {
      out.appendLine(`Using configured local driver cache: ${robot}`);
      return robot;
    }
    throw new Error(`zebra.driverCachePath does not contain a usable robot/ directory: ${configured}`);
  }

  const globalRobot = getGlobalDriverCacheRobotDir(context);
  if (robotDirHasDrivers(globalRobot)) {
    out.appendLine(`Using global Zebra driver cache: ${globalRobot}`);
    return globalRobot;
  }

  try {
    await refreshDriverCache(context, out);
    if (robotDirHasDrivers(globalRobot)) {
      return globalRobot;
    }
  } catch (err) {
    out.appendLine(`Driver repo fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const bundledRobot = path.join(context.extensionPath, 'resources', 'runtime', 'robot');
  if (robotDirHasDrivers(bundledRobot)) {
    out.appendLine(`Using bundled fallback drivers: ${bundledRobot}`);
    return bundledRobot;
  }

  throw new Error('Could not locate Zebra robot drivers. Set zebra.driverCachePath or check zebra.driverRepoUrl.');
}

function findRobotSourceDir(root: string): string | undefined {
  const direct = path.join(root, 'robot');
  if (robotDirHasDrivers(direct)) return direct;

  const runtimeRobot = path.join(root, 'resources', 'runtime', 'robot');
  if (robotDirHasDrivers(runtimeRobot)) return runtimeRobot;

  return undefined;
}

function shouldCopyRuntimeFile(src: string): boolean {
  const name = path.basename(src).toLowerCase();
  const ext = path.extname(src).toLowerCase();
  if (name.startsWith('.')) return false;
  if (name === 'teleop.py' || name.startsWith('teleop_')) return false;
  return ext === '.py' || ext === '.mpy' || ext === '.json' || ext === '.txt' || ext === '.cfg' || ext === '.ini';
}

function copyDirectory(src: string, dst: string, predicate: (src: string) => boolean): void {
  const skipDirs = new Set(['__pycache__', '.git', '.vscode', '.idea', '.venv', 'venv', 'dist', 'build', 'node_modules']);
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skipDirs.has(entry.name) || entry.name.startsWith('.')) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(from, to, predicate);
    } else if (predicate(from)) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}

function findFiles(root: string, extensions: Set<string>): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...findFiles(full, extensions));
    else if (extensions.has(path.extname(full).toLowerCase())) out.push(full);
  }
  return out;
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}
