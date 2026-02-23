import { Plugin, Notice, FileSystemAdapter, PluginSettingTab, App, Setting, Modal, TextAreaComponent, TFolder } from "obsidian";
import { exec } from "child_process";
import * as path from "path";

interface PluginSettings {
  enableClaude: boolean;
  enableCursor: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
  enableClaude: true,
  enableCursor: true,
};

export default class OpenClaudeTerminalPlugin extends Plugin {
  settings: PluginSettings;
  claudeCommandId = "open-claude-terminal";
  cursorCommandId = "open-cursor-codebase";

  async onload() {
    await this.loadSettings();
    this.registerCommands();
    this.addSettingTab(new PluginSettingsTab(this.app, this));
  }

  registerCommands() {
    if (this.settings.enableClaude) {
      this.addCommand({
        id: this.claudeCommandId,
        name: "Open Claude in terminal",
        callback: () => this.openClaude(),
      });
    }

    if (this.settings.enableCursor) {
      this.addCommand({
        id: this.cursorCommandId,
        name: "Open codebase in Cursor",
        callback: () => this.openCursor(),
      });
    }

    this.addCommand({
      id: "claude-launcher",
      name: "Claude launcher",
      callback: () => new LauncherModal(this.app, this).open(),
    });
  }

  openClaude() {
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

  openCursor() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active file");
      return;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const codebase = cache?.frontmatter?.codebase;

    if (!codebase) {
      new Notice("No 'codebase' property in frontmatter");
      return;
    }

    exec(`cursor "${codebase}"`, (err) => {
      if (err) {
        new Notice(`Failed to open Cursor: ${err.message}`);
      }
    });
  }

  spawnClaudeWithPrompt(prompt: string) {
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
    const escaped = prompt.replace(/'/g, "'\\''");

    exec(
      `gnome-terminal -- bash -c 'cd "${dirPath}" && claude "${escaped}"; exec bash'`,
      (err) => {
        if (err) {
          new Notice(`Failed to open terminal: ${err.message}`);
        }
      }
    );
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class LauncherModal extends Modal {
  plugin: OpenClaudeTerminalPlugin;

  constructor(app: App, plugin: OpenClaudeTerminalPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Claude Launcher" });

    const btn = contentEl.createEl("button", { text: "Custom prompt" });
    btn.style.cssText = "width:100%;padding:10px;cursor:pointer;font-size:14px;";
    btn.addEventListener("click", () => {
      this.close();
      new PromptInputModal(this.app, this.plugin).open();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class PromptInputModal extends Modal {
  plugin: OpenClaudeTerminalPlugin;
  dropdown: HTMLDivElement | null = null;
  mentionStart = -1;
  selectedIndex = 0;
  filteredFiles: string[] = [];

  constructor(app: App, plugin: OpenClaudeTerminalPlugin) {
    super(app);
    this.plugin = plugin;
  }

  getFilesInFolder(): string[] {
    const file = this.app.workspace.getActiveFile();
    if (!file?.parent) return [];
    const folder = file.parent;
    return folder.children
      .filter((c) => !(c instanceof TFolder))
      .map((c) => c.name);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Enter prompt" });

    const wrapper = contentEl.createDiv();
    wrapper.style.position = "relative";

    const textArea = new TextAreaComponent(wrapper);
    const el = textArea.inputEl;
    el.style.cssText = "width:100%;min-height:100px;font-size:14px;";
    textArea.setPlaceholder("Type your prompt for Claude... (@ to reference files)");

    el.addEventListener("input", () => this.handleInput(el));
    el.addEventListener("keydown", (e) => this.handleKeydown(e, el));

    const submitBtn = contentEl.createEl("button", { text: "Run" });
    submitBtn.style.cssText = "margin-top:10px;padding:8px 20px;cursor:pointer;font-size:14px;";
    submitBtn.addEventListener("click", () => {
      const prompt = textArea.getValue().trim();
      if (!prompt) {
        new Notice("Prompt is empty");
        return;
      }
      this.close();
      this.plugin.spawnClaudeWithPrompt(prompt);
    });
  }

  handleInput(el: HTMLTextAreaElement) {
    const val = el.value;
    const cursor = el.selectionStart;

    // Find the @ before cursor
    const before = val.slice(0, cursor);
    const atIdx = before.lastIndexOf("@");

    if (atIdx === -1 || (atIdx > 0 && before[atIdx - 1] !== " " && before[atIdx - 1] !== "\n")) {
      this.hideDropdown();
      return;
    }

    const query = before.slice(atIdx + 1).toLowerCase();
    const allFiles = this.getFilesInFolder();
    this.filteredFiles = allFiles.filter((f) => f.toLowerCase().includes(query));
    this.mentionStart = atIdx;
    this.selectedIndex = 0;

    if (this.filteredFiles.length === 0) {
      this.hideDropdown();
      return;
    }

    this.showDropdown(el);
  }

  handleKeydown(e: KeyboardEvent, el: HTMLTextAreaElement) {
    if (!this.dropdown) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredFiles.length - 1);
      this.renderDropdownItems();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.renderDropdownItems();
    } else if (e.key === "Tab" || e.key === "Enter") {
      if (this.filteredFiles.length > 0) {
        e.preventDefault();
        this.selectItem(el, this.filteredFiles[this.selectedIndex]);
      }
    } else if (e.key === "Escape") {
      this.hideDropdown();
    }
  }

  selectItem(el: HTMLTextAreaElement, fileName: string) {
    const cursor = el.selectionStart;
    const before = el.value.slice(0, this.mentionStart);
    const after = el.value.slice(cursor);
    el.value = before + "@" + fileName + " " + after;
    const newCursor = before.length + 1 + fileName.length + 1;
    el.selectionStart = el.selectionEnd = newCursor;
    el.focus();
    this.hideDropdown();
  }

  showDropdown(el: HTMLTextAreaElement) {
    if (!this.dropdown) {
      this.dropdown = el.parentElement!.createDiv();
      this.dropdown.style.cssText =
        "position:absolute;left:0;right:0;background:var(--background-primary);" +
        "border:1px solid var(--background-modifier-border);border-radius:6px;" +
        "max-height:150px;overflow-y:auto;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.2);";
    }
    // Position below textarea
    this.dropdown.style.top = el.offsetTop + el.offsetHeight + 4 + "px";
    this.renderDropdownItems();
  }

  renderDropdownItems() {
    if (!this.dropdown) return;
    this.dropdown.empty();
    const textArea = this.dropdown.parentElement?.querySelector("textarea");

    this.filteredFiles.forEach((f, i) => {
      const item = this.dropdown!.createDiv();
      item.textContent = f;
      item.style.cssText =
        "padding:6px 10px;cursor:pointer;font-size:13px;" +
        (i === this.selectedIndex
          ? "background:var(--interactive-accent);color:var(--text-on-accent);"
          : "");
      item.addEventListener("mouseenter", () => {
        this.selectedIndex = i;
        this.renderDropdownItems();
      });
      item.addEventListener("click", () => {
        if (textArea) this.selectItem(textArea, f);
      });
    });
  }

  hideDropdown() {
    if (this.dropdown) {
      this.dropdown.remove();
      this.dropdown = null;
    }
    this.mentionStart = -1;
    this.filteredFiles = [];
  }

  onClose() {
    this.hideDropdown();
    this.contentEl.empty();
  }
}

class PluginSettingsTab extends PluginSettingTab {
  plugin: OpenClaudeTerminalPlugin;

  constructor(app: App, plugin: OpenClaudeTerminalPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Enable Open Claude")
      .setDesc("Show 'Open Claude in terminal' command")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableClaude).onChange(async (value) => {
          this.plugin.settings.enableClaude = value;
          await this.plugin.saveSettings();
          new Notice("Reload Obsidian to apply command changes");
        })
      );

    new Setting(containerEl)
      .setName("Enable Open in Cursor")
      .setDesc("Show 'Open codebase in Cursor' command")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableCursor).onChange(async (value) => {
          this.plugin.settings.enableCursor = value;
          await this.plugin.saveSettings();
          new Notice("Reload Obsidian to apply command changes");
        })
      );
  }
}
