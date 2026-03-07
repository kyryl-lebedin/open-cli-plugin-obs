import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

// Build plugin (for Obsidian)
esbuild
  .build({
    entryPoints: ["main.ts"],
    bundle: true,
    external: ["obsidian", "electron", "child_process", "path", "fs", "os"],
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    outfile: "main.js",
  })
  .catch(() => process.exit(1));

// Build CLI (standalone Node.js script)
esbuild
  .build({
    entryPoints: ["cli.ts"],
    bundle: true,
    external: ["child_process", "path", "fs", "os"],
    format: "cjs",
    target: "es2018",
    platform: "node",
    logLevel: "info",
    sourcemap: false,
    treeShaking: true,
    outfile: "cli.js",
    banner: { js: "#!/usr/bin/env node" },
  })
  .catch(() => process.exit(1));
