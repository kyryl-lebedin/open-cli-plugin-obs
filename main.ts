import { Plugin, Notice, FileSystemAdapter } from "obsidian";
import { exec } from "child_process";
import * as path from "path";

export default class OpenClaudeTerminalPlugin extends Plugin {
  async onload() {
    this.addCommand({
      id: "open-claude-terminal",
      name: "Open Claude in terminal",
      callback: () => this.openTerminal(),
    });
  }

  openTerminal() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active file");
      return;
    }

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("Cannot resolve vault path");
      return;
    }

    const vaultPath = adapter.getBasePath();
    const dirPath = path.join(vaultPath, file.parent?.path ?? "");

    exec(
      `gnome-terminal -- bash -c "cd '${dirPath}' && claude; exec bash"`,
      (err) => {
        if (err) {
          new Notice(`Failed to open terminal: ${err.message}`);
        }
      }
    );
  }
}
