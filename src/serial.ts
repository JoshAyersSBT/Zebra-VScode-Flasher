import * as vscode from 'vscode';
import * as cp from 'child_process';

export interface SerialCandidate {
  device: string;
  description: string;
  manufacturer: string;
  hwid: string;
  vid?: number;
  pid?: number;
  score: number;
}

const KEYWORDS = [
  'esp32',
  'cp210',
  'ch340',
  'ch341',
  'ch910',
  'usb serial',
  'wchusbserial',
  'silicon labs',
  'uart',
  'jtag',
];

const HWIDS = new Set([
  '10c4:ea60', // CP210x
  '1a86:7523', // CH340
  '1a86:55d4', // CH9102
  '303a:1001', // ESP32 USB/JTAG variants
  '303a:4001',
  '303a:8001',
  '0403:6001', // FTDI fallback
]);

const SERIAL_SCAN_SCRIPT = String.raw`
import json
import sys

try:
    from serial.tools import list_ports
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e), "ports": []}))
    sys.exit(0)

ports = []
for p in list_ports.comports():
    ports.append({
        "device": p.device,
        "description": p.description or "",
        "manufacturer": getattr(p, "manufacturer", "") or "",
        "hwid": p.hwid or "",
        "vid": getattr(p, "vid", None),
        "pid": getattr(p, "pid", None),
    })

print(json.dumps({"ok": True, "ports": ports}))
`;

export async function listSerialCandidates(toolPython: string): Promise<SerialCandidate[]> {
  const parsed = await runPythonSerialScan(toolPython);
  return parsed
    .map((p: Omit<SerialCandidate, 'score'>): SerialCandidate => ({
      ...p,
      description: p.description || '',
      manufacturer: p.manufacturer || '',
      hwid: p.hwid || '',
      score: scorePort(p),
    }))
    .sort((a: SerialCandidate, b: SerialCandidate) => b.score - a.score || a.device.localeCompare(b.device));
}

export async function pickSerialPort(toolPython: string): Promise<string> {
  const candidates = await listSerialCandidates(toolPython);

  if (!candidates.length) {
    const choice = await vscode.window.showWarningMessage(
      'No serial devices were found. You may need the CP210x or CH340/CH341 USB UART driver.',
      'Open Driver Help',
      'Cancel',
    );
    if (choice === 'Open Driver Help') {
      await openDriverHelp();
    }
    throw new Error('No serial devices found.');
  }

  const picked = await vscode.window.showQuickPick(
    candidates.map((candidate: SerialCandidate) => ({
      label: candidate.device,
      description: candidate.description || candidate.manufacturer || 'serial device',
      detail: `VID:PID ${fmtHex(candidate.vid)}:${fmtHex(candidate.pid)} | ${candidate.hwid || 'no hwid'} | score=${candidate.score}`,
      candidate,
    })),
    {
      title: 'Select ESP32 Serial Port',
      placeHolder: 'Choose the USB UART attached to your ESP32',
    },
  );

  if (!picked) {
    throw new Error('Serial port selection cancelled.');
  }

  return picked.candidate.device;
}

export async function resolveSerialPort(toolPython: string): Promise<string> {
  const config = vscode.workspace.getConfiguration('zebra');
  const configured = (config.get<string>('port') || 'AUTO').trim();

  if (configured && !isAutoPort(configured)) {
    return configured;
  }

  const candidates = await listSerialCandidates(toolPython);
  if (!candidates.length) {
    return pickSerialPort(toolPython);
  }

  return candidates[0].device;
}

export async function openDriverHelp(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    'Install USB UART drivers if your ESP32 does not appear as a serial port.',
    'CP210x Driver',
    'CH340/CH341 Driver',
  );

  if (choice === 'CP210x Driver') {
    await vscode.env.openExternal(vscode.Uri.parse('https://www.silabs.com/software-and-tools/usb-to-uart-bridge-vcp-drivers'));
  } else if (choice === 'CH340/CH341 Driver') {
    await vscode.env.openExternal(vscode.Uri.parse('https://www.wch-ic.com/downloads/CH341SER_ZIP.html'));
  }
}

async function runPythonSerialScan(
  toolPython: string
): Promise<Omit<SerialCandidate, "score">[]> {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(toolPython, ["-c", SERIAL_SCAN_SCRIPT], {
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const fail = (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    const succeed = (ports: Omit<SerialCandidate, "score">[]) => {
      if (!settled) {
        settled = true;
        resolve(ports);
      }
    };

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString("utf8");
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString("utf8");
    });

    child.on("error", (err: Error) => {
      fail(err);
    });

    child.on("close", (code: number | null) => {
      if (code !== 0) {
        fail(new Error(stderr.trim() || `Python serial scan failed with exit code ${code}`));
        return;
      }

      try {
        const decoded = JSON.parse(stdout.trim()) as {
          ok: boolean;
          error?: string;
          ports?: Omit<SerialCandidate, "score">[];
        };

        if (!decoded.ok) {
          fail(new Error(decoded.error || "pyserial serial scan failed"));
          return;
        }

        succeed(decoded.ports || []);
      } catch {
        fail(
          new Error(
            `Could not parse serial scan output.\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`
          )
        );
      }
    });
  });
}

function scorePort(info: { device: string; description: string; manufacturer: string; hwid: string; vid?: number; pid?: number }): number {
  let score = 0;

  if (typeof info.vid === 'number' && typeof info.pid === 'number') {
    const key = `${info.vid.toString(16).padStart(4, '0')}:${info.pid.toString(16).padStart(4, '0')}`;
    if (HWIDS.has(key)) {
      score += 100;
    }
  }

  const text = `${info.device} ${info.description} ${info.manufacturer} ${info.hwid}`.toLowerCase();
  for (const keyword of KEYWORDS) {
    if (text.includes(keyword)) {
      score += 15;
    }
  }

  if (process.platform === 'win32' && /^com\d+/i.test(info.device)) {
    score += 5;
  }
  if (process.platform !== 'win32' && info.device.startsWith('/dev/')) {
    score += 5;
  }

  return score;
}

function fmtHex(v?: number): string {
  return typeof v === 'number' ? v.toString(16).toUpperCase().padStart(4, '0') : '----';
}

function isAutoPort(port: string): boolean {
  return ['AUTO', 'AUTO-DETECT', 'AUTODETECT'].includes(port.trim().toUpperCase());
}
