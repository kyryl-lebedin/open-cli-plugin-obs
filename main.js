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
var OpenClaudeTerminalPlugin = class extends import_obsidian.Plugin {
  async onload() {
    this.addCommand({
      id: "open-claude-terminal",
      name: "Open Claude in terminal",
      callback: () => this.openTerminal()
    });
  }
  openTerminal() {
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
};
