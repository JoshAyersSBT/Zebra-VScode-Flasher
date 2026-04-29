import * as vscode from 'vscode';

export function openSerialMonitor(port: string, baud: number): void {
  const term = vscode.window.createTerminal(`Zebra Serial ${port}`);
  const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
  const code = `import serial,sys; s=serial.Serial(${JSON.stringify(port)}, ${baud}, timeout=0.2); print('Listening on ${port} @ ${baud}');\nwhile True:\n    b=s.readline()\n    if b: print(b.decode(errors='replace').rstrip())`;
  term.sendText(`${pyCmd} -c ${JSON.stringify(code)}`);
  term.show();
}
