import * as vscode from 'vscode';

export interface SensorCalibrationEntry {
  color: string;
  rgb: { r: number; g: number; b: number; clear: number };
  normalized: { r: number; g: number; b: number };
  capturedAt: string;
}

export interface SensorCalibrationData {
  version: number;
  updatedAt: string | null;
  ports: Record<string, SensorCalibrationEntry[]>;
}

export interface SensorCalibrationSample {
  port: number;
  rgb: { r: number; g: number; b: number; clear: number };
  normalized: { r: number; g: number; b: number };
}

export interface SensorCalibrationState {
  workspaceRoot: string | null;
  serialPort: string;
  data: SensorCalibrationData;
}

type StateProvider = () => Promise<SensorCalibrationState>;
type CaptureHandler = (sensorPort: number) => Promise<SensorCalibrationSample>;
type SaveHandler = (data: SensorCalibrationData) => Promise<SensorCalibrationState>;
type UploadHandler = (data: SensorCalibrationData) => Promise<SensorCalibrationState>;

const PALETTE: Array<[string, string]> = [
  ['black', '#111827'], ['gray', '#6b7280'], ['white', '#f8fafc'], ['red', '#dc2626'],
  ['orange', '#f97316'], ['yellow', '#facc15'], ['lime', '#84cc16'], ['green', '#16a34a'],
  ['mint', '#2dd4bf'], ['cyan', '#06b6d4'], ['sky', '#38bdf8'], ['blue', '#2563eb'],
  ['navy', '#1e3a8a'], ['purple', '#7c3aed'], ['magenta', '#c026d3'], ['pink', '#ec4899'],
  ['brown', '#7c2d12'], ['tan', '#d6a15f'], ['cream', '#f5e6c8'], ['maroon', '#7f1d1d'],
  ['coral', '#fb7185'], ['gold', '#d97706'], ['olive', '#64748b'], ['forest', '#166534'],
  ['teal', '#0f766e'], ['aqua', '#22d3ee'], ['indigo', '#4f46e5'], ['violet', '#8b5cf6'],
  ['lavender', '#c4b5fd'], ['rose', '#be123c'], ['silver', '#cbd5e1'], ['charcoal', '#374151'],
];

export class SensorCalibrationPanel {
  private static currentPanel: SensorCalibrationPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly getState: StateProvider;
  private readonly capture: CaptureHandler;
  private readonly save: SaveHandler;
  private readonly upload: UploadHandler;
  private readonly disposables: vscode.Disposable[] = [];

  public static async show(
    getState: StateProvider,
    capture: CaptureHandler,
    save: SaveHandler,
    upload: UploadHandler,
  ): Promise<void> {
    const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

    if (SensorCalibrationPanel.currentPanel) {
      SensorCalibrationPanel.currentPanel.panel.reveal(column);
      await SensorCalibrationPanel.currentPanel.postState();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'zebraSensorCalibration',
      'Zebra Sensor Calibration',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    SensorCalibrationPanel.currentPanel = new SensorCalibrationPanel(panel, getState, capture, save, upload);
    await SensorCalibrationPanel.currentPanel.postState();
  }

  private constructor(
    panel: vscode.WebviewPanel,
    getState: StateProvider,
    capture: CaptureHandler,
    save: SaveHandler,
    upload: UploadHandler,
  ) {
    this.panel = panel;
    this.getState = getState;
    this.capture = capture;
    this.save = save;
    this.upload = upload;

    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage(
      async message => {
        try {
          if (message?.type === 'refresh') {
            await this.panel.webview.postMessage({ type: 'busy', action: 'refresh', message: 'Refreshing workspace and robot status...' });
            await this.postState();
            await this.panel.webview.postMessage({ type: 'idle', action: 'refresh' });
            return;
          }

          if (message?.type === 'capture') {
            const sensorPort = Number(message.sensorPort || 1);
            await this.panel.webview.postMessage({ type: 'busy', action: 'capture', message: `Connecting to robot and reading sensor port ${sensorPort}...` });
            const sample = await this.capture(Number(message.sensorPort || 1));
            await this.panel.webview.postMessage({ type: 'sample', sample });
            await this.panel.webview.postMessage({ type: 'idle', action: 'capture' });
            return;
          }

          if (message?.type === 'save') {
            await this.panel.webview.postMessage({ type: 'busy', action: 'save', message: 'Writing calibration files...' });
            await this.panel.webview.postMessage({ type: 'state', state: await this.save(message.data) });
            await this.panel.webview.postMessage({ type: 'notice', message: 'Calibration dictionary saved.' });
            await this.panel.webview.postMessage({ type: 'idle', action: 'save' });
            return;
          }

          if (message?.type === 'upload') {
            await this.panel.webview.postMessage({ type: 'busy', action: 'upload', message: 'Uploading calibration dictionary with mpremote...' });
            await this.panel.webview.postMessage({ type: 'state', state: await this.upload(message.data) });
            await this.panel.webview.postMessage({ type: 'notice', message: 'Calibration dictionary uploaded to robot.' });
            await this.panel.webview.postMessage({ type: 'idle', action: 'upload' });
          }
        } catch (err: unknown) {
          const text = err instanceof Error ? err.message : String(err);
          await this.panel.webview.postMessage({ type: 'error', message: text });
          await this.panel.webview.postMessage({ type: 'idle' });
        }
      },
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private async postState(): Promise<void> {
    await this.panel.webview.postMessage({ type: 'state', state: await this.getState() });
  }

  private dispose(): void {
    SensorCalibrationPanel.currentPanel = undefined;
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) disposable.dispose();
    }
  }

  private getHtml(): string {
    const nonce = getNonce();
    const cspSource = this.panel.webview.cspSource;
    const paletteJson = JSON.stringify(PALETTE);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Zebra Sensor Calibration</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border);
      --panel: var(--vscode-sideBar-background);
      --input: var(--vscode-input-background);
      --button: var(--vscode-button-background);
      --button-fg: var(--vscode-button-foreground);
      --button-hover: var(--vscode-button-hoverBackground);
      --accent: var(--vscode-focusBorder);
      --danger: #f85149;
      --ok: #3fb950;
    }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--fg); background: var(--bg); font-family: var(--vscode-font-family); }
    .app { min-height: 100vh; display: grid; grid-template-rows: auto minmax(0, 1fr); }
    header { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--border); background: var(--panel); }
    .brand { font-weight: 700; margin-right: 8px; }
    .status { color: var(--muted); overflow-wrap: anywhere; }
    .status.busy { color: var(--fg); }
    main { min-height: 0; display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); }
    aside { padding: 12px; border-right: 1px solid var(--border); background: color-mix(in srgb, var(--panel), var(--bg) 18%); overflow: auto; }
    .content { padding: 12px; overflow: auto; }
    section { margin-bottom: 14px; }
    h2 { margin: 0 0 8px; font-size: 13px; letter-spacing: 0; text-transform: uppercase; color: var(--muted); }
    button, select, input { font: inherit; }
    button { min-height: 30px; border: none; border-radius: 6px; padding: 6px 9px; color: var(--button-fg); background: var(--button); cursor: pointer; }
    button:hover { background: var(--button-hover); }
    button:disabled { opacity: .65; cursor: wait; }
    button.secondary { color: var(--fg); background: transparent; border: 1px solid var(--border); }
    button.active { outline: 1px solid var(--accent); background: color-mix(in srgb, var(--button), transparent 20%); }
    label { color: var(--muted); font-size: 12px; }
    input, select { width: 100%; color: var(--fg); background: var(--input); border: 1px solid var(--border); border-radius: 6px; padding: 6px 7px; }
    .row { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 8px; align-items: center; margin: 8px 0; }
    .actions { display: flex; flex-wrap: wrap; gap: 7px; }
    .hint { color: var(--muted); font-size: 12px; line-height: 1.45; }
    .sample { display: grid; gap: 5px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--input); font-size: 12px; }
    .palette { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 8px; }
    .swatch { min-width: 0; min-height: 48px; display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; gap: 8px; align-items: center; text-align: left; color: var(--fg); background: var(--input); border: 1px solid var(--border); }
    .chip { width: 20px; height: 20px; border-radius: 50%; border: 1px solid rgba(255,255,255,.45); }
    .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge { color: var(--muted); font-size: 11px; }
    .swatch.captured .badge { color: var(--ok); }
    .dictionary { width: 100%; min-height: 220px; padding: 8px; color: var(--fg); background: var(--input); border: 1px solid var(--border); border-radius: 6px; font-family: var(--vscode-editor-font-family); font-size: 12px; line-height: 1.35; white-space: pre; overflow: auto; }
    .log { min-height: 80px; max-height: 180px; overflow: auto; padding: 8px; border: 1px solid var(--border); border-radius: 6px; color: var(--muted); background: var(--input); font-size: 12px; line-height: 1.35; }
    .log-line { white-space: pre-wrap; overflow-wrap: anywhere; margin-bottom: 4px; }
    @media (max-width: 860px) {
      main { grid-template-columns: 1fr; }
      aside { border-right: 0; border-bottom: 1px solid var(--border); }
    }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div class="brand">Sensor Calibration</div>
      <button id="refreshBtn" class="secondary">Refresh</button>
      <button id="saveBtn" class="secondary">Save Dictionary</button>
      <button id="uploadBtn">Upload To Robot</button>
      <span id="status" class="status">Loading...</span>
    </header>
    <main>
      <aside>
        <section>
          <h2>Capture</h2>
          <div class="row"><label for="sensorPort">Sensor port</label><select id="sensorPort"><option value="1">Port 1</option><option value="2">Port 2</option><option value="3">Port 3</option><option value="4">Port 4</option><option value="5">Port 5</option><option value="6">Port 6</option></select></div>
          <div class="row"><label for="colorName">Palette color</label><select id="colorName"></select></div>
          <div id="sample" class="sample"><span>No real sensor sample captured yet.</span></div>
          <div class="actions" style="margin-top: 8px;">
            <button id="captureBtn">Capture Reading</button>
            <button id="assignBtn" class="secondary">Assign To Color</button>
          </div>
          <p class="hint">Point the real color sensor at the selected color, capture the reading, then assign it. Repeat for as many of the 32 colors as the class needs.</p>
        </section>
        <section>
          <h2>Log</h2>
          <div id="log" class="log"></div>
        </section>
      </aside>
      <div class="content">
        <section>
          <h2>32 Color Dictionary</h2>
          <div id="palette" class="palette"></div>
        </section>
        <section>
          <h2>Generated robot/color_calibration.py</h2>
          <pre id="dictionary" class="dictionary"></pre>
        </section>
      </div>
    </main>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const palette = ${paletteJson};
    const paletteByName = new Map(palette.map(([name, color]) => [name, color]));
    const statusEl = document.getElementById('status');
    const logEl = document.getElementById('log');
    const sampleEl = document.getElementById('sample');
    const sensorPortEl = document.getElementById('sensorPort');
    const colorNameEl = document.getElementById('colorName');
    const dictionaryEl = document.getElementById('dictionary');
    const controls = [
      document.getElementById('refreshBtn'),
      document.getElementById('saveBtn'),
      document.getElementById('uploadBtn'),
      document.getElementById('captureBtn'),
      document.getElementById('assignBtn'),
      sensorPortEl,
      colorNameEl,
    ];
    let data = { version: 1, updatedAt: null, ports: {} };
    let lastSample = null;
    let lastStatus = 'Loading...';

    for (const [name] of palette) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      colorNameEl.appendChild(option);
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'state') applyState(msg.state);
      if (msg.type === 'sample') applySample(msg.sample);
      if (msg.type === 'notice') note(msg.message);
      if (msg.type === 'error') note(msg.message, true);
      if (msg.type === 'busy') setBusy(true, msg.message);
      if (msg.type === 'idle') setBusy(false);
    });

    document.getElementById('refreshBtn').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    document.getElementById('captureBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'capture', sensorPort: Number(sensorPortEl.value) });
    });
    document.getElementById('assignBtn').addEventListener('click', assignSample);
    document.getElementById('saveBtn').addEventListener('click', () => vscode.postMessage({ type: 'save', data }));
    document.getElementById('uploadBtn').addEventListener('click', () => vscode.postMessage({ type: 'upload', data }));
    sensorPortEl.addEventListener('change', render);

    function applyState(state) {
      data = normalizeData(state.data);
      lastStatus = (state.workspaceRoot || 'No workspace') + ' | Robot port: ' + (state.serialPort || 'not checked');
      if (!statusEl.classList.contains('busy')) {
        statusEl.textContent = lastStatus;
      }
      render();
    }

    function applySample(sample) {
      lastSample = sample;
      sampleEl.innerHTML = '<strong></strong><span></span><span></span>';
      sampleEl.children[0].textContent = 'Captured from Port ' + sample.port;
      sampleEl.children[1].textContent = 'RGB ' + sample.rgb.r + ', ' + sample.rgb.g + ', ' + sample.rgb.b + ' | clear ' + sample.rgb.clear;
      sampleEl.children[2].textContent = 'Normalized ' + sample.normalized.r + ', ' + sample.normalized.g + ', ' + sample.normalized.b;
      note('Captured Port ' + sample.port + ' reading.');
    }

    function assignSample() {
      if (!lastSample) {
        note('Capture a real sensor reading first.', true);
        return;
      }
      const port = String(lastSample.port);
      const color = colorNameEl.value;
      const entries = data.ports[port] || [];
      const entry = {
        color,
        rgb: lastSample.rgb,
        normalized: lastSample.normalized,
        capturedAt: new Date().toISOString(),
      };
      data.ports[port] = [entry, ...entries.filter(item => item.color !== color)];
      data.updatedAt = new Date().toISOString();
      note('Assigned Port ' + port + ' reading to ' + color + '.');
      render();
    }

    function render() {
      renderPalette();
      dictionaryEl.textContent = generatePython(data);
    }

    function renderPalette() {
      const el = document.getElementById('palette');
      el.innerHTML = '';
      const port = sensorPortEl.value;
      const entries = data.ports[port] || [];
      const byColor = new Map(entries.map(entry => [entry.color, entry]));
      for (const [name, color] of palette) {
        const entry = byColor.get(name);
        const button = document.createElement('button');
        button.className = 'swatch' + (entry ? ' captured' : '') + (colorNameEl.value === name ? ' active' : '');
        button.innerHTML = '<span class="chip"></span><span class="name"></span><span class="badge"></span>';
        button.children[0].style.background = color;
        button.children[1].textContent = name;
        button.children[2].textContent = entry ? 'set' : 'empty';
        button.addEventListener('click', () => {
          colorNameEl.value = name;
          renderPalette();
        });
        el.appendChild(button);
      }
    }

    function normalizeData(value) {
      const next = value && typeof value === 'object' ? value : {};
      const ports = next.ports && typeof next.ports === 'object' ? next.ports : {};
      return {
        version: 1,
        updatedAt: next.updatedAt || null,
        ports,
      };
    }

    function generatePython(value) {
      const lines = [
        '# Generated by Zebra: Sensor Calibration',
        '# Upload this file to :/robot/color_calibration.py',
        'COLOR_CALIBRATIONS = {',
      ];
      for (const port of Object.keys(value.ports).sort((a, b) => Number(a) - Number(b))) {
        lines.push('    ' + port + ': [');
        for (const entry of value.ports[port]) {
          lines.push('        {"color": "' + escapePy(entry.color) + '", "rgb": {"r": ' + entry.rgb.r + ', "g": ' + entry.rgb.g + ', "b": ' + entry.rgb.b + ', "clear": ' + entry.rgb.clear + '}, "normalized": {"r": ' + entry.normalized.r + ', "g": ' + entry.normalized.g + ', "b": ' + entry.normalized.b + '}},');
        }
        lines.push('    ],');
      }
      lines.push('}');
      return lines.join('\\n') + '\\n';
    }

    function escapePy(value) {
      return String(value).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
    }

    function note(text, isError) {
      const line = document.createElement('div');
      line.className = 'log-line';
      line.textContent = new Date().toLocaleTimeString() + '  ' + text;
      if (isError) line.style.color = 'var(--danger)';
      logEl.prepend(line);
    }

    function setBusy(isBusy, message) {
      for (const control of controls) {
        control.disabled = isBusy;
      }
      statusEl.classList.toggle('busy', isBusy);
      statusEl.textContent = isBusy ? (message || 'Working...') : lastStatus;
      if (isBusy && message) {
        note(message);
      }
    }

    vscode.postMessage({ type: 'refresh' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
