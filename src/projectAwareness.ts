import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export type ZebraProjectStatus = {
  root: string;
  valid: boolean;
  hasMain: boolean;
  hasUserMain: boolean;
  hasRobotDir: boolean;
  hasZebraJson: boolean;
  problems: string[];
};

export function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function inspectZebraProject(root: string): ZebraProjectStatus {
  const hasMain = fs.existsSync(path.join(root, "main.py"));
  const hasUserMain = fs.existsSync(path.join(root, "user_main.py"));
  const hasRobotDir = fs.existsSync(path.join(root, "robot"));
  const hasZebraJson = fs.existsSync(path.join(root, "zebra.json"));

  const problems: string[] = [];

  if (!hasMain && !hasUserMain) {
    problems.push("Missing main.py or user_main.py");
  }

  if (!hasRobotDir) {
    problems.push("Missing robot/ driver directory");
  }

  if (!hasZebraJson) {
    problems.push("Missing zebra.json project config");
  }

  return {
    root,
    valid: problems.length === 0,
    hasMain,
    hasUserMain,
    hasRobotDir,
    hasZebraJson,
    problems
  };
}

export async function requireValidZebraProject(): Promise<string | undefined> {
  const root = getWorkspaceRoot();

  if (!root) {
    vscode.window.showErrorMessage("Open a Zebra project folder first.");
    return undefined;
  }

  const status = inspectZebraProject(root);

  if (status.valid) {
    return root;
  }

  const choice = await vscode.window.showWarningMessage(
    `This does not look like a complete Zebra project:\n${status.problems.join("\n")}`,
    "Initialize Project",
    "Continue Anyway",
    "Cancel"
  );

  if (choice === "Initialize Project") {
    await vscode.commands.executeCommand("zebra.initializeProject");
    return root;
  }

  if (choice === "Continue Anyway") {
    return root;
  }

  return undefined;
}