import * as vscode from 'vscode';

type Action = {
  label: string;
  command: string;
  icon: string;
  description?: string;
};

const ACTIONS: Record<string, Action[]> = {
  Project: [
    { label: 'Initialize Project', command: 'zebra.initProject', icon: 'new-folder' },
    { label: 'Project Status', command: 'zebra.projectStatus', icon: 'info' },
    { label: 'Check Python Syntax', command: 'zebra.checkProject', icon: 'check' }
  ],
  Device: [
    { label: 'Detect Serial Port', command: 'zebra.detectSerialPort', icon: 'plug' },
    { label: 'Open Serial Monitor', command: 'zebra.openSerialMonitor', icon: 'terminal' },
    { label: 'Reset Device', command: 'zebra.resetDevice', icon: 'debug-restart' }
  ],
  Upload: [
    { label: 'Deploy Project', command: 'zebra.deployProject', icon: 'cloud-upload' },
    { label: 'Flash Firmware', command: 'zebra.flashFirmware', icon: 'zap' }
  ],
  Toolchain: [
    { label: 'Setup Toolchain', command: 'zebra.setupToolchain', icon: 'tools' },
    { label: 'Open USB Driver Help', command: 'zebra.openDriverHelp', icon: 'link-external' }
  ]
};

export class ZebraExplorerProvider implements vscode.TreeDataProvider<ZebraItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ZebraItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh() { this._onDidChangeTreeData.fire(); }

  getTreeItem(element: ZebraItem): vscode.TreeItem { return element; }

  getChildren(element?: ZebraItem): ZebraItem[] {
    if (!element) {
      return Object.keys(ACTIONS).map(section => new ZebraItem(section, vscode.TreeItemCollapsibleState.Expanded, 'section'));
    }
    const actions = ACTIONS[element.label as string] || [];
    return actions.map(action => ZebraItem.fromAction(action));
  }
}

export class ZebraItem extends vscode.TreeItem {
  constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState, public kind: 'section' | 'action') {
    super(label, collapsibleState);
    this.contextValue = kind;
  }

  static fromAction(action: Action): ZebraItem {
    const item = new ZebraItem(action.label, vscode.TreeItemCollapsibleState.None, 'action');
    item.command = { command: action.command, title: action.label };
    item.iconPath = new vscode.ThemeIcon(action.icon);
    item.description = action.description;
    return item;
  }
}
