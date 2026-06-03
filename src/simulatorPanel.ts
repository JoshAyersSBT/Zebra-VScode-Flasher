import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

interface SimulatorInitialData {
  workspaceRoot: string | null;
  userCode: string;
  savedScene: unknown;
}

export class SimulatorPanel {
  private static currentPanel: SimulatorPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly getWorkspaceRoot: () => string | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  public static async show(extensionUri: vscode.Uri, getWorkspaceRoot: () => string | undefined): Promise<void> {
    const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

    if (SimulatorPanel.currentPanel) {
      SimulatorPanel.currentPanel.panel.reveal(column);
      await SimulatorPanel.currentPanel.postInitialData();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'zebraSimulator',
      'Zebra Robot Simulator',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    SimulatorPanel.currentPanel = new SimulatorPanel(panel, extensionUri, getWorkspaceRoot);
    await SimulatorPanel.currentPanel.postInitialData();
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, getWorkspaceRoot: () => string | undefined) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.getWorkspaceRoot = getWorkspaceRoot;

    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage(
      async message => {
        if (message?.type === 'saveScene') {
          await this.saveScene(message.scene);
          await this.panel.webview.postMessage({ type: 'saved', message: 'Simulator scene saved.' });
          return;
        }

        if (message?.type === 'reloadUserCode') {
          await this.postInitialData();
        }
      },
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private async postInitialData(): Promise<void> {
    await this.panel.webview.postMessage({ type: 'initialData', data: await this.getInitialData() });
  }

  private async getInitialData(): Promise<SimulatorInitialData> {
    const workspaceRoot = this.getWorkspaceRoot() || null;
    return {
      workspaceRoot,
      userCode: workspaceRoot ? await this.readUserCode(workspaceRoot) : '',
      savedScene: workspaceRoot ? await this.readSavedScene(workspaceRoot) : null,
    };
  }

  private async readUserCode(root: string): Promise<string> {
    for (const name of ['user_main.py', 'main.py']) {
      const file = path.join(root, name);
      if (fs.existsSync(file)) {
        return fs.promises.readFile(file, 'utf8');
      }
    }
    return '';
  }

  private async readSavedScene(root: string): Promise<unknown> {
    const file = this.scenePath(root);
    if (!fs.existsSync(file)) {
      return null;
    }

    try {
      return JSON.parse(await fs.promises.readFile(file, 'utf8'));
    } catch {
      return null;
    }
  }

  private async saveScene(scene: unknown): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) {
      throw new Error('Open a workspace folder before saving a simulator scene.');
    }

    const file = this.scenePath(root);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify(scene, null, 2) + '\n', 'utf8');
  }

  private scenePath(root: string): string {
    return path.join(root, '.zebra', 'simulator.json');
  }

  private dispose(): void {
    SimulatorPanel.currentPanel = undefined;
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
  <title>Zebra Robot Simulator</title>
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
      --warn: #d29922;
    }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--fg); background: var(--bg); font-family: var(--vscode-font-family); }
    .app { min-height: 100vh; display: grid; grid-template-columns: 260px minmax(0, 1fr) 300px; grid-template-rows: auto minmax(0, 1fr); }
    .topbar { grid-column: 1 / -1; display: flex; gap: 8px; align-items: center; min-height: 46px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--panel); }
    .brand { font-size: 15px; font-weight: 700; margin-right: 8px; white-space: nowrap; }
    .status { color: var(--muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .left, .right { min-height: 0; overflow: auto; padding: 12px; border-color: var(--border); background: color-mix(in srgb, var(--panel), var(--bg) 18%); }
    .left { border-right: 1px solid var(--border); }
    .right { border-left: 1px solid var(--border); }
    .stage-wrap { min-width: 0; min-height: 0; position: relative; background: var(--bg); }
    canvas { width: 100%; height: 100%; display: block; cursor: crosshair; }
    h2 { margin: 0 0 8px; font-size: 13px; letter-spacing: 0; text-transform: uppercase; color: var(--muted); }
    section { margin-bottom: 14px; }
    button, select, input, textarea { font: inherit; }
    button { min-height: 30px; border: none; border-radius: 6px; padding: 6px 9px; color: var(--button-fg); background: var(--button); cursor: pointer; }
    button:hover { background: var(--button-hover); }
    button.secondary { color: var(--fg); background: transparent; border: 1px solid var(--border); }
    button.icon { width: 32px; padding: 0; display: inline-grid; place-items: center; }
    button.active { outline: 1px solid var(--accent); background: color-mix(in srgb, var(--button), transparent 20%); }
    .row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(76px, auto); gap: 8px; align-items: center; margin: 7px 0; }
    label { color: var(--muted); font-size: 12px; }
    input, select, textarea { width: 100%; color: var(--fg); background: var(--input); border: 1px solid var(--border); border-radius: 6px; padding: 6px 7px; }
    input[type="range"] { padding: 0; }
    textarea { min-height: 150px; resize: vertical; font-family: var(--vscode-editor-font-family); font-size: 12px; line-height: 1.35; }
    .tools, .shapes, .sensors, .actions { display: flex; flex-wrap: wrap; gap: 7px; }
    .sensor { width: 100%; display: grid; grid-template-columns: 1fr 62px; gap: 7px; align-items: center; padding: 8px; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 7px; background: color-mix(in srgb, var(--input), transparent 25%); cursor: grab; }
    .sensor strong { display: block; font-size: 12px; }
    .sensor span { color: var(--muted); font-size: 11px; }
    .hint { color: var(--muted); font-size: 12px; line-height: 1.4; margin: 8px 0 0; }
    .readout { display: grid; gap: 6px; }
    .metric { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 9px; align-items: baseline; font-size: 12px; }
    .metric span:first-child { color: var(--muted); }
    .metric strong { overflow-wrap: anywhere; text-align: right; }
    .ports { display: grid; gap: 7px; }
    .port { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 8px; align-items: center; font-size: 12px; padding: 6px; border: 1px solid var(--border); border-radius: 6px; }
    .port strong { color: var(--muted); }
    .log { min-height: 90px; max-height: 160px; overflow: auto; padding: 8px; border: 1px solid var(--border); border-radius: 6px; color: var(--muted); background: var(--input); font-size: 12px; line-height: 1.35; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 7px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: 11px; }
    .badge::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--warn); }
    .badge.running::before { background: var(--ok); }
    .badge.paused::before { background: var(--muted); }
    @media (max-width: 980px) {
      .app { grid-template-columns: 220px minmax(0, 1fr); }
      .right { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); max-height: 42vh; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <div class="brand">Zebra Simulator</div>
      <button id="runBtn" title="Run simulated user code">Run</button>
      <button id="pauseBtn" class="secondary" title="Pause simulation">Pause</button>
      <button id="resetBtn" class="secondary icon" title="Reset robot pose">R</button>
      <button id="saveBtn" class="secondary icon" title="Save simulator scene">S</button>
      <button id="reloadBtn" class="secondary icon" title="Reload user code">U</button>
      <span id="runState" class="badge paused">Paused</span>
      <span id="status" class="status">Loading workspace...</span>
    </header>

    <aside class="left">
      <section>
        <h2>Place</h2>
        <div class="tools">
          <button class="secondary active" data-tool="select" title="Select and drag objects">Select</button>
          <button class="secondary" data-tool="robot" title="Place the robot">Robot</button>
          <button class="secondary" data-tool="rect" title="Place a rectangle obstacle">Rect</button>
          <button class="secondary" data-tool="circle" title="Place a circle obstacle">Circle</button>
        </div>
        <p class="hint">Click the field to place items. Drag the robot or obstacles to move them.</p>
      </section>

      <section>
        <h2>Robot</h2>
        <div class="row"><label for="wheelbase">Wheelbase</label><input id="wheelbase" type="number" min="80" max="360" step="10" value="190" /></div>
        <div class="row"><label for="maxSpeed">Max speed</label><input id="maxSpeed" type="number" min="40" max="520" step="10" value="210" /></div>
        <div class="row"><label for="centerAngle">Center angle</label><input id="centerAngle" type="number" min="0" max="180" value="90" /></div>
        <div class="row"><label for="steering">Steering</label><input id="steering" type="range" min="45" max="135" value="90" /></div>
        <div class="row"><label for="throttle">Throttle</label><input id="throttle" type="range" min="-100" max="100" value="0" /></div>
      </section>

      <section>
        <h2>Sensors</h2>
        <div class="sensor" draggable="true" data-sensor="tof"><div><strong>Distance</strong><span>ray to obstacles</span></div><select><option>P1</option><option>P2</option><option>P3</option><option>P4</option></select></div>
        <div class="sensor" draggable="true" data-sensor="line"><div><strong>Line</strong><span>dark floor detector</span></div><select><option>P1</option><option>P2</option><option>P3</option><option>P4</option></select></div>
        <div class="sensor" draggable="true" data-sensor="imu"><div><strong>IMU</strong><span>heading and gyro</span></div><select><option>I2C</option><option>P1</option><option>P2</option></select></div>
        <p class="hint">Drag a sensor onto the robot body. Its selected port is used in the simulated port map.</p>
      </section>
    </aside>

    <main class="stage-wrap">
      <canvas id="stage"></canvas>
    </main>

    <aside class="right">
      <section>
        <h2>Telemetry</h2>
        <div class="readout">
          <div class="metric"><span>Position</span><strong id="posMetric">0, 0</strong></div>
          <div class="metric"><span>Heading</span><strong id="headingMetric">0 deg</strong></div>
          <div class="metric"><span>Throttle</span><strong id="throttleMetric">0</strong></div>
          <div class="metric"><span>Steering</span><strong id="steeringMetric">90 deg</strong></div>
          <div class="metric"><span>Collision</span><strong id="collisionMetric">No</strong></div>
        </div>
      </section>

      <section>
        <h2>Port Map</h2>
        <div id="ports" class="ports"></div>
      </section>

      <section>
        <h2>User Code Model</h2>
        <textarea id="code" spellcheck="false"></textarea>
        <div class="actions" style="margin-top: 8px;">
          <button id="parseBtn" class="secondary">Parse Commands</button>
          <button id="exampleBtn" class="secondary">Example</button>
        </div>
        <p class="hint">The runner recognizes common calls such as <code>drive.drive(40, 120)</code>, <code>drive.stop()</code>, <code>steer_center()</code>, and <code>sleep_ms(500)</code>.</p>
      </section>

      <section>
        <h2>Log</h2>
        <div id="log" class="log"></div>
      </section>
    </aside>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const canvas = document.getElementById('stage');
    const ctx = canvas.getContext('2d');
    const statusEl = document.getElementById('status');
    const runStateEl = document.getElementById('runState');
    const logEl = document.getElementById('log');
    const codeEl = document.getElementById('code');
    const inputs = {
      wheelbase: document.getElementById('wheelbase'),
      maxSpeed: document.getElementById('maxSpeed'),
      centerAngle: document.getElementById('centerAngle'),
      steering: document.getElementById('steering'),
      throttle: document.getElementById('throttle'),
    };

    const state = {
      tool: 'select',
      running: false,
      lastTime: performance.now(),
      drag: null,
      commandQueue: [],
      activeCommand: null,
      world: { width: 2200, height: 1400 },
      robot: { x: 420, y: 360, heading: 0, width: 150, length: 230, wheelbase: 190, maxSpeed: 210, throttle: 0, steering: 90, centerAngle: 90, sensors: [] },
      shapes: [
        { id: 'rect-1', kind: 'rect', x: 830, y: 270, w: 260, h: 130 },
        { id: 'circle-1', kind: 'circle', x: 1180, y: 630, r: 95 },
      ],
      trail: [],
      selectedId: null,
    };

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'initialData') applyInitialData(msg.data);
      if (msg.type === 'saved') note(msg.message);
    });

    function applyInitialData(data) {
      statusEl.textContent = data.workspaceRoot ? data.workspaceRoot : 'No workspace open; scene can be edited but not saved.';
      if (data.userCode) codeEl.value = data.userCode;
      if (data.savedScene) {
        Object.assign(state.robot, data.savedScene.robot || {});
        state.shapes = Array.isArray(data.savedScene.shapes) ? data.savedScene.shapes : state.shapes;
        state.trail = Array.isArray(data.savedScene.trail) ? data.savedScene.trail : [];
      }
      syncInputsFromRobot();
      renderPorts();
      note('Simulator ready.');
    }

    document.querySelectorAll('button[data-tool]').forEach(button => {
      button.addEventListener('click', () => {
        state.tool = button.dataset.tool;
        document.querySelectorAll('button[data-tool]').forEach(b => b.classList.toggle('active', b === button));
      });
    });

    for (const input of Object.values(inputs)) {
      input.addEventListener('input', () => {
        state.robot.wheelbase = number(inputs.wheelbase.value, 190);
        state.robot.maxSpeed = number(inputs.maxSpeed.value, 210);
        state.robot.centerAngle = number(inputs.centerAngle.value, 90);
        state.robot.steering = number(inputs.steering.value, 90);
        state.robot.throttle = number(inputs.throttle.value, 0);
      });
    }

    document.getElementById('runBtn').addEventListener('click', () => {
      state.commandQueue = parseCommands(codeEl.value);
      state.activeCommand = null;
      state.running = true;
      runStateEl.textContent = 'Running';
      runStateEl.className = 'badge running';
      note('Running ' + state.commandQueue.length + ' simulated user-code command(s).');
    });
    document.getElementById('pauseBtn').addEventListener('click', pause);
    document.getElementById('resetBtn').addEventListener('click', () => {
      state.robot.x = 420;
      state.robot.y = 360;
      state.robot.heading = 0;
      state.robot.throttle = 0;
      state.robot.steering = state.robot.centerAngle;
      state.trail = [];
      syncInputsFromRobot();
      pause();
      note('Robot pose reset.');
    });
    document.getElementById('saveBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'saveScene', scene: { robot: state.robot, shapes: state.shapes, trail: state.trail.slice(-240) } });
    });
    document.getElementById('reloadBtn').addEventListener('click', () => vscode.postMessage({ type: 'reloadUserCode' }));
    document.getElementById('parseBtn').addEventListener('click', () => note('Recognized ' + parseCommands(codeEl.value).length + ' command(s).'));
    document.getElementById('exampleBtn').addEventListener('click', () => {
      codeEl.value = 'drive.drive(45, 90)\\nawait asyncio.sleep_ms(900)\\ndrive.drive(35, 125)\\nawait asyncio.sleep_ms(900)\\ndrive.drive(35, 65)\\nawait asyncio.sleep_ms(900)\\ndrive.stop()';
    });

    document.querySelectorAll('.sensor').forEach(el => {
      el.addEventListener('dragstart', event => {
        const select = el.querySelector('select');
        event.dataTransfer.setData('application/json', JSON.stringify({ kind: el.dataset.sensor, port: select.value }));
      });
    });
    canvas.addEventListener('dragover', event => event.preventDefault());
    canvas.addEventListener('drop', event => {
      event.preventDefault();
      const sensor = JSON.parse(event.dataTransfer.getData('application/json') || '{}');
      const p = screenToWorld(event.offsetX, event.offsetY);
      if (!pointInRobot(p.x, p.y)) {
        note('Drop sensors onto the robot body.');
        return;
      }
      const local = worldToRobotLocal(p.x, p.y);
      state.robot.sensors.push({ id: 'sensor-' + Date.now(), kind: sensor.kind || 'tof', port: sensor.port || 'P1', x: local.x, y: local.y, angle: 0 });
      renderPorts();
      note('Assigned ' + labelSensor(sensor.kind) + ' to ' + (sensor.port || 'P1') + '.');
    });

    canvas.addEventListener('pointerdown', event => {
      const p = screenToWorld(event.offsetX, event.offsetY);
      if (state.tool === 'robot') {
        state.robot.x = p.x;
        state.robot.y = p.y;
        state.trail = [];
        return;
      }
      if (state.tool === 'rect') {
        state.shapes.push({ id: 'rect-' + Date.now(), kind: 'rect', x: p.x - 80, y: p.y - 45, w: 160, h: 90 });
        return;
      }
      if (state.tool === 'circle') {
        state.shapes.push({ id: 'circle-' + Date.now(), kind: 'circle', x: p.x, y: p.y, r: 70 });
        return;
      }
      const sensor = hitSensor(p.x, p.y);
      if (sensor) {
        state.drag = { kind: 'sensor', id: sensor.id };
        return;
      }
      const shape = hitShape(p.x, p.y);
      if (shape) {
        state.drag = { kind: 'shape', id: shape.id, dx: p.x - shape.x, dy: p.y - shape.y };
        state.selectedId = shape.id;
        return;
      }
      if (pointInRobot(p.x, p.y)) {
        state.drag = { kind: 'robot', dx: p.x - state.robot.x, dy: p.y - state.robot.y };
        state.selectedId = 'robot';
      }
    });
    canvas.addEventListener('pointermove', event => {
      if (!state.drag) return;
      const p = screenToWorld(event.offsetX, event.offsetY);
      if (state.drag.kind === 'robot') {
        state.robot.x = p.x - state.drag.dx;
        state.robot.y = p.y - state.drag.dy;
      }
      if (state.drag.kind === 'shape') {
        const shape = state.shapes.find(s => s.id === state.drag.id);
        if (shape) {
          shape.x = p.x - state.drag.dx;
          shape.y = p.y - state.drag.dy;
        }
      }
      if (state.drag.kind === 'sensor' && pointInRobot(p.x, p.y)) {
        const sensor = state.robot.sensors.find(s => s.id === state.drag.id);
        if (sensor) Object.assign(sensor, worldToRobotLocal(p.x, p.y));
      }
    });
    canvas.addEventListener('pointerup', () => state.drag = null);

    function pause() {
      state.running = false;
      state.robot.throttle = 0;
      inputs.throttle.value = '0';
      runStateEl.textContent = 'Paused';
      runStateEl.className = 'badge paused';
    }

    function parseCommands(source) {
      const commands = [];
      const lines = source.split(/\\r?\\n/);
      for (const line of lines) {
        const clean = line.replace(/#.*$/, '').trim();
        let m = clean.match(/\\.drive\\(([-\\d.]+)\\s*,\\s*([-\\d.]+)/);
        if (m) {
          commands.push({ kind: 'drive', throttle: Number(m[1]), steering: Number(m[2]), duration: 0.02 });
          continue;
        }
        m = clean.match(/\\.forward\\(([-\\d.]+)/);
        if (m) {
          commands.push({ kind: 'drive', throttle: Math.abs(Number(m[1])), steering: state.robot.centerAngle, duration: 0.02 });
          continue;
        }
        m = clean.match(/\\.backward\\(([-\\d.]+)/);
        if (m) {
          commands.push({ kind: 'drive', throttle: -Math.abs(Number(m[1])), steering: state.robot.centerAngle, duration: 0.02 });
          continue;
        }
        m = clean.match(/\\.steer\\(([-\\d.]+)/);
        if (m) {
          commands.push({ kind: 'steer', steering: Number(m[1]), duration: 0.02 });
          continue;
        }
        if (/\\.steer_center\\(/.test(clean)) {
          commands.push({ kind: 'steer', steering: state.robot.centerAngle, duration: 0.02 });
          continue;
        }
        if (/\\.stop\\(/.test(clean)) {
          commands.push({ kind: 'drive', throttle: 0, steering: state.robot.centerAngle, duration: 0.02 });
          continue;
        }
        m = clean.match(/sleep_ms\\((\\d+)/);
        if (m) {
          commands.push({ kind: 'wait', duration: Math.max(0.02, Number(m[1]) / 1000) });
          continue;
        }
        m = clean.match(/sleep\\((\\d+(?:\\.\\d+)?)/);
        if (m) {
          commands.push({ kind: 'wait', duration: Math.max(0.02, Number(m[1])) });
        }
      }
      return commands;
    }

    function runCommands(dt) {
      if (!state.running) return;
      if (!state.activeCommand) {
        state.activeCommand = state.commandQueue.shift() || null;
        if (!state.activeCommand) {
          pause();
          note('Simulated user-code sequence finished.');
          return;
        }
        state.activeCommand.remaining = state.activeCommand.duration;
        if (state.activeCommand.kind === 'drive') {
          state.robot.throttle = clamp(state.activeCommand.throttle, -100, 100);
          state.robot.steering = clamp(state.activeCommand.steering, 0, 180);
        }
        if (state.activeCommand.kind === 'steer') {
          state.robot.steering = clamp(state.activeCommand.steering, 0, 180);
        }
        syncInputsFromRobot();
      }
      state.activeCommand.remaining -= dt;
      if (state.activeCommand.remaining <= 0) {
        state.activeCommand = null;
      }
    }

    function step(now) {
      resizeCanvas();
      const dt = Math.min(0.05, (now - state.lastTime) / 1000);
      state.lastTime = now;
      runCommands(dt);
      integrate(dt);
      draw();
      updateReadouts();
      requestAnimationFrame(step);
    }

    function integrate(dt) {
      const robot = state.robot;
      const speed = robot.maxSpeed * (robot.throttle / 100);
      const steeringRad = degToRad(robot.steering - robot.centerAngle);
      const turnRate = Math.abs(Math.tan(steeringRad)) < 0.001 ? 0 : speed / robot.wheelbase * Math.tan(steeringRad);
      robot.heading += turnRate * dt;
      robot.x += Math.cos(robot.heading) * speed * dt;
      robot.y += Math.sin(robot.heading) * speed * dt;
      robot.x = clamp(robot.x, 0, state.world.width);
      robot.y = clamp(robot.y, 0, state.world.height);
      if (Math.abs(speed) > 1) {
        state.trail.push({ x: robot.x, y: robot.y });
        if (state.trail.length > 500) state.trail.shift();
      }
      if (robotCollides()) {
        robot.throttle = 0;
        inputs.throttle.value = '0';
      }
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const scale = viewScale();
      ctx.save();
      ctx.scale(scale, scale);
      drawGrid(scale);
      ctx.strokeStyle = '#3fb950';
      ctx.lineWidth = 3 / scale;
      ctx.beginPath();
      state.trail.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.stroke();
      for (const shape of state.shapes) drawShape(shape);
      drawRobot();
      ctx.restore();
    }

    function drawGrid(scale) {
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg');
      ctx.fillRect(0, 0, state.world.width, state.world.height);
      ctx.strokeStyle = 'rgba(127,127,127,.18)';
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      for (let x = 0; x <= state.world.width; x += 100) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, state.world.height);
      }
      for (let y = 0; y <= state.world.height; y += 100) {
        ctx.moveTo(0, y);
        ctx.lineTo(state.world.width, y);
      }
      ctx.stroke();
    }

    function drawShape(shape) {
      ctx.fillStyle = shape.id === state.selectedId ? 'rgba(210,153,34,.35)' : 'rgba(88,166,255,.22)';
      ctx.strokeStyle = 'rgba(88,166,255,.85)';
      ctx.lineWidth = 2;
      if (shape.kind === 'rect') {
        ctx.fillRect(shape.x, shape.y, shape.w, shape.h);
        ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
      } else {
        ctx.beginPath();
        ctx.arc(shape.x, shape.y, shape.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    function drawRobot() {
      const r = state.robot;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.heading);
      ctx.fillStyle = robotCollides() ? 'rgba(248,81,73,.38)' : 'rgba(63,185,80,.30)';
      ctx.strokeStyle = 'rgba(63,185,80,.95)';
      ctx.lineWidth = 3;
      ctx.fillRect(-r.length / 2, -r.width / 2, r.length, r.width);
      ctx.strokeRect(-r.length / 2, -r.width / 2, r.length, r.width);
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.fillRect(r.length / 2 - 32, -14, 32, 28);
      ctx.strokeStyle = 'rgba(255,255,255,.65)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(r.length / 2 + 45, 0);
      ctx.stroke();
      for (const sensor of r.sensors) drawSensor(sensor);
      ctx.restore();
      drawSensorRays();
    }

    function drawSensor(sensor) {
      ctx.fillStyle = sensor.kind === 'tof' ? '#58a6ff' : sensor.kind === 'line' ? '#d29922' : '#ff7b72';
      ctx.beginPath();
      ctx.arc(sensor.x, sensor.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.font = '12px sans-serif';
      ctx.fillText(sensor.port, sensor.x + 12, sensor.y - 8);
    }

    function drawSensorRays() {
      for (const sensor of state.robot.sensors) {
        if (sensor.kind !== 'tof') continue;
        const ray = sensorRay(sensor);
        ctx.save();
        ctx.strokeStyle = 'rgba(88,166,255,.75)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ray.x, ray.y);
        ctx.lineTo(ray.hitX, ray.hitY);
        ctx.stroke();
        ctx.restore();
      }
    }

    function sensorRay(sensor) {
      const p = robotLocalToWorld(sensor.x, sensor.y);
      const angle = state.robot.heading + (sensor.angle || 0);
      const max = 620;
      const distance = distanceToObstacle(p.x, p.y, angle, max);
      return { x: p.x, y: p.y, hitX: p.x + Math.cos(angle) * distance, hitY: p.y + Math.sin(angle) * distance, distance };
    }

    function distanceToObstacle(x, y, angle, max) {
      for (let d = 0; d <= max; d += 8) {
        const px = x + Math.cos(angle) * d;
        const py = y + Math.sin(angle) * d;
        if (px < 0 || py < 0 || px > state.world.width || py > state.world.height) return d;
        if (state.shapes.some(shape => pointInShape(shape, px, py))) return d;
      }
      return max;
    }

    function updateReadouts() {
      document.getElementById('posMetric').textContent = Math.round(state.robot.x) + ', ' + Math.round(state.robot.y);
      document.getElementById('headingMetric').textContent = Math.round(radToDeg(state.robot.heading) % 360) + ' deg';
      document.getElementById('throttleMetric').textContent = String(Math.round(state.robot.throttle));
      document.getElementById('steeringMetric').textContent = Math.round(state.robot.steering) + ' deg';
      document.getElementById('collisionMetric').textContent = robotCollides() ? 'Yes' : 'No';
      renderPorts();
    }

    function renderPorts() {
      const ports = document.getElementById('ports');
      ports.innerHTML = '';
      const values = new Map();
      for (const sensor of state.robot.sensors) {
        let value = sensor.kind;
        if (sensor.kind === 'tof') value = Math.round(sensorRay(sensor).distance) + ' mm';
        if (sensor.kind === 'line') value = isDarkFloor(sensor) ? 'dark' : 'light';
        if (sensor.kind === 'imu') value = Math.round(radToDeg(state.robot.heading) % 360) + ' deg';
        values.set(sensor.port, labelSensor(sensor.kind) + ': ' + value);
      }
      for (const port of ['P1', 'P2', 'P3', 'P4', 'I2C']) {
        const row = document.createElement('div');
        row.className = 'port';
        row.innerHTML = '<strong></strong><span></span>';
        row.children[0].textContent = port;
        row.children[1].textContent = values.get(port) || 'empty';
        ports.appendChild(row);
      }
    }

    function isDarkFloor(sensor) {
      const p = robotLocalToWorld(sensor.x, sensor.y);
      return Math.floor(p.x / 180 + p.y / 180) % 2 === 0;
    }

    function robotCollides() {
      const r = state.robot;
      const corners = [
        robotLocalToWorld(-r.length / 2, -r.width / 2),
        robotLocalToWorld(r.length / 2, -r.width / 2),
        robotLocalToWorld(r.length / 2, r.width / 2),
        robotLocalToWorld(-r.length / 2, r.width / 2),
        { x: r.x, y: r.y },
      ];
      return corners.some(p => state.shapes.some(shape => pointInShape(shape, p.x, p.y)));
    }

    function pointInRobot(x, y) {
      const p = worldToRobotLocal(x, y);
      return Math.abs(p.x) <= state.robot.length / 2 && Math.abs(p.y) <= state.robot.width / 2;
    }

    function hitSensor(x, y) {
      for (const sensor of state.robot.sensors) {
        const p = robotLocalToWorld(sensor.x, sensor.y);
        if (Math.hypot(x - p.x, y - p.y) <= 16) return sensor;
      }
      return null;
    }

    function hitShape(x, y) {
      for (let i = state.shapes.length - 1; i >= 0; i--) {
        if (pointInShape(state.shapes[i], x, y)) return state.shapes[i];
      }
      return null;
    }

    function pointInShape(shape, x, y) {
      if (shape.kind === 'rect') return x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h;
      return Math.hypot(x - shape.x, y - shape.y) <= shape.r;
    }

    function worldToRobotLocal(x, y) {
      const dx = x - state.robot.x;
      const dy = y - state.robot.y;
      const c = Math.cos(-state.robot.heading);
      const s = Math.sin(-state.robot.heading);
      return { x: dx * c - dy * s, y: dx * s + dy * c };
    }

    function robotLocalToWorld(x, y) {
      const c = Math.cos(state.robot.heading);
      const s = Math.sin(state.robot.heading);
      return { x: state.robot.x + x * c - y * s, y: state.robot.y + x * s + y * c };
    }

    function screenToWorld(x, y) {
      const rect = canvas.getBoundingClientRect();
      const pixelX = x * (canvas.width / Math.max(1, rect.width));
      const pixelY = y * (canvas.height / Math.max(1, rect.height));
      const scale = viewScale();
      return { x: pixelX / scale, y: pixelY / scale };
    }

    function viewScale() {
      return Math.min(canvas.width / state.world.width, canvas.height / state.world.height);
    }

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * ratio));
      const height = Math.max(1, Math.floor(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }

    function syncInputsFromRobot() {
      inputs.wheelbase.value = String(Math.round(state.robot.wheelbase));
      inputs.maxSpeed.value = String(Math.round(state.robot.maxSpeed));
      inputs.centerAngle.value = String(Math.round(state.robot.centerAngle));
      inputs.steering.value = String(Math.round(state.robot.steering));
      inputs.throttle.value = String(Math.round(state.robot.throttle));
    }

    function note(text) {
      const line = document.createElement('div');
      line.textContent = new Date().toLocaleTimeString() + '  ' + text;
      logEl.prepend(line);
    }

    function labelSensor(kind) {
      return kind === 'tof' ? 'Distance' : kind === 'line' ? 'Line' : kind === 'imu' ? 'IMU' : 'Sensor';
    }

    function number(value, fallback) {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function degToRad(value) {
      return value * Math.PI / 180;
    }

    function radToDeg(value) {
      return value * 180 / Math.PI;
    }

    requestAnimationFrame(step);
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
