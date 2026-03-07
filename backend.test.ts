import { describe, it, expect } from "vitest";
import {
  BackendConfig,
  PluginSettings,
  DEFAULT_BACKENDS,
  DEFAULT_SETTINGS,
  resolveTemplate,
  buildPermissionArg,
  getActiveBackend,
  getCommandBinary,
  buildInteractiveScript,
  buildHeadlessScript,
  buildResponseNoteName,
  buildResponseNoteContent,
  resolvePlaceholders,
  migrateSettings,
} from "./backend";

// Helpers to get specific backends
const claude = DEFAULT_BACKENDS.find(b => b.id === "claude-code")!;
const codex = DEFAULT_BACKENDS.find(b => b.id === "codex")!;
const gemini = DEFAULT_BACKENDS.find(b => b.id === "gemini-cli")!;

// ---------------------------------------------------------------------------
// resolveTemplate
// ---------------------------------------------------------------------------
describe("resolveTemplate", () => {
  it("replaces a single placeholder", () => {
    expect(resolveTemplate("{command} run", { command: "claude" }))
      .toBe("claude run");
  });

  it("replaces multiple different placeholders", () => {
    expect(resolveTemplate("{command} {permission} exec", { command: "codex", permission: "-a never" }))
      .toBe("codex -a never exec");
  });

  it("collapses double spaces from empty placeholder", () => {
    expect(resolveTemplate("{command} {permission} exec", { command: "codex", permission: "" }))
      .toBe("codex exec");
  });

  it("replaces the same placeholder multiple times", () => {
    expect(resolveTemplate("{x} and {x}", { x: "ok" }))
      .toBe("ok and ok");
  });

  it("leaves unmatched placeholders as literal text", () => {
    expect(resolveTemplate("{command} {unknown}", { command: "claude" }))
      .toBe("claude {unknown}");
  });

  it("handles a real headless template end-to-end", () => {
    const result = resolveTemplate(
      'cat "{prompt_file}" | {command} -p {permission} > "{output_file}" 2>&1',
      { command: "claude", permission: "--permission-mode plan", prompt_file: "/tmp/p.txt", output_file: "/tmp/o.txt" },
    );
    expect(result).toBe('cat "/tmp/p.txt" | claude -p --permission-mode plan > "/tmp/o.txt" 2>&1');
  });
});

// ---------------------------------------------------------------------------
// getCommandBinary
// ---------------------------------------------------------------------------
describe("getCommandBinary", () => {
  it("returns command name when commandPath is not set", () => {
    expect(getCommandBinary(claude)).toBe("claude");
  });

  it("returns commandPath when set", () => {
    const custom = { ...gemini, commandPath: "/home/user/.npm-global/bin/gemini" };
    expect(getCommandBinary(custom)).toBe("/home/user/.npm-global/bin/gemini");
  });

  it("falls back to command when commandPath is empty string", () => {
    const custom = { ...codex, commandPath: "" };
    expect(getCommandBinary(custom)).toBe("codex");
  });

  it("falls back to command when commandPath is whitespace", () => {
    const custom = { ...codex, commandPath: "   " };
    expect(getCommandBinary(custom)).toBe("codex");
  });
});

// ---------------------------------------------------------------------------
// buildPermissionArg
// ---------------------------------------------------------------------------
describe("buildPermissionArg", () => {
  it("returns empty string for Claude default mode", () => {
    expect(buildPermissionArg(claude, "default")).toBe("");
  });

  it("returns empty string for Codex default mode", () => {
    expect(buildPermissionArg(codex, "on-request")).toBe("");
  });

  it("returns empty string for Gemini default mode", () => {
    expect(buildPermissionArg(gemini, "default")).toBe("");
  });

  it("returns correct flag for Claude non-default", () => {
    expect(buildPermissionArg(claude, "plan")).toBe("--permission-mode plan");
  });

  it("returns correct flag for Codex non-default", () => {
    expect(buildPermissionArg(codex, "never")).toBe("-a never");
  });

  it("returns correct flag for Gemini non-default", () => {
    expect(buildPermissionArg(gemini, "yolo")).toBe("--approval-mode yolo");
  });
});

// ---------------------------------------------------------------------------
// getActiveBackend
// ---------------------------------------------------------------------------
describe("getActiveBackend", () => {
  it("finds matching backend by ID", () => {
    const settings = { ...DEFAULT_SETTINGS, activeBackend: "codex" };
    expect(getActiveBackend(settings).id).toBe("codex");
  });

  it("falls back to first backend if ID not found", () => {
    const settings = { ...DEFAULT_SETTINGS, activeBackend: "nonexistent" };
    expect(getActiveBackend(settings).id).toBe("claude-code");
  });

  it("falls back to DEFAULT_BACKENDS[0] if backends array is empty", () => {
    const settings = { ...DEFAULT_SETTINGS, activeBackend: "claude-code", backends: [] };
    expect(getActiveBackend(settings).id).toBe("claude-code");
  });

  it("works with each built-in backend ID", () => {
    for (const b of DEFAULT_BACKENDS) {
      const settings = { ...DEFAULT_SETTINGS, activeBackend: b.id };
      expect(getActiveBackend(settings).id).toBe(b.id);
    }
  });
});

// ---------------------------------------------------------------------------
// buildInteractiveScript — Claude Code
// ---------------------------------------------------------------------------
describe("buildInteractiveScript — Claude Code", () => {
  it("produces correct script with default permission", () => {
    const lines = buildInteractiveScript(claude, "/home/user/vault", "/tmp/p.txt", "/tmp/s.sh", "default");
    expect(lines[0]).toBe("#!/bin/bash -i");
    expect(lines[1]).toContain("source ~/.bashrc");
    expect(lines[2]).toContain('export PATH=');
    expect(lines[2]).toContain('.npm-global/bin');
    expect(lines).toContainEqual(expect.stringContaining('cd "/home/user/vault"'));
    // Default permission => no flag, just 'claude "$prompt"'
    expect(lines).toContainEqual('claude "$prompt"');
  });

  it("produces correct script with non-default permission", () => {
    const lines = buildInteractiveScript(claude, "/home/user/vault", "/tmp/p.txt", "/tmp/s.sh", "plan");
    expect(lines).toContainEqual('claude --permission-mode plan "$prompt"');
  });

  it("uses commandPath when set", () => {
    const custom = { ...claude, commandPath: "/usr/local/bin/claude" };
    const lines = buildInteractiveScript(custom, "/dir", "/tmp/p.txt", "/tmp/s.sh", "default");
    expect(lines).toContainEqual('/usr/local/bin/claude "$prompt"');
  });

  it("includes cleanup of temp files", () => {
    const lines = buildInteractiveScript(claude, "/dir", "/tmp/p.txt", "/tmp/s.sh", "default");
    const rmLine = lines.find(l => l.startsWith("rm -f"));
    expect(rmLine).toBeDefined();
    expect(rmLine).toContain("/tmp/p.txt");
    expect(rmLine).toContain("/tmp/s.sh");
  });
});

// ---------------------------------------------------------------------------
// buildInteractiveScript — Codex
// ---------------------------------------------------------------------------
describe("buildInteractiveScript — Codex", () => {
  it("produces correct script with default permission", () => {
    const lines = buildInteractiveScript(codex, "/dir", "/tmp/p.txt", "/tmp/s.sh", "on-request");
    expect(lines).toContainEqual('codex "$prompt"');
  });

  it("produces correct script with non-default permission", () => {
    const lines = buildInteractiveScript(codex, "/dir", "/tmp/p.txt", "/tmp/s.sh", "never");
    expect(lines).toContainEqual('codex -a never "$prompt"');
  });
});

// ---------------------------------------------------------------------------
// buildInteractiveScript — Gemini CLI
// ---------------------------------------------------------------------------
describe("buildInteractiveScript — Gemini CLI", () => {
  it("produces correct script with default permission", () => {
    const lines = buildInteractiveScript(gemini, "/dir", "/tmp/p.txt", "/tmp/s.sh", "default");
    expect(lines).toContainEqual('gemini "$prompt"');
  });

  it("produces correct script with non-default permission", () => {
    const lines = buildInteractiveScript(gemini, "/dir", "/tmp/p.txt", "/tmp/s.sh", "yolo");
    expect(lines).toContainEqual('gemini --approval-mode yolo "$prompt"');
  });
});

// ---------------------------------------------------------------------------
// buildHeadlessScript — Claude Code
// ---------------------------------------------------------------------------
describe("buildHeadlessScript — Claude Code", () => {
  it("uses stdin pipe for prompt with default permission", () => {
    const lines = buildHeadlessScript(claude, "/dir", "/tmp/p.txt", "/tmp/o.txt", "/tmp/s.sh", "default");
    const cmdLine = lines.find(l => l.includes("claude"));
    expect(cmdLine).toBeDefined();
    expect(cmdLine).toContain('cat "/tmp/p.txt"');
    expect(cmdLine).toContain("| claude -p");
    expect(cmdLine).toContain('> "/tmp/o.txt" 2>&1');
    // No permission flag for default
    expect(cmdLine).not.toContain("--permission-mode");
  });

  it("includes permission flag for non-default mode", () => {
    const lines = buildHeadlessScript(claude, "/dir", "/tmp/p.txt", "/tmp/o.txt", "/tmp/s.sh", "acceptEdits");
    const cmdLine = lines.find(l => l.includes("claude"))!;
    expect(cmdLine).toContain("--permission-mode acceptEdits");
  });
});

// ---------------------------------------------------------------------------
// buildHeadlessScript — Codex
// ---------------------------------------------------------------------------
describe("buildHeadlessScript — Codex", () => {
  it("uses exec subcommand with default permission", () => {
    const lines = buildHeadlessScript(codex, "/dir", "/tmp/p.txt", "/tmp/o.txt", "/tmp/s.sh", "on-request");
    const cmdLine = lines.find(l => l.includes("codex"));
    expect(cmdLine).toBeDefined();
    expect(cmdLine).toContain("codex exec");
    expect(cmdLine).toContain('$(cat "/tmp/p.txt")');
    expect(cmdLine).toContain('> "/tmp/o.txt" 2>&1');
  });

  it("includes approval flag for non-default mode", () => {
    const lines = buildHeadlessScript(codex, "/dir", "/tmp/p.txt", "/tmp/o.txt", "/tmp/s.sh", "never");
    const cmdLine = lines.find(l => l.includes("codex"))!;
    expect(cmdLine).toContain("-a never");
    expect(cmdLine).toContain("exec");
  });
});

// ---------------------------------------------------------------------------
// buildHeadlessScript — Gemini CLI
// ---------------------------------------------------------------------------
describe("buildHeadlessScript — Gemini CLI", () => {
  it("uses -p flag with prompt as argument", () => {
    const lines = buildHeadlessScript(gemini, "/dir", "/tmp/p.txt", "/tmp/o.txt", "/tmp/s.sh", "default");
    const cmdLine = lines.find(l => l.includes("gemini"));
    expect(cmdLine).toBeDefined();
    expect(cmdLine).toContain('gemini -p');
    expect(cmdLine).toContain('$(cat "/tmp/p.txt")');
    expect(cmdLine).toContain('> "/tmp/o.txt" 2>&1');
  });

  it("includes approval-mode flag for non-default mode", () => {
    const lines = buildHeadlessScript(gemini, "/dir", "/tmp/p.txt", "/tmp/o.txt", "/tmp/s.sh", "yolo");
    const cmdLine = lines.find(l => l.includes("gemini"))!;
    expect(cmdLine).toContain("--approval-mode yolo");
  });

  it("uses commandPath when set", () => {
    const custom = { ...gemini, commandPath: "/home/user/.npm-global/bin/gemini" };
    const lines = buildHeadlessScript(custom, "/dir", "/tmp/p.txt", "/tmp/o.txt", "/tmp/s.sh", "default");
    const cmdLine = lines.find(l => l.includes("gemini"))!;
    expect(cmdLine).toContain("/home/user/.npm-global/bin/gemini -p");
  });
});

// ---------------------------------------------------------------------------
// buildHeadlessScript — paths with spaces
// ---------------------------------------------------------------------------
describe("buildHeadlessScript — edge cases", () => {
  it("handles paths with spaces", () => {
    const lines = buildHeadlessScript(claude, "/home/user/my vault/notes", "/tmp/my prompt.txt", "/tmp/my output.txt", "/tmp/s.sh", "default");
    expect(lines).toContainEqual(expect.stringContaining('cd "/home/user/my vault/notes"'));
    const cmdLine = lines.find(l => l.includes("claude"))!;
    expect(cmdLine).toContain("/tmp/my prompt.txt");
    expect(cmdLine).toContain("/tmp/my output.txt");
  });

  it("all scripts start with bash -i shebang and PATH preamble", () => {
    for (const backend of DEFAULT_BACKENDS) {
      const lines = buildHeadlessScript(backend, "/dir", "/tmp/p.txt", "/tmp/o.txt", "/tmp/s.sh", backend.defaultPermission);
      expect(lines[0]).toBe("#!/bin/bash -i");
      expect(lines[1]).toContain("source ~/.bashrc");
      expect(lines[2]).toContain('export PATH=');
      expect(lines[2]).toContain('.local/bin');
      expect(lines[2]).toContain('.npm-global/bin');
    }
  });
});

// ---------------------------------------------------------------------------
// buildResponseNoteName
// ---------------------------------------------------------------------------
describe("buildResponseNoteName", () => {
  it("slugifies backend name to lowercase with dashes", () => {
    const name = buildResponseNoteName("Claude Code", "hello", 1000);
    expect(name).toMatch(/^claude-code - /);
  });

  it("truncates prompt to 5 words with ellipsis", () => {
    const name = buildResponseNoteName("Codex", "one two three four five six seven", 1000);
    expect(name).toContain("one two three four five...");
    expect(name).not.toContain("six");
  });

  it("does not add ellipsis for short prompts", () => {
    const name = buildResponseNoteName("Codex", "short prompt", 1000);
    expect(name).toContain("short prompt");
    expect(name).not.toContain("...");
  });

  it("sanitizes special characters from prompt", () => {
    const name = buildResponseNoteName("Gemini CLI", 'what is "this" file?', 1000);
    expect(name).not.toContain('"');
    expect(name).not.toContain('?');
  });

  it("includes timestamp at the end", () => {
    const name = buildResponseNoteName("Codex", "hello", 1234567890);
    expect(name).toMatch(/1234567890$/);
  });
});

// ---------------------------------------------------------------------------
// buildResponseNoteContent
// ---------------------------------------------------------------------------
describe("buildResponseNoteContent", () => {
  it("uses template name when provided", () => {
    const result = buildResponseNoteContent("some response", "full prompt text", "Execute");
    expect(result).toContain("**Template:** Execute");
    expect(result).not.toContain("**User:**");
    expect(result).toContain("**Response:** some response");
  });

  it("uses full prompt when no template name", () => {
    const result = buildResponseNoteContent("some response", "full prompt text");
    expect(result).toContain("**User:** full prompt text");
    expect(result).not.toContain("**Template:**");
    expect(result).toContain("**Response:** some response");
  });
});

// ---------------------------------------------------------------------------
// resolvePlaceholders
// ---------------------------------------------------------------------------
describe("resolvePlaceholders", () => {
  it("replaces {{title}} with note title", () => {
    const result = resolvePlaceholders("Hello {{title}}", "My Note", "content");
    expect(result).toBe("Hello My Note");
  });

  it("replaces {{note}} with title + content", () => {
    const result = resolvePlaceholders("Context: {{note}}", "My Note", "body text");
    expect(result).toContain("My Note");
    expect(result).toContain("body text");
  });

  it("replaces both placeholders", () => {
    const result = resolvePlaceholders("File: {{title}}\n{{note}}", "Test", "content here");
    expect(result).toContain("File: Test");
    expect(result).toContain("content here");
  });

  it("returns prompt unchanged when no placeholders", () => {
    const result = resolvePlaceholders("plain prompt", "Title", "content");
    expect(result).toBe("plain prompt");
  });
});

// ---------------------------------------------------------------------------
// migrateSettings
// ---------------------------------------------------------------------------
describe("migrateSettings", () => {
  it("returns all defaults for null/undefined loaded data", () => {
    const settings = migrateSettings(null);
    expect(settings.activeBackend).toBe("claude-code");
    expect(settings.backends.length).toBe(3);
    expect(settings.terminalCommand).toBe("gnome-terminal --");
    expect(settings.enableTerminal).toBe(true);
  });

  it("migrates old enableClaude to enableTerminal", () => {
    const settings = migrateSettings({ enableClaude: false, templates: [] });
    expect(settings.enableTerminal).toBe(false);
  });

  it("preserves enableTerminal if already present (no migration)", () => {
    const settings = migrateSettings({ enableTerminal: true, enableClaude: false, templates: [] });
    // enableTerminal was already in loaded, so enableClaude should not override
    expect(settings.enableTerminal).toBe(true);
  });

  it("populates default backends when missing", () => {
    const settings = migrateSettings({ templates: [] });
    expect(settings.backends.length).toBe(3);
    expect(settings.backends[0].id).toBe("claude-code");
  });

  it("preserves existing templates across migration", () => {
    const templates = [{ id: "1", name: "test", description: "", prompt: "hello", global: true }];
    const settings = migrateSettings({ enableClaude: true, templates });
    expect(settings.templates).toEqual(templates);
  });
});
