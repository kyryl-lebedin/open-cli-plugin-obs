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
  enableCursor: true,
  templates: []
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
  async spawnClaudeWithPrompt(prompt) {
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
    const resolved = await this.resolvePlaceholders(prompt, file);
    const vaultPath = adapter.getBasePath();
    const dirPath = path.join(vaultPath, (_b = (_a = file.parent) == null ? void 0 : _a.path) != null ? _b : "");
    const escaped = resolved.replace(/'/g, "'\\''");
    (0, import_child_process.exec)(
      `gnome-terminal -- bash -c 'cd "${dirPath}" && claude "${escaped}"; exec bash'`,
      (err) => {
        if (err) {
          new import_obsidian.Notice(`Failed to open terminal: ${err.message}`);
        }
      }
    );
  }
  async resolvePlaceholders(prompt, file) {
    let result = prompt;
    const title = file.basename;
    if (result.includes("{{note}}")) {
      const content = await this.app.vault.read(file);
      const noteText = `${title}

${content}`;
      result = result.replace(/\{\{note\}\}/g, noteText);
    }
    result = result.replace(/\{\{title\}\}/g, title);
    return result;
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
function getFilesInFolder(app) {
  const file = app.workspace.getActiveFile();
  if (!(file == null ? void 0 : file.parent)) return [];
  return file.parent.children.filter((c) => !(c instanceof import_obsidian.TFolder)).map((c) => c.name);
}
function attachMentionAutocomplete(app, wrapper, el) {
  const state = { dropdown: null, mentionStart: -1, selectedIndex: 0, filteredFiles: [] };
  function hideDropdown() {
    if (state.dropdown) {
      state.dropdown.remove();
      state.dropdown = null;
    }
    state.mentionStart = -1;
    state.filteredFiles = [];
  }
  function selectItem(fileName) {
    const cursor = el.selectionStart;
    const before = el.value.slice(0, state.mentionStart);
    const after = el.value.slice(cursor);
    el.value = before + "@" + fileName + " " + after;
    const newCursor = before.length + 1 + fileName.length + 1;
    el.selectionStart = el.selectionEnd = newCursor;
    el.focus();
    hideDropdown();
  }
  function renderItems() {
    if (!state.dropdown) return;
    state.dropdown.empty();
    state.filteredFiles.forEach((f, i) => {
      const item = state.dropdown.createDiv();
      item.textContent = f;
      item.style.cssText = "padding:6px 10px;cursor:pointer;font-size:13px;" + (i === state.selectedIndex ? "background:var(--interactive-accent);color:var(--text-on-accent);" : "");
      item.addEventListener("mouseenter", () => {
        state.selectedIndex = i;
        renderItems();
      });
      item.addEventListener("click", () => selectItem(f));
    });
  }
  function showDropdown() {
    if (!state.dropdown) {
      state.dropdown = wrapper.createDiv();
      state.dropdown.style.cssText = "position:absolute;left:0;right:0;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:6px;max-height:150px;overflow-y:auto;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.2);";
    }
    state.dropdown.style.top = el.offsetTop + el.offsetHeight + 4 + "px";
    renderItems();
  }
  el.addEventListener("input", () => {
    const before = el.value.slice(0, el.selectionStart);
    const atIdx = before.lastIndexOf("@");
    if (atIdx === -1 || atIdx > 0 && before[atIdx - 1] !== " " && before[atIdx - 1] !== "\n") {
      hideDropdown();
      return;
    }
    const query = before.slice(atIdx + 1).toLowerCase();
    state.filteredFiles = getFilesInFolder(app).filter((f) => f.toLowerCase().includes(query));
    state.mentionStart = atIdx;
    state.selectedIndex = 0;
    if (state.filteredFiles.length === 0) {
      hideDropdown();
      return;
    }
    showDropdown();
  });
  el.addEventListener("keydown", (e) => {
    if (!state.dropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      state.selectedIndex = Math.min(state.selectedIndex + 1, state.filteredFiles.length - 1);
      renderItems();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      state.selectedIndex = Math.max(state.selectedIndex - 1, 0);
      renderItems();
    } else if (e.key === "Tab" || e.key === "Enter") {
      if (state.filteredFiles.length > 0) {
        e.preventDefault();
        selectItem(state.filteredFiles[state.selectedIndex]);
      }
    } else if (e.key === "Escape") {
      hideDropdown();
    }
  });
  return { hideDropdown };
}
function createPromptTextArea(app, container, placeholder, initialValue) {
  const wrapper = container.createDiv();
  wrapper.style.position = "relative";
  const textArea = new import_obsidian.TextAreaComponent(wrapper);
  textArea.inputEl.style.cssText = "width:100%;min-height:80px;font-size:14px;";
  textArea.setPlaceholder(placeholder);
  if (initialValue) textArea.setValue(initialValue);
  const { hideDropdown } = attachMentionAutocomplete(app, wrapper, textArea.inputEl);
  return { textArea, cleanup: hideDropdown };
}
var LauncherModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    this.render();
  }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    const header = contentEl.createDiv();
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;";
    header.createEl("h3", { text: "Claude Launcher" }).style.margin = "0";
    const addBtn = header.createEl("button", { text: "+" });
    addBtn.style.cssText = "font-size:18px;width:32px;height:32px;cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:6px;";
    addBtn.addEventListener("click", () => {
      this.close();
      new AddTemplateOptionsModal(this.app, this.plugin).open();
    });
    const list = contentEl.createDiv();
    const customBtn = list.createEl("button", { text: "Custom prompt" });
    customBtn.style.cssText = "width:100%;padding:10px;cursor:pointer;font-size:14px;margin-bottom:6px;";
    customBtn.addEventListener("click", () => {
      this.close();
      new PromptInputModal(this.app, this.plugin).open();
    });
    for (const tpl of this.plugin.settings.templates) {
      const row = list.createDiv();
      row.style.cssText = "display:flex;align-items:center;gap:4px;margin-bottom:6px;";
      const tplBtn = row.createEl("button", { text: tpl.name });
      tplBtn.style.cssText = "flex:1;padding:10px;cursor:pointer;font-size:14px;text-align:left;";
      tplBtn.addEventListener("click", () => {
        this.close();
        this.plugin.spawnClaudeWithPrompt(tpl.prompt);
      });
      const editBtn = row.createEl("button", { text: "\u270E" });
      editBtn.style.cssText = "padding:6px 10px;cursor:pointer;font-size:14px;";
      editBtn.title = "Edit template";
      editBtn.addEventListener("click", () => {
        this.close();
        new EditTemplateModal(this.app, this.plugin, tpl).open();
      });
      const delBtn = row.createEl("button", { text: "\xD7" });
      delBtn.style.cssText = "padding:6px 10px;cursor:pointer;font-size:14px;color:var(--text-error);";
      delBtn.title = "Delete template";
      delBtn.addEventListener("click", async () => {
        this.plugin.settings.templates = this.plugin.settings.templates.filter((t) => t.id !== tpl.id);
        await this.plugin.saveSettings();
        this.render();
      });
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};
var AddTemplateOptionsModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Add new..." });
    const btn = contentEl.createEl("button", { text: "Fixed prompt template" });
    btn.style.cssText = "width:100%;padding:10px;cursor:pointer;font-size:14px;";
    btn.addEventListener("click", () => {
      this.close();
      new AddTemplateModal(this.app, this.plugin).open();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var AddTemplateModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.cleanupFn = null;
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "New prompt template" });
    contentEl.createEl("label", { text: "Name" }).style.cssText = "font-size:13px;font-weight:600;";
    const nameInput = contentEl.createEl("input", { type: "text" });
    nameInput.style.cssText = "width:100%;padding:8px;font-size:14px;margin-bottom:10px;";
    nameInput.placeholder = "Template name";
    contentEl.createEl("label", { text: "Prompt" }).style.cssText = "font-size:13px;font-weight:600;";
    const { textArea: promptArea, cleanup } = createPromptTextArea(this.app, contentEl, "Enter the prompt... (@ to reference files)");
    this.cleanupFn = cleanup;
    const saveBtn = contentEl.createEl("button", { text: "Save" });
    saveBtn.style.cssText = "margin-top:10px;padding:8px 20px;cursor:pointer;font-size:14px;";
    saveBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const prompt = promptArea.getValue().trim();
      if (!name || !prompt) {
        new import_obsidian.Notice("Name and prompt are required");
        return;
      }
      this.plugin.settings.templates.push({
        id: Date.now().toString(),
        name,
        prompt
      });
      await this.plugin.saveSettings();
      this.close();
      new LauncherModal(this.app, this.plugin).open();
    });
  }
  onClose() {
    var _a;
    (_a = this.cleanupFn) == null ? void 0 : _a.call(this);
    this.contentEl.empty();
  }
};
var EditTemplateModal = class extends import_obsidian.Modal {
  constructor(app, plugin, template) {
    super(app);
    this.cleanupFn = null;
    this.plugin = plugin;
    this.template = template;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Edit template" });
    contentEl.createEl("label", { text: "Name" }).style.cssText = "font-size:13px;font-weight:600;";
    const nameInput = contentEl.createEl("input", { type: "text" });
    nameInput.style.cssText = "width:100%;padding:8px;font-size:14px;margin-bottom:10px;";
    nameInput.value = this.template.name;
    contentEl.createEl("label", { text: "Prompt" }).style.cssText = "font-size:13px;font-weight:600;";
    const { textArea: promptArea, cleanup } = createPromptTextArea(this.app, contentEl, "Enter the prompt... (@ to reference files)", this.template.prompt);
    this.cleanupFn = cleanup;
    const saveBtn = contentEl.createEl("button", { text: "Save" });
    saveBtn.style.cssText = "margin-top:10px;padding:8px 20px;cursor:pointer;font-size:14px;";
    saveBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const prompt = promptArea.getValue().trim();
      if (!name || !prompt) {
        new import_obsidian.Notice("Name and prompt are required");
        return;
      }
      this.template.name = name;
      this.template.prompt = prompt;
      await this.plugin.saveSettings();
      this.close();
      new LauncherModal(this.app, this.plugin).open();
    });
  }
  onClose() {
    var _a;
    (_a = this.cleanupFn) == null ? void 0 : _a.call(this);
    this.contentEl.empty();
  }
};
var PromptInputModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.cleanupFn = null;
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Enter prompt" });
    const { textArea, cleanup } = createPromptTextArea(this.app, contentEl, "Type your prompt... (@ for files, {{title}} / {{note}} for current note)");
    textArea.inputEl.style.minHeight = "100px";
    this.cleanupFn = cleanup;
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
  onClose() {
    var _a;
    (_a = this.cleanupFn) == null ? void 0 : _a.call(this);
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
