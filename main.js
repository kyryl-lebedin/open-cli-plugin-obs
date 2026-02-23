var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => OpenClaudeTerminalPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_child_process = require("child_process");
var path = __toESM(require("path"));
var DEFAULT_SETTINGS = {
  enableClaude: true,
  enableCursor: true
};
var OpenClaudeTerminalPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.claudeCommandId = "open-claude-terminal";
    this.cursorCommandId = "open-cursor-codebase";
  }
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
        callback: () => this.openClaude()
      });
    }
    if (this.settings.enableCursor) {
      this.addCommand({
        id: this.cursorCommandId,
        name: "Open codebase in Cursor",
        callback: () => this.openCursor()
      });
    }
    this.addCommand({
      id: "claude-launcher",
      name: "Claude launcher",
      callback: () => new LauncherModal(this.app, this).open()
    });
  }
  openClaude() {
    var _a, _b;
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new import_obsidian.Notice("No active file");
      return;
    }
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof import_obsidian.FileSystemAdapter)) {
      new import_obsidian.Notice("Cannot resolve vault path");
      return;
    }
    const vaultPath = adapter.getBasePath();
    const dirPath = path.join(vaultPath, (_b = (_a = file.parent) == null ? void 0 : _a.path) != null ? _b : "");
    (0, import_child_process.exec)(
      `gnome-terminal -- bash -c "cd '${dirPath}' && claude; exec bash"`,
      (err) => {
        if (err) {
          new import_obsidian.Notice(`Failed to open terminal: ${err.message}`);
        }
      }
    );
  }
  openCursor() {
    var _a;
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new import_obsidian.Notice("No active file");
      return;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const codebase = (_a = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _a.codebase;
    if (!codebase) {
      new import_obsidian.Notice("No 'codebase' property in frontmatter");
      return;
    }
    (0, import_child_process.exec)(`cursor "${codebase}"`, (err) => {
      if (err) {
        new import_obsidian.Notice(`Failed to open Cursor: ${err.message}`);
      }
    });
  }
  spawnClaudeWithPrompt(prompt) {
    var _a, _b;
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new import_obsidian.Notice("No active file");
      return;
    }
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof import_obsidian.FileSystemAdapter)) {
      new import_obsidian.Notice("Cannot resolve vault path");
      return;
    }
    const vaultPath = adapter.getBasePath();
    const dirPath = path.join(vaultPath, (_b = (_a = file.parent) == null ? void 0 : _a.path) != null ? _b : "");
    const escaped = prompt.replace(/'/g, "'\\''");
    (0, import_child_process.exec)(
      `gnome-terminal -- bash -c 'cd "${dirPath}" && claude "${escaped}"; exec bash'`,
      (err) => {
        if (err) {
          new import_obsidian.Notice(`Failed to open terminal: ${err.message}`);
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
};
var LauncherModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
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
};
var PromptInputModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.dropdown = null;
    this.mentionStart = -1;
    this.selectedIndex = 0;
    this.filteredFiles = [];
    this.plugin = plugin;
  }
  getFilesInFolder() {
    const file = this.app.workspace.getActiveFile();
    if (!(file == null ? void 0 : file.parent)) return [];
    const folder = file.parent;
    return folder.children.filter((c) => !(c instanceof import_obsidian.TFolder)).map((c) => c.name);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Enter prompt" });
    const wrapper = contentEl.createDiv();
    wrapper.style.position = "relative";
    const textArea = new import_obsidian.TextAreaComponent(wrapper);
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
        new import_obsidian.Notice("Prompt is empty");
        return;
      }
      this.close();
      this.plugin.spawnClaudeWithPrompt(prompt);
    });
  }
  handleInput(el) {
    const val = el.value;
    const cursor = el.selectionStart;
    const before = val.slice(0, cursor);
    const atIdx = before.lastIndexOf("@");
    if (atIdx === -1 || atIdx > 0 && before[atIdx - 1] !== " " && before[atIdx - 1] !== "\n") {
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
  handleKeydown(e, el) {
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
  selectItem(el, fileName) {
    const cursor = el.selectionStart;
    const before = el.value.slice(0, this.mentionStart);
    const after = el.value.slice(cursor);
    el.value = before + "@" + fileName + " " + after;
    const newCursor = before.length + 1 + fileName.length + 1;
    el.selectionStart = el.selectionEnd = newCursor;
    el.focus();
    this.hideDropdown();
  }
  showDropdown(el) {
    if (!this.dropdown) {
      this.dropdown = el.parentElement.createDiv();
      this.dropdown.style.cssText = "position:absolute;left:0;right:0;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:6px;max-height:150px;overflow-y:auto;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.2);";
    }
    this.dropdown.style.top = el.offsetTop + el.offsetHeight + 4 + "px";
    this.renderDropdownItems();
  }
  renderDropdownItems() {
    var _a;
    if (!this.dropdown) return;
    this.dropdown.empty();
    const textArea = (_a = this.dropdown.parentElement) == null ? void 0 : _a.querySelector("textarea");
    this.filteredFiles.forEach((f, i) => {
      const item = this.dropdown.createDiv();
      item.textContent = f;
      item.style.cssText = "padding:6px 10px;cursor:pointer;font-size:13px;" + (i === this.selectedIndex ? "background:var(--interactive-accent);color:var(--text-on-accent);" : "");
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
};
var PluginSettingsTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Enable Open Claude").setDesc("Show 'Open Claude in terminal' command").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableClaude).onChange(async (value) => {
        this.plugin.settings.enableClaude = value;
        await this.plugin.saveSettings();
        new import_obsidian.Notice("Reload Obsidian to apply command changes");
      })
    );
    new import_obsidian.Setting(containerEl).setName("Enable Open in Cursor").setDesc("Show 'Open codebase in Cursor' command").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableCursor).onChange(async (value) => {
        this.plugin.settings.enableCursor = value;
        await this.plugin.saveSettings();
        new import_obsidian.Notice("Reload Obsidian to apply command changes");
      })
    );
  }
};
