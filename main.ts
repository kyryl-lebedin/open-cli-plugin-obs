import { Plugin, Notice, FileSystemAdapter, PluginSettingTab, App, Setting, Modal, TextAreaComponent, TFolder } from "obsidian";
import { exec } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const PERMISSION_MODES = ["default", "plan", "acceptEdits", "bypassPermissions"] as const;
type PermissionMode = typeof PERMISSION_MODES[number];

interface PromptTemplate {
  id: string;
  name: string;
  prompt: string;
  global: boolean;
}

interface PluginSettings {
  enableClaude: boolean;
  enableCursor: boolean;
  enableLauncher: boolean;
  templates: PromptTemplate[];
}

const DEFAULT_SETTINGS: PluginSettings = {
  enableClaude: true,
  enableCursor: true,
  enableLauncher: true,
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

    if (this.settings.enableLauncher) {
      this.addCommand({
        id: "claude-launcher",
        name: "Claude launcher",
        callback: () => new LauncherModal(this.app, this).open(),
      });
    }
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

  async spawnClaudeWithPrompt(prompt: string, permissionMode: PermissionMode = "default") {
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

    // Write prompt to temp file, then write a launcher script
    // that reads it safely via variable assignment (no shell reinterpretation)
    const ts = Date.now();
    const tmpPrompt = path.join(os.tmpdir(), `claude-prompt-${ts}.txt`);
    const tmpScript = path.join(os.tmpdir(), `claude-launch-${ts}.sh`);

    fs.writeFileSync(tmpPrompt, resolved, "utf-8");
    fs.writeFileSync(tmpScript, [
      "#!/bin/bash",
      `cd "${dirPath.replace(/"/g, '\\"')}"`,
      `prompt=$(cat "${tmpPrompt.replace(/"/g, '\\"')}")`,
      `rm -f "${tmpPrompt.replace(/"/g, '\\"')}" "${tmpScript.replace(/"/g, '\\"')}"`,
      `claude${permissionMode !== "default" ? ` --permission-mode ${permissionMode}` : ""} "$prompt"`,
      `exec bash`,
    ].join("\n"), "utf-8");
    fs.chmodSync(tmpScript, "755");

    exec(`gnome-terminal -- bash "${tmpScript}"`, (err) => {
      if (err) {
        new Notice(`Failed to open terminal: ${err.message}`);
      }
    });
  }

  async runClaudeHeadless(prompt: string, permissionMode: PermissionMode = "default") {
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

    const resolved = await this.resolvePlaceholders(prompt, file);
    const vaultPath = adapter.getBasePath();
    const dirPath = path.join(vaultPath, file.parent?.path ?? "");

    new Notice("Running Claude headless...");

    const ts = Date.now();
    const tmpPrompt = path.join(os.tmpdir(), `claude-prompt-${ts}.txt`);
    const tmpOutput = path.join(os.tmpdir(), `claude-output-${ts}.txt`);
    const tmpScript = path.join(os.tmpdir(), `claude-headless-${ts}.sh`);

    fs.writeFileSync(tmpPrompt, resolved, "utf-8");
    fs.writeFileSync(tmpScript, [
      "#!/bin/bash",
      `source ~/.bashrc 2>/dev/null || source ~/.profile 2>/dev/null || true`,
      `export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node/ 2>/dev/null | tail -1)/bin:$PATH"`,
      `cd "${dirPath.replace(/"/g, '\\"')}"`,
      `cat "${tmpPrompt.replace(/"/g, '\\"')}" | claude -p${permissionMode !== "default" ? ` --permission-mode ${permissionMode}` : ""} > "${tmpOutput.replace(/"/g, '\\"')}" 2>&1`,
      `rm -f "${tmpPrompt.replace(/"/g, '\\"')}" "${tmpScript.replace(/"/g, '\\"')}"`,
    ].join("\n"), "utf-8");
    fs.chmodSync(tmpScript, "755");

    const self = this;
    const sourceFile = file;
    const resolvedPrompt = resolved;

    exec(`bash "${tmpScript}"`, { maxBuffer: 10 * 1024 * 1024, timeout: 300000 }, (err) => {
      // Wrap async work to avoid swallowed promise rejections
      (async () => {
        try {
          let response = "";
          try {
            response = fs.readFileSync(tmpOutput, "utf-8").trim();
            fs.unlinkSync(tmpOutput);
          } catch {
            // file doesn't exist or can't be read
          }

          if (!response && err) {
            response = `Error: ${err.message}`;
          } else if (!response) {
            response = "No output from Claude";
          }

          // Create response note with unique name
          const words = prompt.split(/\s+/).filter(Boolean);
          const slug = words.slice(0, 5).join(" ") + (words.length > 5 ? "..." : "");
          const safeSlug = slug.replace(/[\\/:*?"<>|#^[\]]/g, "").trim();
          const ts = Date.now();
          const noteName = `claude - ${safeSlug} ${ts}`;
          const noteContent = `**User:** ${resolvedPrompt}\n\n**Response:** ${response}`;
          const folderPath = sourceFile.parent?.path ?? "";
          const notePath = folderPath ? `${folderPath}/${noteName}.md` : `${noteName}.md`;

          await self.app.vault.create(notePath, noteContent);

          // Append wiki link to source note
          const currentContent = await self.app.vault.read(sourceFile);
          await self.app.vault.modify(sourceFile, currentContent + `\n[[${noteName}]]`);

          new Notice("Claude response saved");
        } catch (e: any) {
          new Notice(`Headless error: ${e.message}`);
        }
      })();
    });
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

// --- Helper to create header with back button ---
function createHeaderWithBack(container: HTMLElement, title: string, onBack: () => void) {
  const header = container.createDiv();
  header.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px;";
  const backBtn = header.createEl("button", { text: "\u2190" });
  backBtn.style.cssText = "padding:4px 10px;cursor:pointer;font-size:16px;line-height:1;border-radius:4px;";
  backBtn.addEventListener("click", onBack);
  header.createEl("h3", { text: title }).style.margin = "0";
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

  headless = false;
  permissionMode: PermissionMode = "default";

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

    // Saved templates — filter by visibility
    const file = this.app.workspace.getActiveFile();
    const frontmatterAgents = this.getAgentsFromFrontmatter(file);
    const visibleTemplates = this.plugin.settings.templates.filter((tpl) => {
      if (tpl.global) return true;
      return frontmatterAgents.includes(tpl.name);
    });

    for (const tpl of visibleTemplates) {
      const row = list.createDiv();
      row.style.cssText = "display:flex;align-items:center;gap:4px;margin-bottom:6px;";

      const tplBtn = row.createEl("button", { text: tpl.name });
      tplBtn.style.cssText = "flex:1;padding:10px;cursor:pointer;font-size:14px;text-align:left;";
      tplBtn.addEventListener("click", () => {
        this.close();
        if (this.headless) {
          this.plugin.runClaudeHeadless(tpl.prompt, this.permissionMode);
        } else {
          this.plugin.spawnClaudeWithPrompt(tpl.prompt, this.permissionMode);
        }
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

    // Bottom row: add template + headless toggle
    const bottomRow = contentEl.createDiv();
    bottomRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:10px;";

    const addBtn = bottomRow.createEl("button", { text: "+ Add template" });
    addBtn.style.cssText = "flex:1;padding:10px;cursor:pointer;font-size:14px;opacity:0.7;";
    addBtn.addEventListener("click", () => {
      this.close();
      new AddTemplateOptionsModal(this.app, this.plugin).open();
    });

    const headlessBtn = bottomRow.createEl("button", { text: "Headless" });
    headlessBtn.style.cssText = "padding:8px 16px;cursor:pointer;font-size:13px;border-radius:4px;" +
      (this.headless ? "opacity:1;background:var(--interactive-accent);color:var(--text-on-accent);" : "opacity:0.5;");
    headlessBtn.addEventListener("click", () => {
      this.headless = !this.headless;
      headlessBtn.style.opacity = this.headless ? "1" : "0.5";
      headlessBtn.style.background = this.headless ? "var(--interactive-accent)" : "";
      headlessBtn.style.color = this.headless ? "var(--text-on-accent)" : "";
    });

    const modeSelect = bottomRow.createEl("select");
    modeSelect.style.cssText = "padding:6px 10px;font-size:13px;border-radius:4px;cursor:pointer;";
    for (const mode of PERMISSION_MODES) {
      const opt = modeSelect.createEl("option", { text: mode, value: mode });
      if (mode === this.permissionMode) opt.selected = true;
    }
    modeSelect.addEventListener("change", () => {
      this.permissionMode = modeSelect.value as PermissionMode;
    });
  }

  getAgentsFromFrontmatter(file: import("obsidian").TFile | null): string[] {
    if (!file) return [];
    const cache = this.app.metadataCache.getFileCache(file);
    const agents = cache?.frontmatter?.agents;
    if (!agents) return [];
    if (Array.isArray(agents)) return agents.map((a: any) => String(a).trim());
    if (typeof agents === "string") return agents.split(",").map((a) => a.trim()).filter(Boolean);
    return [];
  }

  onClose() {
    this.contentEl.empty();
  }
}

class AddTemplateOptionsModal extends Modal {
  plugin: OpenClaudeTerminalPlugin;
  onBackOverride: (() => void) | null;

  constructor(app: App, plugin: OpenClaudeTerminalPlugin, onBack?: () => void) {
    super(app);
    this.plugin = plugin;
    this.onBackOverride = onBack ?? null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    createHeaderWithBack(contentEl, "Add new...", () => {
      this.close();
      if (this.onBackOverride) {
        this.onBackOverride();
      } else {
        new LauncherModal(this.app, this.plugin).open();
      }
    });

    const btn = contentEl.createEl("button", { text: "Fixed prompt template" });
    btn.style.cssText = "width:100%;padding:10px;cursor:pointer;font-size:14px;";
    btn.addEventListener("click", () => {
      this.close();
      new AddTemplateModal(this.app, this.plugin, this.onBackOverride ?? undefined).open();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class AddTemplateModal extends Modal {
  plugin: OpenClaudeTerminalPlugin;
  onBackOverride: (() => void) | null;

  constructor(app: App, plugin: OpenClaudeTerminalPlugin, onBack?: () => void) {
    super(app);
    this.plugin = plugin;
    this.onBackOverride = onBack ?? null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    createHeaderWithBack(contentEl, "New prompt template", () => {
      this.close();
      if (this.onBackOverride) {
        this.onBackOverride();
      } else {
        new LauncherModal(this.app, this.plugin).open();
      }
    });

    contentEl.createEl("label", { text: "Name" }).style.cssText = "font-size:13px;font-weight:600;";
    const nameInput = contentEl.createEl("input", { type: "text" });
    nameInput.style.cssText = "width:100%;padding:8px;font-size:14px;margin-bottom:10px;";
    nameInput.placeholder = "Template name";

    contentEl.createEl("label", { text: "Prompt" }).style.cssText = "font-size:13px;font-weight:600;";
    const { textArea: promptArea, cleanup } = createPromptTextArea(this.app, contentEl, "Enter the prompt... (@ to reference files)");
    this.cleanupFn = cleanup;

    let isGlobal = true;
    const globalRow = contentEl.createDiv();
    globalRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:10px;";
    const globalCheckbox = globalRow.createEl("input", { type: "checkbox" }) as HTMLInputElement;
    globalCheckbox.checked = true;
    globalCheckbox.addEventListener("change", () => { isGlobal = globalCheckbox.checked; });
    globalRow.createEl("span", { text: "Show on all files" }).style.fontSize = "13px";

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
        global: isGlobal,
      });
      await this.plugin.saveSettings();
      this.close();
      if (this.onBackOverride) {
        this.onBackOverride();
      } else {
        new LauncherModal(this.app, this.plugin).open();
      }
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
  onBackOverride: (() => void) | null;

  constructor(app: App, plugin: OpenClaudeTerminalPlugin, template: PromptTemplate, onBack?: () => void) {
    super(app);
    this.plugin = plugin;
    this.template = template;
    this.onBackOverride = onBack ?? null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    createHeaderWithBack(contentEl, "Edit template", () => {
      this.close();
      if (this.onBackOverride) {
        this.onBackOverride();
      } else {
        new LauncherModal(this.app, this.plugin).open();
      }
    });

    contentEl.createEl("label", { text: "Name" }).style.cssText = "font-size:13px;font-weight:600;";
    const nameInput = contentEl.createEl("input", { type: "text" });
    nameInput.style.cssText = "width:100%;padding:8px;font-size:14px;margin-bottom:10px;";
    nameInput.value = this.template.name;

    contentEl.createEl("label", { text: "Prompt" }).style.cssText = "font-size:13px;font-weight:600;";
    const { textArea: promptArea, cleanup } = createPromptTextArea(this.app, contentEl, "Enter the prompt... (@ to reference files)", this.template.prompt);
    this.cleanupFn = cleanup;

    let isGlobal = this.template.global;
    const globalRow = contentEl.createDiv();
    globalRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:10px;";
    const globalCheckbox = globalRow.createEl("input", { type: "checkbox" }) as HTMLInputElement;
    globalCheckbox.checked = isGlobal;
    globalCheckbox.addEventListener("change", () => { isGlobal = globalCheckbox.checked; });
    globalRow.createEl("span", { text: "Show on all files" }).style.fontSize = "13px";

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
      this.template.global = isGlobal;
      await this.plugin.saveSettings();
      this.close();
      if (this.onBackOverride) {
        this.onBackOverride();
      } else {
        new LauncherModal(this.app, this.plugin).open();
      }
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
  headless = false;
  permissionMode: PermissionMode = "default";

  constructor(app: App, plugin: OpenClaudeTerminalPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    createHeaderWithBack(contentEl, "Enter prompt", () => {
      this.close();
      new LauncherModal(this.app, this.plugin).open();
    });

    const { textArea, cleanup } = createPromptTextArea(this.app, contentEl, "Type your prompt... (@ for files, {{title}} / {{note}} for current note)");
    textArea.inputEl.style.minHeight = "100px";
    this.cleanupFn = cleanup;

    const bottomRow = contentEl.createDiv();
    bottomRow.style.cssText = "display:flex;align-items:center;gap:10px;margin-top:10px;";

    const submitBtn = bottomRow.createEl("button", { text: "Run" });
    submitBtn.style.cssText = "padding:8px 20px;cursor:pointer;font-size:14px;";

    const headlessBtn = bottomRow.createEl("button", { text: "Headless" });
    headlessBtn.style.cssText = "padding:8px 16px;cursor:pointer;font-size:13px;opacity:0.5;border-radius:4px;";
    headlessBtn.addEventListener("click", () => {
      this.headless = !this.headless;
      headlessBtn.style.opacity = this.headless ? "1" : "0.5";
      headlessBtn.style.background = this.headless ? "var(--interactive-accent)" : "";
      headlessBtn.style.color = this.headless ? "var(--text-on-accent)" : "";
    });

    const modeSelect = bottomRow.createEl("select");
    modeSelect.style.cssText = "padding:6px 10px;font-size:13px;border-radius:4px;cursor:pointer;";
    for (const mode of PERMISSION_MODES) {
      const opt = modeSelect.createEl("option", { text: mode, value: mode });
      if (mode === this.permissionMode) opt.selected = true;
    }
    modeSelect.addEventListener("change", () => {
      this.permissionMode = modeSelect.value as PermissionMode;
    });

    submitBtn.addEventListener("click", () => {
      const prompt = textArea.getValue().trim();
      if (!prompt) {
        new Notice("Prompt is empty");
        return;
      }
      this.close();
      if (this.headless) {
        this.plugin.runClaudeHeadless(prompt, this.permissionMode);
      } else {
        this.plugin.spawnClaudeWithPrompt(prompt, this.permissionMode);
      }
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
      .setName("Enable Claude Launcher")
      .setDesc("Show 'Claude launcher' command")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableLauncher).onChange(async (value) => {
          this.plugin.settings.enableLauncher = value;
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

    // Agents section
    containerEl.createEl("h3", { text: "Agents" });

    if (this.plugin.settings.templates.length === 0) {
      containerEl.createEl("p", { text: "No agents created yet. Use the launcher to add templates." }).style.opacity = "0.6";
    }

    this.renderAgentList(containerEl);

    new Setting(containerEl)
      .addButton((btn) => {
        btn.setButtonText("+ Add template");
        btn.onClick(() => {
          new AddTemplateOptionsModal(this.app, this.plugin, () => {
            this.display();
          }).open();
        });
      });
  }

  renderAgentList(containerEl: HTMLElement) {
    const listEl = containerEl.createDiv({ cls: "agent-list" });

    for (const tpl of this.plugin.settings.templates) {
      const setting = new Setting(listEl)
        .setName(tpl.name)
        .setDesc(tpl.prompt.length > 60 ? tpl.prompt.slice(0, 60) + "..." : tpl.prompt);

      // "Global" button instead of toggle
      setting.addButton((btn) => {
        const isGlobal = tpl.global ?? false;
        btn.setButtonText("Global");
        btn.onClick(async () => {
          tpl.global = !tpl.global;
          await this.plugin.saveSettings();
          this.display();
        });
        if (isGlobal) {
          btn.buttonEl.style.cssText = "background:var(--interactive-accent);color:var(--text-on-accent);";
        } else {
          btn.buttonEl.style.cssText = "opacity:0.5;";
        }
      });

      setting.addExtraButton((btn) =>
        btn
          .setIcon("pencil")
          .setTooltip("Edit prompt")
          .onClick(() => {
            new EditTemplateModal(this.app, this.plugin, tpl, () => {
              // Return to settings tab instead of launcher
              this.display();
            }).open();
          })
      );

      setting.addExtraButton((btn) =>
        btn
          .setIcon("trash")
          .setTooltip("Delete agent")
          .onClick(async () => {
            this.plugin.settings.templates = this.plugin.settings.templates.filter((t) => t.id !== tpl.id);
            await this.plugin.saveSettings();
            this.display();
          })
      );
    }
  }
}
