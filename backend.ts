export interface BackendConfig {
  id: string;
  name: string;
  command: string;
  commandPath?: string;
  permissionFlag: string;
  permissionModes: string[];
  defaultPermission: string;
  interactiveTemplate: string;
  headlessTemplate: string;
}

export const DEFAULT_BACKENDS: BackendConfig[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    permissionFlag: "--permission-mode",
    permissionModes: ["default", "plan", "acceptEdits", "bypassPermissions"],
    defaultPermission: "default",
    interactiveTemplate: '{command} {permission} "$prompt"',
    headlessTemplate: 'cat "{prompt_file}" | {command} -p {permission} > "{output_file}" 2>&1',
  },
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    permissionFlag: "-a",
    permissionModes: ["on-request", "untrusted", "never"],
    defaultPermission: "on-request",
    interactiveTemplate: '{command} {permission} "$prompt"',
    headlessTemplate: '{command} {permission} exec "$(cat "{prompt_file}")" > "{output_file}" 2>&1',
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    command: "gemini",
    permissionFlag: "--approval-mode",
    permissionModes: ["default", "auto_edit", "yolo", "plan"],
    defaultPermission: "default",
    interactiveTemplate: '{command} {permission} "$prompt"',
    headlessTemplate: '{command} {permission} -p "$(cat "{prompt_file}")" > "{output_file}" 2>&1',
  },
];

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  global: boolean;
}

export interface PluginSettings {
  activeBackend: string;
  backends: BackendConfig[];
  terminalCommand: string;
  enableTerminal: boolean;
  enableCursor: boolean;
  enableLauncher: boolean;
  templates: PromptTemplate[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
  activeBackend: "claude-code",
  backends: DEFAULT_BACKENDS,
  terminalCommand: "gnome-terminal --",
  enableTerminal: true,
  enableCursor: true,
  enableLauncher: true,
  templates: [],
};

export function getCommandBinary(backend: BackendConfig): string {
  return backend.commandPath?.trim() || backend.command;
}

export function resolveTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result.replace(/  +/g, ' ').trim();
}

export function buildPermissionArg(backend: BackendConfig, mode: string): string {
  if (mode === backend.defaultPermission) return "";
  return `${backend.permissionFlag} ${mode}`;
}

export function getActiveBackend(settings: PluginSettings): BackendConfig {
  const found = settings.backends.find(b => b.id === settings.activeBackend);
  if (found) return found;
  if (settings.backends.length > 0) return settings.backends[0];
  return DEFAULT_BACKENDS[0];
}

function escapeForShell(s: string): string {
  return s.replace(/"/g, '\\"');
}

export function buildInteractiveScript(
  backend: BackendConfig,
  dirPath: string,
  promptFile: string,
  scriptFile: string,
  permissionMode: string,
): string[] {
  const bin = getCommandBinary(backend);
  const permArg = buildPermissionArg(backend, permissionMode || backend.defaultPermission);
  const interactiveCmd = resolveTemplate(backend.interactiveTemplate, {
    command: bin,
    permission: permArg,
  });

  return [
    "#!/bin/bash -i",
    `source ~/.bashrc 2>/dev/null || source ~/.profile 2>/dev/null || true`,
    `export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"`,
    `cd "${escapeForShell(dirPath)}"`,
    `prompt=$(cat "${escapeForShell(promptFile)}")`,
    `rm -f "${escapeForShell(promptFile)}" "${escapeForShell(scriptFile)}"`,
    interactiveCmd,
    `exec bash`,
  ];
}

export function buildHeadlessScript(
  backend: BackendConfig,
  dirPath: string,
  promptFile: string,
  outputFile: string,
  scriptFile: string,
  permissionMode: string,
): string[] {
  const bin = getCommandBinary(backend);
  const permArg = buildPermissionArg(backend, permissionMode || backend.defaultPermission);
  const headlessCmd = resolveTemplate(backend.headlessTemplate, {
    command: bin,
    permission: permArg,
    prompt_file: escapeForShell(promptFile),
    output_file: escapeForShell(outputFile),
  });

  return [
    "#!/bin/bash -i",
    `source ~/.bashrc 2>/dev/null || source ~/.profile 2>/dev/null || true`,
    `export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"`,
    `cd "${escapeForShell(dirPath)}"`,
    headlessCmd,
    `rm -f "${escapeForShell(promptFile)}" "${escapeForShell(scriptFile)}"`,
  ];
}

export function buildResponseNoteName(backendName: string, prompt: string, timestamp: number): string {
  const words = prompt.split(/\s+/).filter(Boolean);
  const slug = words.slice(0, 5).join(" ") + (words.length > 5 ? "..." : "");
  const safeSlug = slug.replace(/[\\/:*?"<>|#^[\]]/g, "").trim();
  const backendSlug = backendName.toLowerCase().replace(/\s+/g, "-");
  return `${backendSlug} - ${safeSlug} ${timestamp}`;
}

export function buildResponseNoteContent(response: string, resolvedPrompt: string, templateName?: string): string {
  const header = templateName ? `**Template:** ${templateName}` : `**User:** ${resolvedPrompt}`;
  return `${header}\n\n**Response:** ${response}`;
}

export function resolvePlaceholders(prompt: string, title: string, content: string): string {
  let result = prompt;
  if (result.includes("{{note}}")) {
    result = result.replace(/\{\{note\}\}/g, `${title}\n\n${content}`);
  }
  result = result.replace(/\{\{title\}\}/g, title);
  return result;
}

export function migrateSettings(loaded: any): PluginSettings {
  const settings: PluginSettings = Object.assign({}, DEFAULT_SETTINGS, loaded);

  if (loaded && 'enableClaude' in loaded && !('enableTerminal' in loaded)) {
    settings.enableTerminal = loaded.enableClaude;
  }
  if (loaded && !('backends' in loaded)) {
    settings.backends = DEFAULT_BACKENDS.map(b => ({ ...b }));
  }
  if (loaded && !('activeBackend' in loaded)) {
    settings.activeBackend = "claude-code";
  }
  if (loaded && !('terminalCommand' in loaded)) {
    settings.terminalCommand = "gnome-terminal --";
  }

  return settings;
}
