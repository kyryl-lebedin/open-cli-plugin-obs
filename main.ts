import { Plugin, Notice, FileSystemAdapter, PluginSettingTab, App, Setting, Modal, TextAreaComponent, TFolder } from "obsidian";
import { exec } from "child_process";
import * as path from "path";

interface PromptTemplate {
  id: string;
  name: string;
  prompt: string;
}

interface PluginSettings {
  enableClaude: boolean;
  enableCursor: boolean;
  templates: PromptTemplate[];
}

const DEFAULT_SETTINGS: PluginSettings = {
  enableClaude: true,
  enableCursor: true,
  templates: [],
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

  async spawnClaudeWithPrompt(prompt: string) {
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

    // Resolve placeholders
    const resolved = await this.resolvePlaceholders(prompt, file);

    const vaultPath = adapter.getBasePath();
    const dirPath = path.join(vaultPath, file.parent?.path ?? "");
    const escaped = resolved.replace(/'/g, "'\\''");

    exec(
      `gnome-terminal -- bash -c 'cd "${dirPath}" && claude "${escaped}"; exec bash'`,
      (err) => {
        if (err) {
          new Notice(`Failed to open terminal: ${err.message}`);
        }
      }
    );
  }

  async resolvePlaceholders(prompt: string, file: import("obsidian").TFile): Promise<string> {
    let result = prompt;
    const title = file.basename;

    if (result.includes("{{note}}")) {
      const content = await this.app.vault.read(file);
      const noteText = `${title}\n\n${content}`;
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
}

// --- Reusable @ autocomplete for any textarea ---
function getFilesInFolder(app: App): string[] {
  const file = app.workspace.getActiveFile();
  if (!file?.parent) return [];
  return file.parent.children
    .filter((c) => !(c instanceof TFolder))
    .map((c) => c.name);
}

interface MentionState {
  dropdown: HTMLDivElement | null;
  mentionStart: number;
  selectedIndex: number;
  filteredFiles: string[];
}

function attachMentionAutocomplete(app: App, wrapper: HTMLDivElement, el: HTMLTextAreaElement) {
  const state: MentionState = { dropdown: null, mentionStart: -1, selectedIndex: 0, filteredFiles: [] };

  function hideDropdown() {
    if (state.dropdown) {
      state.dropdown.remove();
      state.dropdown = null;
    }
    state.mentionStart = -1;
    state.filteredFiles = [];
  }

  function selectItem(fileName: string) {
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
      const item = state.dropdown!.createDiv();
      item.textContent = f;
      item.style.cssText =
        "padding:6px 10px;cursor:pointer;font-size:13px;" +
        (i === state.selectedIndex
          ? "background:var(--interactive-accent);color:var(--text-on-accent);"
          : "");
      item.addEventListener("mouseenter", () => { state.selectedIndex = i; renderItems(); });
      item.addEventListener("click", () => selectItem(f));
    });
  }

  function showDropdown() {
    if (!state.dropdown) {
      state.dropdown = wrapper.createDiv();
      state.dropdown.style.cssText =
        "position:absolute;left:0;right:0;background:var(--background-primary);" +
        "border:1px solid var(--background-modifier-border);border-radius:6px;" +
        "max-height:150px;overflow-y:auto;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.2);";
    }
    state.dropdown.style.top = el.offsetTop + el.offsetHeight + 4 + "px";
    renderItems();
  }

  el.addEventListener("input", () => {
    const before = el.value.slice(0, el.selectionStart);
    const atIdx = before.lastIndexOf("@");
    if (atIdx === -1 || (atIdx > 0 && before[atIdx - 1] !== " " && before[atIdx - 1] !== "\n")) {
      hideDropdown();
      return;
    }
    const query = before.slice(atIdx + 1).toLowerCase();
    state.filteredFiles = getFilesInFolder(app).filter((f) => f.toLowerCase().includes(query));
    state.mentionStart = atIdx;
    state.selectedIndex = 0;
    if (state.filteredFiles.length === 0) { hideDropdown(); return; }
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
      if (state.filteredFiles.length > 0) { e.preventDefault(); selectItem(state.filteredFiles[state.selectedIndex]); }
    } else if (e.key === "Escape") {
      hideDropdown();
    }
  });

  return { hideDropdown };
}

// --- Helper to create a textarea with @ autocomplete inside a container ---
function createPromptTextArea(app: App, container: HTMLElement, placeholder: string, initialValue?: string): { textArea: TextAreaComponent; cleanup: () => void } {
  const wrapper = container.createDiv();
  wrapper.style.position = "relative";
  const textArea = new TextAreaComponent(wrapper);
  textArea.inputEl.style.cssText = "width:100%;min-height:80px;font-size:14px;";
  textArea.setPlaceholder(placeholder);
  if (initialValue) textArea.setValue(initialValue);
  const { hideDropdown } = attachMentionAutocomplete(app, wrapper, textArea.inputEl);
  return { textArea, cleanup: hideDropdown };
}

class LauncherModal extends Modal {
  plugin: OpenClaudeTerminalPlugin;

  constructor(app: App, plugin: OpenClaudeTerminalPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Claude Launcher" });

    // Custom prompt button
    const list = contentEl.createDiv();
    const customBtn = list.createEl("button", { text: "Custom prompt" });
    customBtn.style.cssText = "width:100%;padding:10px;cursor:pointer;font-size:14px;margin-bottom:6px;";
    customBtn.addEventListener("click", () => {
      this.close();
      new PromptInputModal(this.app, this.plugin).open();
    });

    // Saved templates
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

      const delBtn = row.createEl("button", { text: "\u00D7" });
      delBtn.style.cssText = "padding:6px 10px;cursor:pointer;font-size:14px;color:var(--text-error);";
      delBtn.title = "Delete template";
      delBtn.addEventListener("click", async () => {
        this.plugin.settings.templates = this.plugin.settings.templates.filter((t) => t.id !== tpl.id);
        await this.plugin.saveSettings();
        this.render();
      });
    }

    // Add template button at the bottom
    const addBtn = contentEl.createEl("button", { text: "+ Add template" });
    addBtn.style.cssText = "width:100%;padding:10px;cursor:pointer;font-size:14px;margin-top:6px;opacity:0.7;";
    addBtn.addEventListener("click", () => {
      this.close();
      new AddTemplateOptionsModal(this.app, this.plugin).open();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class AddTemplateOptionsModal extends Modal {
  plugin: OpenClaudeTerminalPlugin;

  constructor(app: App, plugin: OpenClaudeTerminalPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const backBtn = contentEl.createEl("button", { text: "\u2190 Back" });
    backBtn.style.cssText = "padding:4px 12px;cursor:pointer;font-size:13px;margin-bottom:10px;";
    backBtn.addEventListener("click", () => {
      this.close();
      new LauncherModal(this.app, this.plugin).open();
    });

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
}

class AddTemplateModal extends Modal {
  plugin: OpenClaudeTerminalPlugin;

  constructor(app: App, plugin: OpenClaudeTerminalPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const backBtn = contentEl.createEl("button", { text: "\u2190 Back" });
    backBtn.style.cssText = "padding:4px 12px;cursor:pointer;font-size:13px;margin-bottom:10px;";
    backBtn.addEventListener("click", () => {
      this.close();
      new LauncherModal(this.app, this.plugin).open();
    });

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
        new Notice("Name and prompt are required");
        return;
      }
      this.plugin.settings.templates.push({
        id: Date.now().toString(),
        name,
        prompt,
      });
      await this.plugin.saveSettings();
      this.close();
      new LauncherModal(this.app, this.plugin).open();
    });
  }

  cleanupFn: (() => void) | null = null;

  onClose() {
    this.cleanupFn?.();
    this.contentEl.empty();
  }
}

class EditTemplateModal extends Modal {
  plugin: OpenClaudeTerminalPlugin;
  template: PromptTemplate;

  constructor(app: App, plugin: OpenClaudeTerminalPlugin, template: PromptTemplate) {
    super(app);
    this.plugin = plugin;
    this.template = template;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const backBtn = contentEl.createEl("button", { text: "\u2190 Back" });
    backBtn.style.cssText = "padding:4px 12px;cursor:pointer;font-size:13px;margin-bottom:10px;";
    backBtn.addEventListener("click", () => {
      this.close();
      new LauncherModal(this.app, this.plugin).open();
    });

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
        new Notice("Name and prompt are required");
        return;
      }
      this.template.name = name;
      this.template.prompt = prompt;
      await this.plugin.saveSettings();
      this.close();
      new LauncherModal(this.app, this.plugin).open();
    });
  }

  cleanupFn: (() => void) | null = null;

  onClose() {
    this.cleanupFn?.();
    this.contentEl.empty();
  }
}

class PromptInputModal extends Modal {
  plugin: OpenClaudeTerminalPlugin;
  cleanupFn: (() => void) | null = null;

  constructor(app: App, plugin: OpenClaudeTerminalPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    const backBtn = contentEl.createEl("button", { text: "\u2190 Back" });
    backBtn.style.cssText = "padding:4px 12px;cursor:pointer;font-size:13px;margin-bottom:10px;";
    backBtn.addEventListener("click", () => {
      this.close();
      new LauncherModal(this.app, this.plugin).open();
    });

    contentEl.createEl("h3", { text: "Enter prompt" });

    const { textArea, cleanup } = createPromptTextArea(this.app, contentEl, "Type your prompt... (@ for files, {{title}} / {{note}} for current note)");
    textArea.inputEl.style.minHeight = "100px";
    this.cleanupFn = cleanup;

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

  onClose() {
    this.cleanupFn?.();
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
