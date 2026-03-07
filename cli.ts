import { execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  PluginSettings,
  DEFAULT_SETTINGS,
  getActiveBackend,
  buildHeadlessScript,
  buildInteractiveScript,
  buildResponseNoteName,
  buildResponseNoteContent,
  resolvePlaceholders,
  migrateSettings,
} from "./backend";

const PLUGIN_ID = "open-claude-terminal";

function parseArgs(argv: string[]): { flags: Record<string, string>; positional: string[] } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") { positional.push(...argv.slice(i + 1)); break; }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags[key] = argv[++i];
      } else {
        flags[key] = "true";
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        flags[key] = argv[++i];
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function obsidianExec(cmd: string): string {
  const raw = execSync(`obsidian ${cmd} 2>/dev/null`, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 10000,
  });
  // Obsidian CLI may prefix output with loader warnings — take last non-empty line
  const lines = raw.trim().split("\n").filter(l => l.trim().length > 0);
  return lines[lines.length - 1]?.trim() ?? "";
}

function getVaultPath(): string {
  try {
    return obsidianExec("vault info=path");
  } catch {
    console.error("Error: Could not reach Obsidian. Is it running with CLI enabled?");
    process.exit(1);
  }
}

function loadSettings(vaultPath: string): PluginSettings {
  const dataPath = path.join(vaultPath, ".obsidian", "plugins", PLUGIN_ID, "data.json");
  if (!fs.existsSync(dataPath)) {
    console.error(`Warning: No plugin settings found at ${dataPath}, using defaults.`);
    return DEFAULT_SETTINGS;
  }
  const raw = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  return migrateSettings(raw);
}

function readNote(vaultPath: string, notePath: string): { title: string; content: string } {
  const fullPath = path.join(vaultPath, notePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`Error: Note not found: ${notePath}`);
    process.exit(1);
  }
  const content = fs.readFileSync(fullPath, "utf-8");
  const title = path.basename(notePath, ".md");
  return { title, content };
}

function printUsage() {
  console.log(`obs-agent — Run agent templates on Obsidian notes from the CLI

Usage:
  obs-agent -n <path> -t <template> [options]
  obs-agent -n <path> -p <prompt>   [options]

Required (one of):
  -t, --template <name>    Template name from plugin settings
  -p, --prompt <text>      Custom prompt text

Required:
  -n, --note <path>        Vault-relative path (e.g. "3 Scope/my task.md")

Options:
  -b, --backend <id>       Backend id (default: from plugin settings)
  -m, --mode <mode>        Permission mode (default: backend default)
  -i, --interactive        Run interactively in current terminal (default: headless)
      --list-templates     List available templates
      --list-backends      List available backends
  -h, --help               Show this help`);
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2));

  if (flags.h === "true" || flags.help === "true" || process.argv.length <= 2) {
    printUsage();
    process.exit(0);
  }

  const vaultPath = getVaultPath();
  const settings = loadSettings(vaultPath);

  if (flags["list-templates"] === "true") {
    if (settings.templates.length === 0) {
      console.log("No templates configured. Add them in Obsidian plugin settings.");
    } else {
      for (const t of settings.templates) {
        console.log(`  ${t.name}${t.description ? `  —  ${t.description}` : ""}`);
      }
    }
    process.exit(0);
  }

  if (flags["list-backends"] === "true") {
    for (const b of settings.backends) {
      const active = b.id === settings.activeBackend ? " (active)" : "";
      console.log(`  ${b.id} — ${b.name}${active}`);
    }
    process.exit(0);
  }

  // --- Resolve inputs ---
  const notePath = flags.note || flags.n;
  if (!notePath) {
    console.error("Error: --note / -n is required.");
    process.exit(1);
  }

  const templateName = flags.template || flags.t;
  const customPrompt = flags.prompt || flags.p;
  if (!templateName && !customPrompt) {
    console.error("Error: --template / -t or --prompt / -p is required.");
    process.exit(1);
  }

  const isInteractive = (flags.interactive === "true" || flags.i === "true");

  // Backend
  if (flags.backend || flags.b) {
    settings.activeBackend = (flags.backend || flags.b);
  }
  const backend = getActiveBackend(settings);

  // Permission mode
  const permissionMode = flags.mode || flags.m || backend.defaultPermission;

  // Read note
  const { title, content } = readNote(vaultPath, notePath);

  // Resolve prompt
  let prompt: string;
  if (templateName) {
    const tpl = settings.templates.find(t => t.name === templateName);
    if (!tpl) {
      console.error(`Error: Template "${templateName}" not found.`);
      console.error("Available templates:");
      for (const t of settings.templates) console.error(`  ${t.name}`);
      process.exit(1);
    }
    prompt = tpl.prompt;
  } else {
    prompt = customPrompt!;
  }

  const resolved = resolvePlaceholders(prompt, title, content);
  const dirPath = path.join(vaultPath, path.dirname(notePath));
  const ts = Date.now();

  if (isInteractive) {
    runInteractive(backend, dirPath, resolved, permissionMode, ts);
  } else {
    runHeadless(backend, dirPath, resolved, permissionMode, ts, vaultPath, notePath, title, prompt, templateName ?? undefined);
  }
}

function runInteractive(
  backend: ReturnType<typeof getActiveBackend>,
  dirPath: string,
  resolved: string,
  permissionMode: string,
  ts: number,
) {
  const tmpPrompt = path.join(os.tmpdir(), `agent-prompt-${ts}.txt`);
  const tmpScript = path.join(os.tmpdir(), `agent-launch-${ts}.sh`);

  const scriptLines = buildInteractiveScript(backend, dirPath, tmpPrompt, tmpScript, permissionMode);

  fs.writeFileSync(tmpPrompt, resolved, "utf-8");
  fs.writeFileSync(tmpScript, scriptLines.join("\n"), "utf-8");
  fs.chmodSync(tmpScript, "755");

  const result = spawnSync("bash", [tmpScript], { stdio: "inherit" });
  process.exit(result.status ?? 0);
}

function runHeadless(
  backend: ReturnType<typeof getActiveBackend>,
  dirPath: string,
  resolved: string,
  permissionMode: string,
  ts: number,
  vaultPath: string,
  notePath: string,
  title: string,
  rawPrompt: string,
  templateName?: string,
) {
  const tmpPrompt = path.join(os.tmpdir(), `agent-prompt-${ts}.txt`);
  const tmpOutput = path.join(os.tmpdir(), `agent-output-${ts}.txt`);
  const tmpScript = path.join(os.tmpdir(), `agent-headless-${ts}.sh`);

  const scriptLines = buildHeadlessScript(backend, dirPath, tmpPrompt, tmpOutput, tmpScript, permissionMode);

  fs.writeFileSync(tmpPrompt, resolved, "utf-8");
  fs.writeFileSync(tmpScript, scriptLines.join("\n"), "utf-8");
  fs.chmodSync(tmpScript, "755");

  console.log(`Running ${backend.name} headless on "${title}"...`);

  try {
    execSync(`bash "${tmpScript}"`, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 600000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // agent may exit non-zero but still produce output
  }

  let response = "";
  try {
    response = fs.readFileSync(tmpOutput, "utf-8").trim();
    fs.unlinkSync(tmpOutput);
  } catch {
    // no output file
  }

  if (!response) {
    console.error(`No output from ${backend.name}.`);
    response = `No output from ${backend.name}`;
  }

  // Create response note on filesystem
  const noteName = buildResponseNoteName(backend.name, rawPrompt, ts);
  const noteContent = buildResponseNoteContent(response, resolved, templateName);
  const folderPath = path.dirname(notePath);
  const responseVaultPath = folderPath !== "." ? `${folderPath}/${noteName}.md` : `${noteName}.md`;
  const responseFullPath = path.join(vaultPath, responseVaultPath);

  fs.writeFileSync(responseFullPath, noteContent, "utf-8");

  // Append wiki link to source note
  const sourceFullPath = path.join(vaultPath, notePath);
  fs.appendFileSync(sourceFullPath, `\n[[${noteName}]]`, "utf-8");

  console.log(`Response saved: ${responseVaultPath}`);
  console.log(`Wiki link appended to: ${notePath}`);
}

main();
