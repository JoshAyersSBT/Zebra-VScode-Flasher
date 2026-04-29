import * as vscode from 'vscode';

export interface ProjectSetupState {
  workspaceRoot: string | null;
  project: {
    valid: boolean;
    hasMain: boolean;
    hasUserMain: boolean;
    hasRobotDir: boolean;
    hasZebraJson: boolean;
    problems: string[];
  } | null;
  toolchain: {
    installed: boolean;
    pythonPath: string;
  };
  serial: {
    checked: boolean;
    summary: string;
    ports: Array<{
      device: string;
      description: string;
      manufacturer: string;
      score: number;
    }>;
  };
}

export type ProjectSetupAction =
  | 'refresh'
  | 'setupToolchain'
  | 'initializeProject'
  | 'installRobotDrivers'
  | 'refreshRobotDriverCache'
  | 'detectSerialPort'
  | 'openDriverHelp'
  | 'deployProject';

export class ProjectSetupPanel {
  private static currentPanel: ProjectSetupPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly getState: () => Promise<ProjectSetupState>;
  private readonly runAction: (action: ProjectSetupAction) => Promise<void>;
  private disposables: vscode.Disposable[] = [];

  public static async show(
    extensionUri: vscode.Uri,
    getState: () => Promise<ProjectSetupState>,
    runAction: (action: ProjectSetupAction) => Promise<void>,
  ): Promise<void> {
    const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

    if (ProjectSetupPanel.currentPanel) {
      ProjectSetupPanel.currentPanel.panel.reveal(column);
      await ProjectSetupPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'zebraProjectSetup',
      'Zebra Project Setup',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    ProjectSetupPanel.currentPanel = new ProjectSetupPanel(panel, extensionUri, getState, runAction);
    await ProjectSetupPanel.currentPanel.refresh();
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    getState: () => Promise<ProjectSetupState>,
    runAction: (action: ProjectSetupAction) => Promise<void>,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.getState = getState;
    this.runAction = runAction;

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(
      async message => {
        const action = message?.action as ProjectSetupAction | undefined;
        if (!action) return;

        if (action === 'refresh') {
          await this.refresh();
          return;
        }

        await this.postBusy(true, `Running ${labelForAction(action)}...`);
        try {
          await this.runAction(action);
          await this.refresh();
        } catch (err: any) {
          await this.postBusy(false, err?.message || String(err), true);
          throw err;
        }
      },
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private async refresh(): Promise<void> {
    const state = await this.getState();
    await this.panel.webview.postMessage({ type: 'state', state });
    await this.postBusy(false, 'Ready.');
  }

  private async postBusy(busy: boolean, message: string, isError = false): Promise<void> {
    await this.panel.webview.postMessage({ type: 'busy', busy, message, isError });
  }

  private dispose(): void {
    ProjectSetupPanel.currentPanel = undefined;
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) disposable.dispose();
    }
  }

  private getHtml(): string {
    const nonce = getNonce();
    const cspSource = this.panel.webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Zebra Project Setup</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border);
      --button: var(--vscode-button-background);
      --button-fg: var(--vscode-button-foreground);
      --button-hover: var(--vscode-button-hoverBackground);
      --card: var(--vscode-sideBar-background);
      --ok: #3fb950;
      --bad: #f85149;
      --warn: #d29922;
    }
    body { margin: 0; padding: 20px; color: var(--fg); background: var(--bg); font-family: var(--vscode-font-family); }
    .wrap { max-width: 980px; margin: 0 auto; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    .sub { color: var(--muted); margin-bottom: 18px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px; }
    .card h2 { margin: 0 0 10px; font-size: 16px; }
    .status { display: inline-flex; align-items: center; gap: 7px; padding: 4px 8px; border-radius: 999px; border: 1px solid var(--border); font-size: 12px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); display: inline-block; }
    .ok .dot { background: var(--ok); }
    .bad .dot { background: var(--bad); }
    .warn .dot { background: var(--warn); }
    .rows { margin-top: 12px; display: grid; gap: 7px; }
    .row { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid color-mix(in srgb, var(--border), transparent 45%); padding-bottom: 6px; }
    .row span:first-child { color: var(--muted); }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    button { background: var(--button); color: var(--button-fg); border: none; border-radius: 6px; padding: 8px 10px; cursor: pointer; font: inherit; }
    button:hover { background: var(--button-hover); }
    button.secondary { background: transparent; border: 1px solid var(--border); color: var(--fg); }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .problems { margin: 10px 0 0; padding-left: 18px; color: var(--bad); }
    .banner { margin: 0 0 16px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; color: var(--muted); }
    .banner.error { color: var(--bad); border-color: var(--bad); }
    .ports { max-height: 170px; overflow: auto; margin-top: 10px; border-top: 1px solid var(--border); padding-top: 8px; }
    .port { font-size: 12px; color: var(--muted); margin-bottom: 7px; }
    code { color: var(--vscode-textPreformat-foreground); }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Zebra Project Setup</h1>
    <div class="sub">Initialize, validate, and manage the MicroPython ZebraBot project from one place.</div>
    <div id="banner" class="banner">Loading project status...</div>
    <div class="grid">
      <section class="card">
        <h2>Project</h2>
        <div id="projectBadge" class="status warn"><span class="dot"></span><span>Checking</span></div>
        <div class="rows" id="projectRows"></div>
        <ul class="problems" id="problems"></ul>
        <div class="actions">
          <button data-action="initializeProject">Initialize Project</button>
          <button class="secondary" data-action="installRobotDrivers">Install Robot Drivers</button>
        </div>
      </section>

      <section class="card">
        <h2>Toolchain</h2>
        <div id="toolBadge" class="status warn"><span class="dot"></span><span>Checking</span></div>
        <div class="rows" id="toolRows"></div>
        <div class="actions">
          <button data-action="setupToolchain">Setup Toolchain</button>
          <button class="secondary" data-action="openDriverHelp">USB Driver Help</button>
        </div>
      </section>

      <section class="card">
        <h2>Serial Device</h2>
        <div id="serialBadge" class="status warn"><span class="dot"></span><span>Not checked</span></div>
        <div class="rows" id="serialRows"></div>
        <div class="ports" id="ports"></div>
        <div class="actions">
          <button data-action="detectSerialPort">Detect Serial Port</button>
          <button class="secondary" data-action="refresh">Refresh</button>
        </div>
      </section>
    </div>

    <section class="card" style="margin-top:14px;">
      <h2>Commands</h2>
      <div class="actions">
        <button data-action="deployProject">Deploy Project</button>
        <button class="secondary" data-action="refreshRobotDriverCache">Refresh Driver Cache</button>
        <button class="secondary" data-action="refresh">Refresh Status</button>
      </div>
    </section>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const banner = document.getElementById('banner');
    let busy = false;

    document.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (busy) return;
        vscode.postMessage({ action: btn.dataset.action });
      });
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'busy') {
        busy = !!msg.busy;
        banner.textContent = msg.message || '';
        banner.classList.toggle('error', !!msg.isError);
        document.querySelectorAll('button').forEach(b => b.disabled = busy);
      }
      if (msg.type === 'state') render(msg.state);
    });

    function render(state) {
      const project = state.project;
      const root = state.workspaceRoot || 'No workspace open';
      setBadge('projectBadge', project && project.valid ? 'ok' : 'bad', project ? (project.valid ? 'Ready' : 'Needs setup') : 'No workspace');
      rows('projectRows', [
        ['Workspace', root],
        ['main.py', project?.hasMain ? 'Found' : 'Missing'],
        ['user_main.py', project?.hasUserMain ? 'Found' : 'Missing'],
        ['robot/', project?.hasRobotDir ? 'Found' : 'Missing'],
        ['zebra.json', project?.hasZebraJson ? 'Found' : 'Missing'],
      ]);
      const problems = document.getElementById('problems');
      problems.innerHTML = '';
      (project?.problems || []).forEach(p => {
        const li = document.createElement('li');
        li.textContent = p;
        problems.appendChild(li);
      });

      setBadge('toolBadge', state.toolchain.installed ? 'ok' : 'bad', state.toolchain.installed ? 'Installed' : 'Missing');
      rows('toolRows', [
        ['Python', state.toolchain.installed ? state.toolchain.pythonPath : 'Not installed'],
        ['Packages', state.toolchain.installed ? 'pyserial, mpremote, esptool' : 'Run setup'],
      ]);

      const serialKind = state.serial.ports.length ? 'ok' : (state.serial.checked ? 'bad' : 'warn');
      setBadge('serialBadge', serialKind, state.serial.summary);
      rows('serialRows', [['Summary', state.serial.summary]]);
      const ports = document.getElementById('ports');
      ports.innerHTML = '';
      state.serial.ports.forEach(p => {
        const div = document.createElement('div');
        div.className = 'port';
        div.textContent = p.device + ' — ' + (p.description || p.manufacturer || 'serial device') + ' — score=' + p.score;
        ports.appendChild(div);
      });
    }

    function setBadge(id, kind, text) {
      const el = document.getElementById(id);
      el.className = 'status ' + kind;
      el.querySelector('span:last-child').textContent = text;
    }

    function rows(id, values) {
      const el = document.getElementById(id);
      el.innerHTML = '';
      values.forEach(([k, v]) => {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = '<span></span><strong></strong>';
        row.children[0].textContent = k;
        row.children[1].textContent = v;
        el.appendChild(row);
      });
    }
  </script>
</body>
</html>`;
  }
}

function labelForAction(action: ProjectSetupAction): string {
  return action.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
