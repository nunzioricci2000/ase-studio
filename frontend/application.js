// SPDX-FileCopyrightText: 2026 Behnam Farnaghinejad <behnam.farnaghinejad@polito.it>
// SPDX-License-Identifier: GPL-2.0-only
// Modified in the personal fork on 2026-11-02: extract Studio rendering/operations for Lumino.
// Earlier fork changes (2026-10-27–2026-10-31): Monaco, autosave, playback and managed updates.

import {RISCV_OPCODE_CATALOG} from './riscv-opcodes.js';
import {createSourceEditor} from './vendor/editor.js';
import {createProjectsView} from './views/projects.js';
import {createPipelineView} from './views/pipeline.js';
import {createMemoryView} from './views/memory.js';
import {createRegistersView} from './views/registers.js';
import {createLogView} from './views/log.js';
import {createEditorView} from './views/editor.js';
import {bindApplicationCommands} from './workbench/commands.js';

/** Install application operations against one project session and six persistent views.
 * @param {{session: import('./workbench/session.js').StudioSession,
 * shell: ReturnType<import('./workbench/shell.js').createShell>,
 * commands: import('@lumino/commands').CommandRegistry}} dependencies
 * @returns {{services: object, sourceEditor: ReturnType<typeof createSourceEditor>}}
 */
export function createApplication({session, shell, commands}) {
 const services = {
  protectionEnabled:()=>scaffoldProtectionEnabled,
  escapeHtml,
  formatWordValue,
  highlightAsmLine,
  navigateToItemChange,
  openProject,
  parseCompilerDiagnostics,
  showActionMessage
 };
// Modified in the personal fork on 2026-10-31: explain AppImage replacement updates without inactive archive controls.
/*
 * SPDX-FileCopyrightText: 2026 Behnam Farnaghinejad <behnam.farnaghinejad@polito.it>
 * SPDX-License-Identifier: GPL-2.0-only
 * Modified in the personal fork on 2026-10-30: show the upstream version and named fork package together.
 * Modified in the personal fork on 2026-10-27: name Nunzio's app, autosave without overlapping writes and distinguish unknown registers.
 */
const STUDIO_NAME = "ASE Studio di Nunzio";
let autoSaveTimer = null;
let saveInFlight = null;
let projectOpenRequest = 0;
const $ = selector => document.querySelector(selector);
let scaffoldProtectionEnabled = true;
let scaffoldEditAuthorized = false;
let messageDialogResolver = null;
let messageDialogHasInput = false;
let messageDialogConfirmValue = true;
let messageDialogAlternateValue = null;
let messageDialogTrimInput = true;

let externalSyncBusy = false;
let cpuConfigurationOpenedAs = null;
let o3Defaults = {};
let predictorParameterDraft = {};
const predictorNames = {
  local: "Local counter (2-bit baseline)",
  tournament: "Tournament (local + global)",
  tage: "TAGE (tagged hybrid)",
  bimode: "Bi-mode"
};
const predictorFields = {
  local: [
    ["localPredictorSize", "Counter storage (bits)", 2, 65536, "Power of two; entries = storage ÷ counter bits."],
    ["localCtrBits", "Counter bits (n)", 1, 8, "Each branch-addressed entry has a saturating counter."],
    ["BTBEntries", "Branch target buffer entries", 2, 65536, "Power of two."],
  ],
  tournament: [
    ["localPredictorSize", "Local counters (entries)", 2, 65536, "Power of two."],
    ["localCtrBits", "Local counter bits", 1, 8, ""],
    ["localHistoryTableSize", "Local history entries", 2, 65536, "Power of two."],
    ["globalPredictorSize", "Global counters (entries; 2^m)", 2, 65536, "Power of two; m = log₂(entries)."],
    ["globalCtrBits", "Global counter bits (n)", 1, 8, ""],
    ["choicePredictorSize", "Selector entries", 2, 65536, "Power of two; also affects global-history length."],
    ["choiceCtrBits", "Selector counter bits", 1, 8, ""],
    ["BTBEntries", "Branch target buffer entries", 2, 65536, "Power of two."],
  ],
  bimode: [
    ["globalPredictorSize", "Direction counters per bank (entries)", 2, 65536, "Power of two; history length = log₂(entries)."],
    ["globalCtrBits", "Direction counter bits", 1, 8, ""],
    ["choicePredictorSize", "Selector entries", 2, 65536, "Power of two."],
    ["choiceCtrBits", "Selector counter bits", 1, 8, ""],
    ["BTBEntries", "Branch target buffer entries", 2, 65536, "Power of two."],
  ],
  tage: [
    ["minHist", "Shortest tagged history (branches)", 1, 8192, ""],
    ["maxHist", "Longest tagged history (branches)", 1, 8192, "Must exceed the shortest history."],
    ["tagTableCounterBits", "Prediction counter bits", 1, 8, ""],
    ["tagTableUBits", "Usefulness bits", 1, 2, "This gem5 implementation supports 1 or 2."],
    ["tagTableTagWidths", "Tag widths (bits)", null, null, "Eight comma-separated values: 0 for the base, then seven tagged tables."],
    ["logTagTableSizes", "Log₂ table entries", null, null, "Eight comma-separated values: base, then seven tagged tables."],
    ["BTBEntries", "Branch target buffer entries", 2, 65536, "Power of two."],
  ]
};
let studioFeatures = {
  developerMode: false,
  memoryConfiguration: false,
  multiIssueCpu: false
};
let configuredProgramsDirectory = "";

let changeContextMenu = null;
let draftSaveTimer = null;

function closeActionDialog(value) {
  const dialog = $("#message-dialog");
  if (dialog.open) dialog.close();
  const resolver = messageDialogResolver;
  messageDialogResolver = null;
  if (resolver) resolver(value);
}

function actionDialog({title, message, confirmLabel = "OK", cancelLabel = null,
  inputLabel = null, inputValue = "", danger = false, confirmValue = true,
  alternateLabel = null, alternateValue = null, trimInput = true}) {
  if (messageDialogResolver) closeActionDialog(null);
  $("#message-title").textContent = title;
  $("#message-text").textContent = message;
  $("#message-confirm").textContent = confirmLabel;
  $("#message-confirm").classList.toggle("danger", danger);
  $("#message-cancel").hidden = !cancelLabel;
  $("#message-cancel").textContent = cancelLabel || "Cancel";
  $("#message-alternate").hidden = !alternateLabel;
  $("#message-alternate").textContent = alternateLabel || "";
  messageDialogConfirmValue = confirmValue;
  messageDialogAlternateValue = alternateValue;
  messageDialogTrimInput = trimInput;
  messageDialogHasInput = Boolean(inputLabel);
  $("#message-input-wrap").hidden = !messageDialogHasInput;
  $("#message-input-label").textContent = inputLabel || "";
  $("#message-input").value = inputValue;
  $("#message-dialog").showModal();
  setTimeout(() => (messageDialogHasInput ? $("#message-input") : $("#message-confirm")).focus(), 0);
  return new Promise(resolve => { messageDialogResolver = resolve; });
}

function showActionMessage(title, message) {
  return actionDialog({title, message});
}

const sourceEditor = createSourceEditor($("#source-editor"), {
  onChange() { markSourceEdited(); scheduleLocalDraft(); scheduleAutoSave(); services.clearDiagnostics(); refreshScaffoldProtectionUi(); services.clearSourceLineHighlight(); },
  onSave: () => commands.execute("app:save"),
});


  services.sourceEditor = sourceEditor;
  Object.assign(services, createProjectsView({session, services, root:shell.nodes.projects}));
  Object.assign(services, createPipelineView({session, services, shell, root:shell.nodes.pipeline}));
  Object.assign(services, createMemoryView({session, services, shell, root:shell.nodes.memory}));
  Object.assign(services, createRegistersView({session, services, shell, root:shell.nodes.registers}));
  Object.assign(services, createLogView({session, services, shell, root:shell.nodes.output}));
  Object.assign(services, createEditorView({session, services, shell, root:shell.nodes.editor}));

const savedTheme = localStorage.getItem("ase-studio-theme");
document.documentElement.dataset.theme = savedTheme
  || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === "dark";
  sourceEditor.setTheme(dark);
  $("#theme-toggle").textContent = dark ? "Light mode" : "Dark mode";
  $("#theme-toggle").title = dark ? "Use the light color theme" : "Use the dark color theme";
}

function setEditorFontSize(value) {
  const size = Math.max(11, Math.min(22, Number(value) || 14));
  const lineHeight = Math.round(size * 1.65);
  document.documentElement.style.setProperty("--editor-font-size", `${size}px`);
  document.documentElement.style.setProperty("--editor-line-height", `${lineHeight}px`);
  $("#editor-font-size").value = size;
  $("#editor-font-value").textContent = `${size} px`;
  localStorage.setItem("ase-studio-editor-font-size", String(size));
  sourceEditor.setFontSize(size);
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_error) {
    throw Error(`ASE Studio received an incompatible server response (${response.status}). Stop the old server and restart ./ase-studio.sh.`);
  }
  if (!response.ok) throw Error(data.error || "Request failed");
  return data;
}

async function loadStudioVersion() {
  try {
    const health = await api("/api/health");
    o3Defaults = health.o3Defaults || {};
    $("#about-version").textContent = `Version ${health.displayVersion || health.version}`;
    applyDeveloperFeatures(health.features || {});
  } catch (_error) {
    $("#about-version").textContent = "Version unavailable";
    applyDeveloperFeatures({});
  }
}

function applyDeveloperFeatures(features) {
  studioFeatures = {
    developerMode: features.developerMode === true,
    memoryConfiguration: features.memoryConfiguration === true,
    multiIssueCpu: features.multiIssueCpu === true
  };
  $("#developer-mode-badge").hidden = !studioFeatures.developerMode;
  $("#cpu-model-field").hidden = !studioFeatures.multiIssueCpu;
  const multiIssueOption = $("#cpu-model").querySelector('option[value="out-of-order"]');
  multiIssueOption.hidden = !studioFeatures.multiIssueCpu;
  multiIssueOption.disabled = !studioFeatures.multiIssueCpu;
  if (!studioFeatures.multiIssueCpu) $("#cpu-model").value = "in-order";
  $("#memory-management").hidden = !studioFeatures.memoryConfiguration;
  updateForwardingControl();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function opcodeExtensionEnabled(entry) {
  if (entry.extension === "Pseudo") return true;
  const extensions = new Set((session.state.current?.isa?.extensions
    || ["i", "m", "a", "f", "zicsr", "zifencei"])
    .map(extension => extension.toLowerCase()));
  return extensions.has(entry.extension.toLowerCase());
}

function activeOpcodeCandidates(prefix) {
  return RISCV_OPCODE_CATALOG
    .filter(entry => opcodeExtensionEnabled(entry)
      && entry.mnemonic.toLowerCase().startsWith(prefix));
}

function updateDirtyIndicator() {
  document.title = session.state.sourceDirty ? `${STUDIO_NAME} • Unsaved` : STUDIO_NAME;
  if (!session.state.current) return;
  $("#project-title").textContent = session.state.current.name + (session.state.sourceDirty ? " • Unsaved" : "");
}

function markSourceEdited() {
  session.update({sourceDirty: Boolean(session.state.current) && sourceEditor.getValue() !== session.state.savedSource});
  updateDirtyIndicator();
}

function draftStorageKey(name) {
  return name ? `ase-studio-draft:${name}` : "";
}

function setDraftStatus(message = "") {
  const status = $("#draft-status");
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
  status.title = message;
}

function readLocalDraft(name) {
  const key = draftStorageKey(name);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || typeof draft.text !== "string" || typeof draft.timestamp !== "number") return null;
    return draft;
  } catch (_error) {
    return null;
  }
}

function clearLocalDraft(name = session.state.current?.name) {
  if (draftSaveTimer !== null) {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }
  const key = draftStorageKey(name);
  if (key) {
    try { localStorage.removeItem(key); } catch (_error) { /* Storage may be unavailable. */ }
  }
  setDraftStatus();
}

function writeLocalDraft() {
  draftSaveTimer = null;
  if (!session.state.current || !session.state.sourceDirty) return;
  const text = sourceEditor.getValue();
  if (text === session.state.savedSource) {
    clearLocalDraft(session.state.current.name);
    return;
  }
  try {
    localStorage.setItem(draftStorageKey(session.state.current.name), JSON.stringify({
      text,
      timestamp: Date.now(),
      sourceName: session.state.current.sourceName
    }));
    setDraftStatus("Local draft saved");
  } catch (_error) {
    setDraftStatus("Local draft unavailable");
  }
}

function scheduleLocalDraft() {
  if (!session.state.current) return;
  if (!session.state.sourceDirty) {
    clearLocalDraft(session.state.current.name);
    return;
  }
  if (draftSaveTimer !== null) clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(writeLocalDraft, 250);
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  if (!session.state.current || !session.state.sourceDirty) return;
  setDraftStatus("Saving…");
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    save({automatic: true}).catch(() => { /* save keeps the draft and displays the error. */ });
  }, 400);
}

function linkerSymbolFromDiagnostic(text) {
  const match = String(text || "").match(
    /(?:undefined reference to|multiple definition of|against (?:the )?symbol)\s+[`'\"]([^`'\"]+)[`'\"]/i
  );
  return match ? match[1].trim() : "";
}

function linkerFunctionFromDiagnostic(text) {
  const quoted = String(text || "").match(/\bin function\s+[`'\"]([^`'\"]+)[`'\"]/i);
  if (quoted) return quoted[1].trim();
  const plain = String(text || "").match(/\bin function\s+([A-Za-z_.$][\w.$]*)/i);
  return plain ? plain[1].trim() : "";
}

function linkerSourceLocation(sourceText, symbol, functionName) {
  if (!sourceText) return null;
  const lines = String(sourceText).split(/\r?\n/);
  const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const functionPattern = functionName
    ? new RegExp(`^\\s*${escapeRegExp(functionName)}\\s*:`)
    : null;
  const symbolPattern = symbol
    ? new RegExp(`(^|[^A-Za-z0-9_.$])${escapeRegExp(symbol)}(?=$|[^A-Za-z0-9_.$])`, "g")
    : null;
  const candidates = [];
  let functionLine = -1;

  lines.forEach((rawLine, index) => {
    const code = rawLine.split("#", 1)[0];
    if (functionPattern && functionLine < 0 && functionPattern.test(code)) functionLine = index;
    if (!symbolPattern || !code.trim()
        || /^\s*\.(?:globl|global|extern|weak|hidden|type|size|local|set)\b/i.test(code)
        || new RegExp(`^\\s*${escapeRegExp(symbol)}\\s*:`).test(code)) return;
    symbolPattern.lastIndex = 0;
    let match;
    while ((match = symbolPattern.exec(code))) {
      const tokenOffset = match.index + (match[1] ? 1 : 0);
      candidates.push({line: index + 1, column: tokenOffset + 1});
      if (match.index === symbolPattern.lastIndex) symbolPattern.lastIndex += 1;
    }
  });

  const scopedCandidates = functionLine >= 0
    ? candidates.filter(candidate => candidate.line >= functionLine + 1)
    : candidates;
  const location = scopedCandidates[0] || candidates[0];
  if (location) return location;
  if (functionLine >= 0) {
    const column = Math.max(1, lines[functionLine].search(/\S/) + 1);
    return {line: functionLine + 1, column};
  }
  return null;
}

function parseCompilerDiagnostics(output) {
  const sourceName = String(session.state.current?.sourceName || "").toLowerCase();
  const sourceText = typeof document === "undefined"
    ? "" : document.getElementById("body")?.value || "";
  const diagnostics = [];
  let linkerFunction = "";
  String(output || "").split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^(.*?\.(?:s|asm)):(\d+)(?::(\d+))?:\s*(?:(?:fatal\s+)?(error|warning|note)\s*:\s*)?(.*)$/i);
    if (match) {
      const file = match[1].trim();
      const basename = file.split(/[\\/]/).pop().toLowerCase();
      if (!sourceName || (basename !== sourceName && file.toLowerCase() !== sourceName)) return;
      const severity = (match[4] || "error").toLowerCase();
      const message = match[5].trim() || "Assembler diagnostic";
      diagnostics.push({
        severity,
        file: basename,
        line: Number(match[2]),
        column: Number(match[3] || 1),
        message,
        outputLine: index + 1,
        kind: "compiler"
      });
      return;
    }
    const trimmed = line.trim();
    if (!trimmed || /^make(?:\[.*\])?:/i.test(trimmed)) return;
    const functionName = linkerFunctionFromDiagnostic(trimmed);
    if (functionName) linkerFunction = functionName;
    if (!/(?:undefined reference to|multiple definition of|relocation .*\bagainst\s+(?:the\s+)?symbol|collect2:\s*error:|cannot find\s+-l|(?:ld|as):.*\bfatal error:|(?:ld|as):.*\berror:)/i.test(trimmed)) return;
    const symbol = linkerSymbolFromDiagnostic(trimmed);
    const location = symbol ? linkerSourceLocation(sourceText, symbol, linkerFunction) : null;
    diagnostics.push({severity: "error", file: location ? sourceName : "",
      line: location?.line || null, column: location?.column || 1,
      message: trimmed, outputLine: index + 1, kind: "linker",
      inferred: Boolean(location)});
  });
  return diagnostics;
}

function scaffoldEditsAllowed() {
  return !scaffoldProtectionEnabled || scaffoldEditAuthorized;
}

function updateScaffoldProtectionUi(message = "") {
  sourceEditor.setProtectionEnabled(scaffoldProtectionEnabled);
  const control = $("#scaffold-protection");
  const status = $("#scaffold-protection-status");
  control.checked = scaffoldProtectionEnabled;
  control.disabled = !session.state.current;
  control.title = scaffoldProtectionEnabled
    ? "Required _start and End labels and the exit block are read-only."
    : "Label protection is off. Required labels and the exit block can be edited.";
  status.hidden = !session.state.current || (scaffoldProtectionEnabled && !message);
  status.textContent = message || (scaffoldProtectionEnabled
    ? ""
    : "Label protection is off. Simulation requires one _start label and one valid End exit block.");
}

function validateSimulationScaffold(text) {
  const labels = {start: [], end: []};
  const statements = [];
  let startIsGlobal = false;
  const labelPattern = /^([A-Za-z_.$][\w.$]*)\s*:\s*/;

  String(text).split(/\r?\n/).forEach((rawLine, index) => {
    let code = rawLine.split("#", 1)[0].trim();
    if (/^\.(?:globl|global)\s+_start\b/i.test(code)) startIsGlobal = true;
    while (true) {
      const match = code.match(labelPattern);
      if (!match) break;
      const label = match[1];
      if (label === "_start") {
        labels.start.push({line: index + 1, nextStatement: statements.length});
      } else if (label.toLowerCase() === "end") {
        labels.end.push({line: index + 1, nextStatement: statements.length});
      }
      code = code.slice(match[0].length).trimStart();
    }
    if (code) statements.push(code);
  });

  const issues = [];
  const describeLabels = (name, found) => {
    if (!found.length) issues.push(`Missing required ${name}: label.`);
    else if (found.length > 1) {
      issues.push(`Found ${name}: on lines ${found.map(item => item.line).join(", ")}; keep only one.`);
    }
  };
  describeLabels("_start", labels.start);
  if (labels.start.length === 1 && !startIsGlobal) {
    issues.push("The _start label must be exported with .globl _start.");
  }
  describeLabels("End", labels.end);

  if (labels.end.length === 1) {
    const end = labels.end[0];
    const exit = statements.slice(end.nextStatement, end.nextStatement + 3);
    if (exit.length < 3
        || !/^li\s+(?:a0|x10)\s*,\s*0$/i.test(exit[0])
        || !/^li\s+(?:a7|x17)\s*,\s*93$/i.test(exit[1])
        || !/^ecall$/i.test(exit[2])) {
      issues.push(`End: on line ${end.line} must be followed by li a0, 0; li a7, 93; and ecall.`);
    }
  }
  return issues;
}

const INTEGER_REGISTER_ALIASES = {
  zero: "x0", ra: "x1", sp: "x2", gp: "x3", tp: "x4",
  t0: "x5", t1: "x6", t2: "x7", s0: "x8", fp: "x8", s1: "x9",
  a0: "x10", a1: "x11", a2: "x12", a3: "x13", a4: "x14", a5: "x15",
  a6: "x16", a7: "x17", s2: "x18", s3: "x19", s4: "x20", s5: "x21",
  s6: "x22", s7: "x23", s8: "x24", s9: "x25", s10: "x26", s11: "x27",
  t3: "x28", t4: "x29", t5: "x30", t6: "x31"
};
const FLOAT_REGISTER_ALIASES = {
  ft0: "f0", ft1: "f1", ft2: "f2", ft3: "f3", ft4: "f4", ft5: "f5",
  ft6: "f6", ft7: "f7", fs0: "f8", fs1: "f9", fa0: "f10", fa1: "f11",
  fa2: "f12", fa3: "f13", fa4: "f14", fa5: "f15", fa6: "f16", fa7: "f17",
  fs2: "f18", fs3: "f19", fs4: "f20", fs5: "f21", fs6: "f22", fs7: "f23",
  fs8: "f24", fs9: "f25", fs10: "f26", fs11: "f27", ft8: "f28", ft9: "f29",
  ft10: "f30", ft11: "f31"
};

function splitAssemblyOperands(text) {
  const operands = [];
  let token = "";
  let depth = 0;
  for (const character of String(text || "")) {
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (character === "," && depth === 0) {
      operands.push(token.trim());
      token = "";
    } else token += character;
  }
  if (token.trim() || operands.length) operands.push(token.trim());
  return operands;
}

function parseAssemblyLine(rawLine, lineNumber) {
  const sourceCode = String(rawLine).split("#", 1)[0];
  let code = sourceCode.trim();
  let codeOffset = sourceCode.search(/\S/);
  const labels = [];
  const labelPattern = /^([A-Za-z_.$][\w.$]*)\s*:\s*/;
  while (code) {
    const label = code.match(labelPattern);
    if (!label) break;
    labels.push(label[1]);
    code = code.slice(label[0].length);
    codeOffset += label[0].length;
    const leadingWhitespace = code.length - code.trimStart().length;
    code = code.trimStart();
    codeOffset += leadingWhitespace;
  }
  if (!code || code.startsWith(".")) return {line: lineNumber, labels, instruction: null};
  const match = code.match(/^([A-Za-z][A-Za-z0-9_.]*)(?:\s+(.*))?$/);
  if (!match) return {line: lineNumber, labels, instruction: null, malformed: code};
  const operandsText = match[2] || "";
  return {
    line: lineNumber,
    labels,
    instruction: {
      mnemonic: match[1].toLowerCase(),
      operandsText,
      operandsOffset: operandsText ? codeOffset + match[0].length - operandsText.length : null
    }
  };
}

function canonicalRegister(token) {
  const value = String(token || "").trim().toLowerCase();
  if (INTEGER_REGISTER_ALIASES[value]) return INTEGER_REGISTER_ALIASES[value];
  if (FLOAT_REGISTER_ALIASES[value]) return FLOAT_REGISTER_ALIASES[value];
  const integer = value.match(/^x(\d+)$/);
  if (integer && Number(integer[1]) < 32) return `x${Number(integer[1])}`;
  const floating = value.match(/^f(\d+)$/);
  if (floating && Number(floating[1]) < 32) return `f${Number(floating[1])}`;
  return null;
}

function registerTokens(text) {
  const pattern = /\b(?:x\d+|f\d+|zero|ra|sp|gp|tp|fp|[ast]\d+|f[tsa]\d+)\b/gi;
  return [...String(text || "").matchAll(pattern)].map(match => ({token: match[0], index: match.index}));
}

function instructionTemplateOperandCount(entry) {
  const sample = String(entry.template || "").replace(/\{\d+\}/g, "x1");
  const operandText = sample.replace(/^[^\s]+\s*/, "");
  return operandText ? splitAssemblyOperands(operandText).length : 0;
}

function numericTokens(text) {
  return splitAssemblyOperands(text).flatMap(operand => operand
    .split(/[\s()]+/).map(token => token.trim()).filter(token =>
      /^[-+]?(?:0x[0-9a-f]+|0b[01]+|0o[0-7]+|\d+)$/i.test(token)));
}

function numericValue(token) {
  try {
    const value = String(token).trim();
    const sign = value.startsWith("-") ? -1 : 1;
    const unsigned = value.replace(/^[+-]/, "");
    return sign * Number(BigInt(unsigned));
  } catch (_error) {
    return null;
  }
}

function immediateConstraint(mnemonic, value) {
  if (value === null || mnemonic.startsWith("c.")) return null;
  if (/^(?:slli|srli|srai)$/.test(mnemonic)) return {min: 0, max: 31, label: "shift amount"};
  if (/^csr(?:rw|rs|rc)i$/.test(mnemonic)) return {min: 0, max: 31, label: "CSR immediate"};
  if (/^(?:beq|bne|blt|bge|bltu|bgeu)$/.test(mnemonic)) {
    return {min: -4096, max: 4094, alignment: 2, label: "branch offset"};
  }
  if (/^(?:jal)$/.test(mnemonic)) {
    return {min: -1048576, max: 1048574, alignment: 2, label: "jump offset"};
  }
  if (/^(?:lui|auipc)$/.test(mnemonic)) return {min: -524288, max: 1048575, label: "upper immediate"};
  if (/^(?:addi|slti|sltiu|xori|ori|andi|jalr|lb|lh|lw|lbu|lhu|sb|sh|sw|flw|fld|fsw|fsd)$/.test(mnemonic)) {
    return {min: -2048, max: 2047, label: "immediate"};
  }
  return null;
}

function validateProgramSource(text) {
  const sourceLines = String(text).split(/\r?\n/);
  const parsedLines = sourceLines.map((line, index) => parseAssemblyLine(line, index + 1));
  const labels = new Map();
  const errors = [];
  parsedLines.forEach(parsed => parsed.labels.forEach(label => {
    if (labels.has(label)) {
      errors.push({severity: "error", line: parsed.line, column: 1,
        message: `Duplicate label “${label}”.`, kind: "validation"});
    } else labels.set(label, parsed.line);
  }));

  parsedLines.forEach(parsed => {
    if (parsed.malformed) {
      errors.push({severity: "error", line: parsed.line, column: 1,
        message: "Could not parse this assembly statement.", kind: "validation"});
      return;
    }
    if (!parsed.instruction) return;
    const {mnemonic, operandsText} = parsed.instruction;
    const allMatches = RISCV_OPCODE_CATALOG.filter(entry => entry.mnemonic.toLowerCase() === mnemonic);
    const enabledMatches = activeOpcodeCandidates(mnemonic).filter(entry =>
      entry.mnemonic.toLowerCase() === mnemonic);
    if (!enabledMatches.length) {
      const reason = allMatches.length
        ? `Opcode “${mnemonic}” is not enabled by the active ISA.`
        : `Unknown opcode “${mnemonic}”.`;
      errors.push({severity: "error", line: parsed.line, column: 1, message: reason, kind: "validation"});
      return;
    }
    const entry = enabledMatches[0];
    const operands = splitAssemblyOperands(operandsText);
    const expected = instructionTemplateOperandCount(entry);
    const acceptsSymbolBaseForm = /^(?:l[bhwd]|fl[wd]|s[bhwd]|fs[wd])$/.test(mnemonic)
      && operands.length === 3 && canonicalRegister(operands[2]);
    if (operands.length !== expected && !acceptsSymbolBaseForm) {
      errors.push({severity: "error", line: parsed.line, column: 1,
        message: `${mnemonic} expects ${expected}${acceptsSymbolBaseForm ? " or 3" : ""} operand${expected === 1 ? "" : "s"}; found ${operands.length}.`,
        kind: "validation"});
    }

    registerTokens(operandsText).forEach(({token, index}) => {
      const canonical = canonicalRegister(token);
      if (canonical) return;
      errors.push({severity: "error", line: parsed.line,
        column: Math.max(1, parsed.instruction.operandsOffset + index + 1),
        message: `Invalid register “${token}”. Register numbers must be x0–x31 or f0–f31.`,
        kind: "validation"});
    });

    const numbers = numericTokens(operandsText);
    const range = immediateConstraint(mnemonic, numericValue(numbers[numbers.length - 1]));
    if (range && numbers.length) {
      const value = numericValue(numbers[numbers.length - 1]);
      if (value < range.min || value > range.max) {
        errors.push({severity: "error", line: parsed.line, column: 1,
          message: `${range.label} ${value} is outside ${range.min}…${range.max}.`, kind: "validation"});
      } else if (range.alignment && value % range.alignment !== 0) {
        errors.push({severity: "error", line: parsed.line, column: 1,
          message: `${range.label} must be aligned to ${range.alignment} bytes.`, kind: "validation"});
      }
    }

    if (entry.operands.some(operand => operand.kind === "label") && operands.length) {
      const target = operands[operands.length - 1].trim().replace(/[()]/g, "");
      const targetMatch = target.match(/^([A-Za-z_.$][\w.$]*)/);
      if (targetMatch && !canonicalRegister(targetMatch[1])
          && !/^[-+]?(?:0x[0-9a-f]+|0b[01]+|0o[0-7]+|\d+)$/i.test(targetMatch[1])
          && !labels.has(targetMatch[1])) {
        errors.push({severity: "error", line: parsed.line, column: 1,
          message: `Label “${targetMatch[1]}” is not defined in this source.`, kind: "validation"});
      }
    }
  });
  return errors;
}

function refreshScaffoldProtectionUi() {
  if (!session.state.current) {
    updateScaffoldProtectionUi();
    return;
  }
  const issues = validateSimulationScaffold(sourceEditor.getValue());
  if (scaffoldProtectionEnabled && issues.length) {
    scaffoldProtectionEnabled = false;
    scaffoldEditAuthorized = true;
  }
  updateScaffoldProtectionUi(issues.length
    ? `Label protection is off because: ${issues.join(" ")}`
    : "");
}

function resetScaffoldProtection() {
  scaffoldProtectionEnabled = true;
  scaffoldEditAuthorized = false;
  refreshScaffoldProtectionUi();
}

$("#scaffold-protection").addEventListener("change", event => {
  if (!session.state.current) return;
  if (event.target.checked) {
    const issues = validateSimulationScaffold(sourceEditor.getValue());
    if (issues.length) {
      scaffoldProtectionEnabled = false;
      scaffoldEditAuthorized = true;
      refreshScaffoldProtectionUi();
      return;
    }
    scaffoldProtectionEnabled = true;
  } else {
    scaffoldProtectionEnabled = false;
    scaffoldEditAuthorized = true;
  }
  refreshScaffoldProtectionUi();
  services.syncEditor();
});

function highlightAsmLine(line) {
  const commentAt = line.indexOf("#");
  let code = commentAt >= 0 ? line.slice(0, commentAt) : line;
  const comment = commentAt >= 0 ? line.slice(commentAt) : "";

  code = escapeHtml(code)
    .replace(/(^|\s)(\.[\w.]+)/g, '$1<span class="directive">$2</span>')
    .replace(/\b(x(?:[12]?\d|3[01]|0)|f(?:[12]?\d|3[01]|0)|zero|ra|sp|gp|tp|[ast]([0-9]|10|11)|ft(?:[0-9]|10|11)|fs(?:[0-9]|10|11)|fa[0-7])\b/g,
      '<span class="register">$&</span>')
    .replace(/\b(c[._][a-z][\w.]*|add|addi|sub|sll|slli|slt|slti|sltu|sltiu|xor|xori|srl|srli|sra|srai|or|ori|and|andi|lui|auipc|lb|lbu|lh|lhu|lw|lwu|ld|sb|sh|sw|sd|mul|mulh|mulhsu|mulhu|div|divu|rem|remu|flw|fld|fsw|fsd|f(?:add|sub|mul|div|min|max)\.[sd]|f(?:madd|msub|nmsub|nmadd)\.[sd]|fsqrt\.[sd]|fsgnj[nx]?\.[sd]|f(?:eq|lt|le|class)\.[sd]|fcvt\.(?:w|wu|l|lu|s|d)\.(?:w|wu|l|lu|s|d)|fmv\.(?:x\.w|w\.x)|(?:lr|sc|amo(?:swap|add|xor|and|or|min|max|minu|maxu))\.w|beqz|bnez|beq|bne|blt|bge|bltu|bgeu|jal|jalr|j|jr|ret|call|tail|li|la|mv|neg|not|seqz|snez|sltz|sgtz|csrrw|csrrs|csrrc|csrrwi|csrrsi|csrrci|csrr|csrw|csrs|csrc|csrwi|csrsi|csrci|rdcycle|rdtime|rdinstret|fence\.i|fence|nop|ecall|ebreak|wfi|mret)\b/gi,
      '<span class="opcode">$&</span>')
    .replace(/^(\s*)([\w.]+):/, '$1<span class="label">$2</span>:');

  return code + (comment ? `<span class="comment">${escapeHtml(comment)}</span>` : "");
}

async function loadProjects() {
  services.renderProjects(await api("/api/projects"));
}

async function resolveUnsavedProject(action) {
  try {
    while (session.state.current && (session.state.sourceDirty || saveInFlight)) await save({automatic: true});
    return true;
  } catch (error) {
    await showActionMessage("Could not save project", `Your edits are still in the editor. Could not ${action}: ${error.message}`);
    return false;
  }
}

async function openProject(name, {skipUnsavedCheck = false} = {}) {
  const request = ++projectOpenRequest;
  if (name === session.state.current?.name) return true;
  if (!skipUnsavedCheck && !await resolveUnsavedProject("open another project")) {
    await loadProjects();
    return false;
  }
  const encodedName = encodeURIComponent(name);
  const [opened, symbolData] = await Promise.all([
    api("/api/project?name=" + encodedName),
    api("/api/symbols?name=" + encodedName).catch(() => ({symbols: []}))
  ]);
  if (request !== projectOpenRequest) return false;
  const localDraft = readLocalDraft(name);
  let recoveredDraft = null;
  if (localDraft && localDraft.text !== opened.text) {
    const timestamp = new Date(localDraft.timestamp).toLocaleString();
    const choice = await actionDialog({
      title: "Recover local draft?",
      message: `ASE Studio found a local draft for “${name}” saved ${timestamp}. Recover it instead of the saved source?`,
      confirmLabel: "Recover",
      confirmValue: "recover",
      alternateLabel: "Discard draft",
      alternateValue: "discard",
      cancelLabel: "Cancel"
    });
    if (choice === null) {
      await loadProjects();
      return false;
    }
    if (choice === "recover") recoveredDraft = localDraft;
    else clearLocalDraft(name);
  } else if (localDraft) {
    clearLocalDraft(name);
  }
  // Edits may have arrived while the new project's files were being fetched.
  if (!skipUnsavedCheck && !await resolveUnsavedProject("open another project")) return false;
  if (request !== projectOpenRequest) return false;
  opened.dataSymbols = symbolData.symbols || [];
  opened.initialMemory = symbolData.initialMemory || {};
  opened.memoryMap = symbolData.memoryMap || [];
  session.update({current: opened});
  services.loadMemoryWatches();
  session.update({selectedSourceLine: null});
  session.update({selectedRow: null});
  session.update({selectedColumn: null});
  session.update({pipelineData: null});
  session.update({playbackCycle: null});
  session.update({stepMode: false});
  $("#project-title").textContent = session.state.current.name;
  $("#source-name").textContent = session.state.current.sourceName;
  sourceEditor.replaceDocument(recoveredDraft ? recoveredDraft.text : session.state.current.text, session.state.current.sourceName);
  resetScaffoldProtection();
  session.update({savedSource: session.state.current.text});
  session.update({sourceDirty: Boolean(recoveredDraft)});
  updateDirtyIndicator();
  setDraftStatus(recoveredDraft
    ? `Recovered draft · ${new Date(recoveredDraft.timestamp).toLocaleTimeString()}` : "");
  services.clearDiagnostics();
  $("#save").disabled = false;
  $("#duplicate").disabled = false;
  $("#open-with").disabled = false;
  $("#rename").disabled = false;
  $("#submit").disabled = false;
  $("#run").disabled = false;
  $("#configure").disabled = false;
  $("#delete").disabled = false;
  $("#reset").disabled = false;
  $("#export-pipeline").disabled = true;
  $("#expand-loops").disabled = false;
  $("#cycle-prev").disabled = true;
  $("#cycle-next").disabled = true;
  $("#cycle-position").textContent = "Cycle —/—";
  $("#step").disabled = false;
  $("#step").textContent = "Run Step";
  services.updateCycleNavigation();
  services.syncEditor();
  services.renderRegisters();
  services.renderMemory();
  await loadProjects();
  session.update({lastNormalLog: ""});
  session.update({lastAdvancedLog: session.state.lastNormalLog});
  if (recoveredDraft) {
    session.update({lastNormalLog: `Recovered a local draft for ${session.state.current.sourceName}. Saving automatically.`});
    session.update({lastAdvancedLog: session.state.lastNormalLog});
    scheduleAutoSave();
  }
  services.updateLog();
  showTab("output");
  return true;
}

async function save({automatic = false} = {}) {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  if (saveInFlight) {
    await saveInFlight;
    if (session.state.sourceDirty) return save({automatic});
    return;
  }
  if (!session.state.current) return;
  if (automatic && !session.state.sourceDirty) return;
  const projectName = session.state.current.name;
  const submittedSource = sourceEditor.getValue();
  const operation = api("/api/save", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({name: projectName, text: submittedSource, allowScaffoldEdit: scaffoldEditsAllowed()})
  }).then(() => {
    if (session.state.current?.name !== projectName) return;
    session.update({savedSource: submittedSource});
    session.update({current:{...session.state.current, text: submittedSource}});
    markSourceEdited();
    if (!session.state.sourceDirty) scaffoldEditAuthorized = false;
    scheduleLocalDraft();
    setDraftStatus(session.state.sourceDirty ? "Saving…" : "Saved");
    if (session.state.sourceDirty) scheduleAutoSave();
    if (!automatic) {
      session.update({lastNormalLog: "Saved " + session.state.current.sourceName + "."});
      session.update({lastAdvancedLog: session.state.lastNormalLog});
      services.updateLog();
    }
  }).catch(error => {
    if (session.state.current?.name === projectName) {
      clearTimeout(draftSaveTimer);
      writeLocalDraft();
      setDraftStatus(`Not saved: ${error.message}`);
    }
    throw error;
  }).finally(() => { saveInFlight = null; });
  saveInFlight = operation;
  return operation;
}

async function openWithChooser() {
  if (!session.state.current) return;
  try {
    if (session.state.sourceDirty) await save();
    const result = await api("/api/open-with", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({name: session.state.current.name})
    });
    session.update({lastNormalLog: result.output});
    session.update({lastAdvancedLog: session.state.lastNormalLog});
    services.updateLog();
  } catch (error) {
    await showActionMessage("Open with", error.message);
  }
}

async function renameCurrentProject() {
  if (!session.state.current) return;
  const oldName = session.state.current.name;
  const newName = await actionDialog({
    title: "Rename project",
    message: "Enter a new name for this project.",
    inputLabel: "Project name",
    inputValue: oldName,
    confirmLabel: "Rename",
    cancelLabel: "Cancel",
    trimInput: false
  });
  if (!newName || newName === oldName) return;
  try {
    const oldWatchKey = services.memoryWatchStorageKey(oldName);
    const savedWatches = oldWatchKey ? localStorage.getItem(oldWatchKey) : null;
    const savedDraft = readLocalDraft(oldName);
    const result = await api("/api/projects", {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({name: oldName, newName})
    });
    session.update({current:{...session.state.current, name: result.name}});
    if (savedWatches !== null) {
      localStorage.setItem(services.memoryWatchStorageKey(result.name), savedWatches);
      localStorage.removeItem(oldWatchKey);
    }
    if (savedDraft) {
      localStorage.setItem(draftStorageKey(result.name), JSON.stringify(savedDraft));
      localStorage.removeItem(draftStorageKey(oldName));
    }
    updateDirtyIndicator();
    await loadProjects();
    session.update({lastNormalLog: `Renamed project "${oldName}" to "${result.name}".`});
    session.update({lastAdvancedLog: session.state.lastNormalLog});
    services.updateLog();
  } catch (error) {
    await showActionMessage("Rename project", error.message);
  }
}

async function duplicateCurrentProject() {
  if (!session.state.current) return;
  const sourceName = session.state.current.name;
  const newName = await actionDialog({
    title: "Duplicate project",
    message: `Create a copy of "${sourceName}".`,
    inputLabel: "New project name",
    inputValue: `${sourceName} copy`,
    confirmLabel: "Duplicate",
    cancelLabel: "Cancel",
    trimInput: false
  });
  if (!newName) return;
  try {
    // The duplicate should include the source currently visible in Studio,
    // including edits that have not yet been written to disk.
    if (session.state.sourceDirty) await save();
    const result = await api("/api/projects/duplicate", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({name: sourceName, newName})
    });
    await loadProjects();
    await openProject(result.name, {skipUnsavedCheck: true});
    session.update({lastNormalLog: `Duplicated project "${sourceName}" as "${result.name}".`});
    session.update({lastAdvancedLog: session.state.lastNormalLog});
    services.updateLog();
  } catch (error) {
    await showActionMessage("Duplicate project", error.message);
  }
}

async function synchronizeExternalSource() {
  if (!session.state.current || session.state.sourceDirty || saveInFlight || externalSyncBusy) return;
  const projectName = session.state.current.name;
  const expectedSource = session.state.savedSource;
  externalSyncBusy = true;
  try {
    const disk = await api("/api/project?name=" + encodeURIComponent(projectName));
    if (!session.state.current || session.state.current.name !== projectName || session.state.sourceDirty || saveInFlight || session.state.savedSource !== expectedSource || disk.text === session.state.savedSource) return;
    session.update({current: disk});
    sourceEditor.replaceDocument(disk.text, disk.sourceName, {preserveView:true});
    session.update({savedSource: disk.text});
    session.update({selectedSourceLine: null});
    session.update({pipelineData: null});
    session.update({playbackCycle: null});
    session.update({stepMode: false});
    $("#source-name").textContent = disk.sourceName;
    $("#export-pipeline").disabled = true;
    $("#cycle-prev").disabled = true;
    $("#cycle-next").disabled = true;
    $("#cycle-position").textContent = "Cycle —/—";
    updateDirtyIndicator();
    refreshScaffoldProtectionUi();
    services.syncEditor();
    services.renderRegisters();
    services.renderPipeline();
  } catch (_error) {
    // A project can briefly be unavailable while it is being renamed/deleted.
  } finally {
    externalSyncBusy = false;
  }
}

function formatSubmissionFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KiB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MiB";
}

function renderSubmissionFiles() {
  const files = [...($("#submission-files").files || [])];
  $("#submission-file-list").innerHTML = files.length
    ? files.map(file => '<div class="submission-file-entry"><strong>' + escapeHtml(file.name) + "</strong><span>" + formatSubmissionFileSize(file.size) + "</span></div>").join("")
    : "No additional files selected.";
}

function submissionAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read " + file.name + "."));
    reader.onload = () => {
      const result = String(reader.result || "");
      const separator = result.indexOf(",");
      if (separator < 0) {
        reject(new Error("Could not encode " + file.name + "."));
        return;
      }
      resolve({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64: result.slice(separator + 1)
      });
    };
    reader.readAsDataURL(file);
  });
}

async function submitAssignment() {
  if (!session.state.current || !await resolveUnsavedProject("prepare a submission")) return;
  try {
    const data = await api("/api/projects");
    $("#submission-projects").innerHTML = data.projects.map(name =>
      '<label class="submission-project"><input type="checkbox" data-submission-project value="' + escapeHtml(name) + '" ' + (name === session.state.current.name ? "checked" : "") + '><span title="' + escapeHtml(name) + '">' + escapeHtml(name) + "</span></label>"
    ).join("");
    $("#submission-assignment").value = "";
    $("#submission-files").value = "";
    $("#submission-expand-loops").checked = $("#expand-loops").checked;
    renderSubmissionFiles();
    $("#submission-dialog").showModal();
    $("#submission-assignment").focus();
  } catch (error) {
    await showActionMessage("Prepare submission", error.message);
  }
}

async function prepareSubmission() {
  if (!session.state.current) return;
  const assignment = $("#submission-assignment").value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(assignment)) {
    await showActionMessage("Invalid assignment name",
      "Use a name beginning with a letter and containing only letters, digits, '_' or '-'.");
    return;
  }
  const selectedNames = [...document.querySelectorAll("[data-submission-project]:checked")]
    .map(input => input.value);
  if (!selectedNames.length) {
    await showActionMessage("Prepare submission", "Select at least one project.");
    return;
  }
  if (selectedNames.includes(session.state.current.name)) {
    const scaffoldIssues = validateSimulationScaffold(sourceEditor.getValue());
    if (scaffoldIssues.length) {
      const hint = scaffoldProtectionEnabled
        ? "Turn off Protect labels to edit protected lines."
        : "Correct the required labels and exit block, then try again.";
      await showActionMessage("Cannot prepare submission",
        `${scaffoldIssues.join("\n")}\n\n${hint}`);
      return;
    }
  }
  const files = [...($("#submission-files").files || [])];
  if (files.length > 20) {
    await showActionMessage("Prepare submission", "Choose no more than 20 additional files.");
    return;
  }
  const tooLarge = files.find(file => file.size > 25 * 1024 * 1024);
  if (tooLarge) {
    await showActionMessage("Prepare submission", tooLarge.name + " exceeds the 25 MiB limit.");
    return;
  }
  const totalSize = files.reduce((total, file) => total + file.size, 0);
  if (totalSize > 100 * 1024 * 1024) {
    await showActionMessage("Prepare submission", "Additional files exceed the combined 100 MiB limit.");
    return;
  }

  const confirmButton = $("#submission-confirm");
  const cancelButton = $("#cancel-submission");
  confirmButton.disabled = true;
  cancelButton.disabled = true;
  confirmButton.textContent = "Reading files…";
  let attachments;
  try {
    attachments = await Promise.all(files.map(submissionAttachment));
  } catch (error) {
    confirmButton.disabled = false;
    cancelButton.disabled = false;
    confirmButton.textContent = "Create submission";
    await showActionMessage("Prepare submission", error.message);
    return;
  }

  const submittedProjectName = session.state.current.name;
  const submittedSource = sourceEditor.getValue();
  const currentWasSelected = selectedNames.includes(submittedProjectName);
  const projects = selectedNames.map(name => ({
    name,
    source: name === submittedProjectName ? submittedSource : null,
    allowScaffoldEdit: name === submittedProjectName && scaffoldEditsAllowed()
  }));
  $("#submission-dialog").close();
  confirmButton.disabled = false;
  cancelButton.disabled = false;
  confirmButton.textContent = "Create submission";

  const controls = ["#submit", "#run", "#step", "#reset", "#configure"];
  controls.forEach(selector => { $(selector).disabled = true; });
  $("#submit").textContent = "Submitting…";
  session.update({lastNormalLog: "Building and simulating " + projects.length + " selected project(s)…"});
  session.update({lastAdvancedLog: session.state.lastNormalLog});
  services.updateLog();
  showTab("output");
  try {
    const result = await api("/api/submit", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        assignment,
        projects,
        attachments,
        expandLoops: $("#submission-expand-loops").checked
      })
    });
    if (currentWasSelected && session.state.current?.name === submittedProjectName) {
      scaffoldEditAuthorized = false;
      session.update({savedSource: submittedSource});
      session.update({sourceDirty: sourceEditor.getValue() !== submittedSource});
      updateDirtyIndicator();
    }
    session.update({lastNormalLog: result.output});
    session.update({lastAdvancedLog: result.advancedOutput || result.output});
    if (currentWasSelected && session.state.current?.name === submittedProjectName) {
      const diagnostics = parseCompilerDiagnostics(session.state.lastAdvancedLog);
      services.setDiagnostics(diagnostics, diagnostics.some(item => item.severity === "error")
        ? "Compiler diagnostics" : "Compiler messages");
      if (!session.state.sourceDirty) clearLocalDraft(session.state.current.name);
    }
    services.updateLog();
    if (result.ok && result.archive) {
      try {
        await api("/api/submission/reveal", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({archive: result.archive})
        });
      } catch (revealError) {
        const warning = "The submission was created, but its folder could not be opened: " + revealError.message;
        session.update({lastNormalLog: session.state.lastNormalLog + "\n\n" + warning});
        session.update({lastAdvancedLog: session.state.lastAdvancedLog + "\n\n" + warning});
        services.updateLog();
      }
    }
    if (result.ok && currentWasSelected && session.state.current?.name === submittedProjectName) {
      const trace = await api("/api/pipeline?name=" + encodeURIComponent(session.state.current.name));
      appendSimulationReports(trace);
      session.update({current:{...session.state.current, dataSymbols: trace.dataSymbols || []}});
      session.update({current:{...session.state.current, initialMemory: trace.initialMemory || {}}});
      session.update({current:{...session.state.current, memoryMap: trace.memoryMap || []}});
      if (trace.tooLarge) {
        session.update({pipelineData: null});
        session.update({playbackCycle: null});
        session.update({stepMode: false});
        $("#step").textContent = "Run Step";
        const notice = "Pipeline not displayed: " + trace.cycles + " cycles exceeds the " + trace.limit + "-cycle limit.\nExecuted instructions: " + trace.instructions + " · Stalls: " + trace.stalls + " · CPI: " + trace.cpi + "\nFull pipeline CSV: " + trace.csvPath;
        session.update({lastNormalLog: session.state.lastNormalLog + "\n\n" + notice});
        session.update({lastAdvancedLog: session.state.lastAdvancedLog + "\n\n" + notice});
        services.updateLog();
        services.renderPipeline();
        showTab("output");
      } else {
        session.update({pipelineData: trace});
        session.update({playbackCycle: session.state.pipelineData.cycles});
        session.update({selectedColumn: null});
        session.update({stepMode: false});
        $("#step").textContent = "Run Step";
        $("#export-pipeline").disabled = false;
        $("#expand-loops").disabled = false;
        services.renderPipeline();
      }
    }
  } catch (error) {
    session.update({lastNormalLog: "Submission failed\n" + error.message});
    session.update({lastAdvancedLog: session.state.lastNormalLog});
    services.updateLog();
  } finally {
    controls.forEach(selector => { $(selector).disabled = false; });
    $("#submit").textContent = "Submit";
    $("#export-pipeline").disabled = !session.state.pipelineData;
    $("#expand-loops").disabled = false;
  }
}

function showTab(tab) { shell.open(tab); }


async function run(stepAfterRun = false) {
  if (!session.state.current || !await resolveUnsavedProject("run the program")) return;
  const source = sourceEditor.getValue();
  const sourceIssues = validateProgramSource(source);
  const scaffoldIssues = validateSimulationScaffold(source);
  const preRunIssues = [
    ...sourceIssues,
    ...scaffoldIssues.map(message => ({severity: "error", message, kind: "scaffold"}))
  ];
  services.clearDiagnostics();
  services.clearSourceLineHighlight();
  if (!stepAfterRun) {
    session.update({stepMode: false});
    $("#step").textContent = "Run Step";
  }
  $("#run").disabled = true;
  $("#submit").disabled = true;
  $("#reset").disabled = true;
  $("#export-pipeline").disabled = true;
  $("#expand-loops").disabled = true;
  $("#step").disabled = true;
  $("#cycle-jump").disabled = true;
  $("#cycle-jump-form button").disabled = true;
  $("#run").textContent = "Running…";
  session.update({lastNormalLog: "Building and simulating…"});
  session.update({lastAdvancedLog: session.state.lastNormalLog});
  services.updateLog();
  showTab("output");
  try {
    const result = await api("/api/run", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({name: session.state.current.name, text: source,
        allowScaffoldEdit: scaffoldEditsAllowed()})
    });
    scaffoldEditAuthorized = false;
    session.update({savedSource: source});
    markSourceEdited();
    scheduleLocalDraft();
    session.update({lastNormalLog: result.output});
    session.update({lastAdvancedLog: result.advancedOutput || result.output});
    const compilerDiagnostics = parseCompilerDiagnostics(session.state.lastAdvancedLog);
    if (compilerDiagnostics.length) {
      services.setDiagnostics(compilerDiagnostics, compilerDiagnostics.some(item => item.severity === "error")
        ? "Compiler diagnostics" : "Compiler messages");
    } else if (!result.ok && preRunIssues.length) {
      services.setDiagnostics(preRunIssues.map(issue => ({...issue, severity: "warning"})), "Pre-run hints");
    } else {
      services.clearDiagnostics();
    }
    services.updateLog();
    if (result.ok) {
      const trace = await api("/api/pipeline?name=" + encodeURIComponent(session.state.current.name));
      appendSimulationReports(trace);
      session.update({current:{...session.state.current, dataSymbols: trace.dataSymbols || []}});
      session.update({current:{...session.state.current, initialMemory: trace.initialMemory || {}}});
      session.update({current:{...session.state.current, memoryMap: trace.memoryMap || []}});
      if (trace.tooLarge) {
        session.update({pipelineData: null});
        session.update({playbackCycle: null});
        session.update({stepMode: false});
        $("#step").textContent = "Run Step";
        const notice = `Pipeline not displayed: ${trace.cycles} cycles exceeds the ${trace.limit}-cycle limit.\nExecuted instructions: ${trace.instructions} · Stalls: ${trace.stalls} · CPI: ${trace.cpi}\nFull pipeline CSV: ${trace.csvPath}`;
        session.update({lastNormalLog: session.state.lastNormalLog + `\n\n${notice}`});
        session.update({lastAdvancedLog: session.state.lastAdvancedLog + `\n\n${notice}`});
        services.updateLog();
        services.renderPipeline();
        showTab("output");
      } else {
        session.update({pipelineData: trace});
        session.update({playbackCycle: stepAfterRun ? 1 : session.state.pipelineData.cycles});
        session.update({selectedRow: null});
        session.update({selectedColumn: stepAfterRun ? 1 : null});
        session.update({stepMode: stepAfterRun});
        $("#export-pipeline").disabled = false;
        $("#expand-loops").disabled = false;
        $("#step").textContent = stepAfterRun ? "Next Cycle" : "Run Step";
        services.resetPipelineViewport();
        services.renderPipeline();
        services.resetPipelineViewport();
        showTab("pipeline");
      }
    }
  } catch (error) {
    session.update({lastNormalLog: "Request failed\n" + error.message});
    session.update({lastAdvancedLog: session.state.lastNormalLog});
    services.updateLog();
  } finally {
    $("#run").disabled = false;
    $("#submit").disabled = false;
    $("#reset").disabled = false;
    $("#export-pipeline").disabled = !session.state.pipelineData;
    $("#expand-loops").disabled = false;
    $("#step").disabled = false;
    $("#run").textContent = "Run ▶";
    services.updateCycleNavigation();
  }
}

function resetSimulation() {
  if (!session.state.current) return;
  session.update({pipelineData: null});
  session.update({selectedRow: null});
  session.update({selectedColumn: null});
  session.update({selectedSourceLine: null});
  session.update({playbackCycle: null});
  session.update({stepMode: false});
  $("#step").textContent = "Run Step";
  $("#export-pipeline").disabled = true;
  $("#expand-loops").disabled = false;
  $("#cycle-prev").disabled = true;
  $("#cycle-next").disabled = true;
  $("#cycle-position").textContent = "Cycle —/—";
  services.updateCycleNavigation();
  $("#pipeline-grid").innerHTML = "";
  $("#pipeline-diagram").innerHTML = "";
  $("#pipeline-summary").textContent = "No pipeline trace loaded. Press Run or Run Step.";
  $("#detail").textContent = "Hover a pipeline cell to inspect it.";
  services.resetPipelineViewport();
  services.renderRegisters();
  services.renderMemory();
  services.syncEditor();
  showTab("pipeline");
}

function formatWordValue(value, format, width = 32) {
  let bits;
  try {
    bits = BigInt.asUintN(width, BigInt(value || 0));
  } catch (_error) {
    bits = 0n;
  }
  switch (format) {
    case "binary":
      return "0b" + bits.toString(2).padStart(width, "0");
    case "signed":
      return BigInt.asIntN(width, bits).toString();
    case "unsigned":
      return bits.toString();
    case "float": {
      const singlePrecision = width === 32;
      const floatBits = singlePrecision ? BigInt.asUintN(32, bits) : bits;
      const buffer = new ArrayBuffer(singlePrecision ? 4 : 8);
      const view = new DataView(buffer);
      if (singlePrecision) view.setUint32(0, Number(floatBits), false);
      else view.setBigUint64(0, floatBits, false);
      const number = singlePrecision ? view.getFloat32(0, false) : view.getFloat64(0, false);
      if (Number.isNaN(number)) return "NaN";
      if (!Number.isFinite(number)) return number < 0 ? "-Infinity" : "Infinity";
      if (Object.is(number, -0)) return "-0";
      return Number(number.toPrecision(8)).toString();
    }
    default:
      return "0x" + bits.toString(16).padStart(width / 4, "0");
  }
}


async function runStep() {
  if (!session.state.current) return;
  if (!session.state.stepMode || !session.state.pipelineData || session.state.playbackCycle >= session.state.pipelineData.cycles) {
    await run(true);
    return;
  }
  session.update({playbackCycle: session.state.playbackCycle + 1});
  session.update({selectedColumn: session.state.playbackCycle});
  $("#step").textContent = session.state.playbackCycle >= session.state.pipelineData.cycles ? "Restart Step" : "Next Cycle";
  services.renderPipeline();
  showTab("pipeline");
}

function movePlaybackCycle(delta) {
  if (!session.state.stepMode || !session.state.pipelineData || session.state.playbackCycle === null) return;
  session.update({playbackCycle: Math.max(1, Math.min(session.state.pipelineData.cycles, session.state.playbackCycle + delta))});
  session.update({selectedColumn: session.state.playbackCycle});
  $("#step").textContent = session.state.playbackCycle >= session.state.pipelineData.cycles ? "Restart Step" : "Next Cycle";
  services.renderPipeline();
  showTab("pipeline");
}


async function jumpToCycle() {
  if (!session.state.stepMode || !session.state.pipelineData || session.state.playbackCycle === null) {
    await showActionMessage(
      "Jump to cycle", "Jump to cycle is available after starting Run Step.");
    return;
  }
  const rawCycle = $("#cycle-jump").value.trim();
  if (!/^\d+$/.test(rawCycle)) {
    await showActionMessage("Jump to cycle", "Enter a whole cycle number.");
    return;
  }
  const targetCycle = Number(rawCycle);
  if (targetCycle < 1 || targetCycle > session.state.pipelineData.cycles) {
    await showActionMessage(
      "Jump to cycle",
      `Cycle ${targetCycle} is outside this trace. Enter a cycle from 1 to ${session.state.pipelineData.cycles}.`);
    return;
  }
  session.update({playbackCycle: targetCycle});
  session.update({selectedColumn: targetCycle});
  $("#step").textContent = session.state.playbackCycle >= session.state.pipelineData.cycles
    ? "Restart Step" : "Next Cycle";
  services.renderPipeline();
  showTab("pipeline");
  services.positionPipelineCycle(targetCycle);
}

function closeChangeContextMenu() {
  changeContextMenu?.remove();
  changeContextMenu = null;
}

function openChangeContextMenu(event, item) {
  closeChangeContextMenu();
  event.preventDefault();
  const menu = document.createElement("div");
  menu.className = "change-context-menu";
  menu.setAttribute("role", "menu");
  [
    ["next", "Go to next change"],
    ["previous", "Go to previous change"]
  ].forEach(([direction, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.onclick = () => {
      closeChangeContextMenu();
      services.execute("trace:change", {item, direction});
    };
    menu.append(button);
  });
  document.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8))}px`;
  changeContextMenu = menu;
  menu.querySelector("button")?.focus();
}

function sameTraceValue(left, right) {
  try {
    return BigInt(left) === BigInt(right);
  } catch (_error) {
    return String(left) === String(right);
  }
}

function registerChangeCycles(register) {
  const deltas = session.state.pipelineData?.registerDeltas || {};
  const initial = session.state.pipelineData?.initialRegisters || {};
  let previous = initial[register] ?? (register === "x0" ? "0x00000000" : undefined);
  const changes = [];
  Object.keys(deltas).map(Number).sort((left, right) => left - right).forEach(cycle => {
    const update = deltas[String(cycle)];
    if (!Object.prototype.hasOwnProperty.call(update, register)) return;
    const value = update[register];
    if (!sameTraceValue(previous, value)) changes.push(cycle);
    previous = value;
  });
  return changes;
}

function memoryChangeCycles(address, width) {
  const start = Number(BigInt(services.canonicalMemoryAddress(address)));
  const byteCount = Math.max(1, Math.floor(Number(width) || 1));
  const bytes = Array(byteCount).fill(null);
  const initialMemory = session.state.pipelineData?.initialMemory || session.state.current?.initialMemory || {};
  Object.entries(initialMemory).forEach(([baseText, hex]) => {
    if (typeof hex !== "string") return;
    const base = Number(BigInt(baseText));
    const first = Math.max(start, base);
    const last = Math.min(start + byteCount, base + Math.floor(hex.length / 2));
    for (let location = first; location < last; location++) {
      const offset = (location - base) * 2;
      const byte = Number.parseInt(hex.slice(offset, offset + 2), 16);
      if (Number.isFinite(byte)) bytes[location - start] = byte;
    }
  });

  const deltas = session.state.pipelineData?.memoryDeltas || {};
  const changes = [];
  Object.keys(deltas).map(Number).sort((left, right) => left - right).forEach(cycle => {
    const before = bytes.slice();
    Object.entries(deltas[String(cycle)] || {}).forEach(([eventAddress, event]) => {
      if (event.access !== "write") return;
      let value;
      try {
        value = BigInt(event.value);
      } catch (_error) {
        return;
      }
      const eventStart = Number(BigInt(eventAddress));
      const eventWidth = Math.max(1, Math.floor((Number(event.bits) || 32) / 8));
      const first = Math.max(start, eventStart);
      const last = Math.min(start + byteCount, eventStart + eventWidth);
      for (let location = first; location < last; location++) {
        const offset = location - eventStart;
        bytes[location - start] = Number((value >> BigInt(offset * 8)) & 0xffn);
      }
    });
    if (bytes.some((value, index) => value !== before[index])) changes.push(cycle);
  });
  return changes;
}

async function navigateToItemChange(item, direction) {
  const label = item.label || item.key;
  const action = direction === "previous" ? "Go to previous change" : "Go to next change";
  if (!session.state.stepMode || !session.state.pipelineData || session.state.playbackCycle === null) {
    await showActionMessage(action, `${action} is available after starting Run Step.`);
    return;
  }

  let changes = [];
  try {
    changes = item.kind === "register"
      ? registerChangeCycles(item.key)
      : memoryChangeCycles(item.key, item.width);
  } catch (_error) {
    changes = [];
  }
  const target = direction === "previous"
    ? [...changes].reverse().find(cycle => cycle < session.state.playbackCycle)
    : changes.find(cycle => cycle > session.state.playbackCycle);
  if (target === undefined) {
    await showActionMessage(action, `No ${direction === "previous" ? "previous" : "next"} value change for ${label} was found in this trace.`);
    return;
  }
  navigateToPipelineCycle(target);
}

function navigateToPipelineCycle(cycle) {
  session.update({playbackCycle: cycle});
  session.update({selectedColumn: cycle});
  $("#step").textContent = session.state.playbackCycle >= session.state.pipelineData.cycles
    ? "Restart Step" : "Next Cycle";
  services.renderPipeline();
  showTab("pipeline");
  services.positionPipelineCycle(cycle);
  const eventRow = services.displayedPipelineRows().findIndex(row =>
    row.cycles?.[String(cycle)] !== undefined);
  if (eventRow >= 0) {
    requestAnimationFrame(() => {
      const instruction = $("#pipeline-grid")
        .querySelector(`.cell.inst[data-row="${eventRow}"]`);
      if (instruction) services.selectPipelineTarget(instruction);
    });
  }
}

function appendSimulationReports(trace) {
  const reports = [trace?.cacheReport, trace?.branchReport].filter(Boolean);
  if (!reports.length) return;
  session.update({lastNormalLog: session.state.lastNormalLog + `\n\n${reports.join("\n\n")}`});
  session.update({lastAdvancedLog: session.state.lastAdvancedLog + `\n\n${reports.join("\n\n")}`});
  services.updateLog();
}

function updateForwardingControl() {
  const outOfOrder = studioFeatures.multiIssueCpu
    && $("#cpu-model").value === "out-of-order";
  const integerPanel = $("#integer-unit-settings");
  const floatingPanel = $("#floating-unit-settings");
  integerPanel.hidden = false;
  floatingPanel.closest(".units-grid").classList.toggle("superscalar", outOfOrder);
  integerPanel.querySelector("legend").textContent = outOfOrder
    ? "Integer and load/store units · clock cycles" : "Integer unit · clock cycles";
  floatingPanel.querySelector("legend").textContent = outOfOrder
    ? "Floating-point units · clock cycles" : "Floating-point unit · clock cycles";
  $("#o3-memory-units-field").hidden = !outOfOrder;
  $("#forwarding").disabled = outOfOrder;
  if (outOfOrder) $("#forwarding").checked = true;
  $("#forwarding-note").textContent = outOfOrder ? "(results use CDB/ROB forwarding)" : "";
  $("#o3-management").hidden = !outOfOrder;
  $("#memory-management").hidden = !studioFeatures.memoryConfiguration;
  $("#out-of-order-execution").closest("label").hidden = outOfOrder;
  $("#out-of-order-execution").disabled = outOfOrder;
  if (outOfOrder) {
    $("#out-of-order-execution").checked = true;
    $("#speculative-execution").checked = true;
  }
}

function updateMemoryControls() {
  const mode = $("#memory-mode").value;
  const available = studioFeatures.memoryConfiguration;
  const direct = mode === "direct";
  const cache = mode === "cache";
  $("#memory-mode").disabled = !available;
  $("#direct-memory-fields").hidden = !direct;
  $("#cache-memory-fields").hidden = !cache;
  ["#instruction-memory-latency", "#data-read-latency", "#data-write-latency"]
    .forEach(selector => { $(selector).disabled = !available || !direct; });
  ["#i-cache-size", "#d-cache-size", "#cache-line", "#cache-latency", "#memory-latency"]
    .forEach(selector => { $(selector).disabled = !available || !cache; });
}

function updatePredictorControls() {
  $("#o3-predictor-parameters").hidden = $("#cpu-model").value !== "out-of-order"
    || $("#o3-branch-predictor").value === "ideal";
}

function openPredictorParameters() {
  const predictor = $("#o3-branch-predictor").value;
  if (!predictorFields[predictor]) return;
  const parameters = predictorParameterDraft[predictor]
    || o3Defaults.branchPredictorParameters?.[predictor] || {};
  $("#predictor-title").textContent = predictorNames[predictor] + " parameters";
  $("#predictor-fields").innerHTML = predictorFields[predictor].map(
    ([key, label, minimum, maximum, help]) => {
      const value = parameters[key];
      const displayed = Array.isArray(value) ? value.join(", ") : value ?? "";
      const kind = minimum === null ? "text" : "number";
      const range = minimum === null ? "" : ` min="${minimum}" max="${maximum}" step="1"`;
      return `<label class="${minimum === null ? "wide" : ""}">${escapeHtml(label)}<input name="${key}" type="${kind}" value="${escapeHtml(displayed)}"${range} required>${help ? `<small>${escapeHtml(help)}</small>` : ""}</label>`;
    }).join("");
  $("#predictor-dialog").showModal();
}

async function savePredictorParameters(event) {
  event.preventDefault();
  const predictor = $("#o3-branch-predictor").value;
  const parameters = {};
  for (const [key] of predictorFields[predictor]) {
    const input = $("#predictor-form").elements.namedItem(key);
    if (key === "tagTableTagWidths" || key === "logTagTableSizes") {
      const parts = input.value.trim().split(/[\s,]+/);
      parameters[key] = parts.map(Number);
      if (parts.length !== 8 || parameters[key].some(number => !Number.isInteger(number))) {
        await showActionMessage("Branch predictor parameters", `${key} needs eight comma-separated whole numbers.`);
        return;
      }
    } else {
      parameters[key] = Number(input.value);
      if (!Number.isInteger(parameters[key])) {
        await showActionMessage("Branch predictor parameters", `${key} must be a whole number.`);
        return;
      }
    }
  }
  const powerOfTwo = number => number > 0 && Number.isInteger(Math.log2(number));
  for (const key of ["localPredictorSize", "localHistoryTableSize", "globalPredictorSize", "choicePredictorSize", "BTBEntries"]) {
    if (key in parameters && !powerOfTwo(parameters[key])) {
      await showActionMessage("Branch predictor parameters", `${key} must be a power of two.`);
      return;
    }
  }
  if (predictor === "local" && !powerOfTwo(parameters.localPredictorSize / parameters.localCtrBits)) {
    await showActionMessage("Branch predictor parameters", "Local storage divided by counter bits must give a power-of-two number of entries.");
    return;
  }
  if (predictor === "tage" && parameters.maxHist <= parameters.minHist) {
    await showActionMessage("Branch predictor parameters", "TAGE maximum history must exceed its minimum history.");
    return;
  }
  predictorParameterDraft[predictor] = parameters;
  $("#predictor-dialog").close();
}

async function openCpuConfiguration() {
  if (!session.state.current) return;
  try {
    const config = await api("/api/config?name=" + encodeURIComponent(session.state.current.name));
    cpuConfigurationOpenedAs = studioFeatures.multiIssueCpu ? config.cpu : "in-order";
    $("#cpu-model").value = studioFeatures.multiIssueCpu ? config.cpu : "in-order";
    $("#int-alu").value = config.intAlu;
    $("#int-mul").value = config.intMul;
    $("#int-div").value = config.intDiv;
    $("#float-alu").value = config.floatAlu;
    $("#float-mul").value = config.floatMul;
    $("#float-div").value = config.floatDiv;
    $("#floating-point-precision").value = config.floatingPointPrecision || "single";
    $("#int-alu-pipelined").checked = config.intAluPipelined;
    $("#int-mul-pipelined").checked = config.intMulPipelined;
    $("#int-div-pipelined").checked = config.intDivPipelined;
    $("#float-alu-pipelined").checked = config.floatAluPipelined;
    $("#float-mul-pipelined").checked = config.floatMulPipelined;
    $("#float-div-pipelined").checked = config.floatDivPipelined;
    $("#forwarding").checked = config.forwarding;
    $("#compressed-instructions").checked = Boolean(config.compressedInstructions);
    $("#memory-mode").value = config.memoryMode === "cache" ? "cache" : "direct";
    $("#instruction-memory-latency").value = config.instructionMemoryLatency || 1;
    $("#data-read-latency").value = config.dataReadLatency || 1;
    $("#data-write-latency").value = config.dataWriteLatency || 1;
    $("#i-cache-size").value = config.iCacheSize;
    $("#d-cache-size").value = config.dCacheSize;
    $("#cache-line").value = config.cacheLine;
    $("#cache-latency").value = config.cacheLatency;
    $("#memory-latency").value = config.memoryLatency;
    $("#fetch-width").value = config.fetchWidth;
    $("#decode-width").value = config.decodeWidth;
    $("#rename-width").value = config.renameWidth;
    $("#dispatch-width").value = config.dispatchWidth;
    $("#issue-width").value = config.issueWidth;
    $("#writeback-width").value = config.writebackWidth;
    $("#commit-width").value = config.commitWidth;
    $("#int-alu-units").value = config.intAluUnits || 1;
    $("#int-mul-units").value = config.intMulUnits || 1;
    $("#int-div-units").value = config.intDivUnits || 1;
    $("#float-alu-units").value = config.floatAluUnits || 1;
    $("#float-mul-units").value = config.floatMulUnits || 1;
    $("#float-div-units").value = config.floatDivUnits || 1;
    $("#memory-units").value = config.memoryUnits || 1;
    $("#rob-entries").value = config.robEntries;
    $("#iq-entries").value = config.iqEntries;
    $("#lq-entries").value = config.lqEntries;
    $("#sq-entries").value = config.sqEntries;
    $("#o3-branch-predictor").value = config.branchPredictor || "ideal";
    predictorParameterDraft = JSON.parse(JSON.stringify(
      config.branchPredictorParameters || o3Defaults.branchPredictorParameters || {}));
    updatePredictorControls();
    $("#o3-evaluation-label").value = config.o3EvaluationLabel || "";
    $("#out-of-order-execution").checked = config.outOfOrderExecution !== false;
    $("#speculative-execution").checked = config.speculativeExecution !== false;
    const visibleStages = new Set(config.o3VisibleStages || ["issue", "execute", "memory", "cdb", "commit"]);
    document.querySelectorAll("[data-o3-stage]").forEach(input => {
      input.checked = visibleStages.has(input.dataset.o3Stage);
    });
    updateForwardingControl();
    updateMemoryControls();
    $("#cpu-dialog").showModal();
  } catch (error) {
    await showActionMessage("CPU configuration", error.message);
  }
}

const environmentInputs = {
  PROGRAMS_DIRECTORY: "#env-programs-directory",
  SUBMISSION_DIRECTORY: "#env-submission-directory",
  RISCV_TOOLCHAIN_PATH: "#env-riscv-toolchain",
  OPTIMIZATION_FLAGS: "#env-optimization-flags",
  GEM5_INSTALLATION_PATH: "#env-gem5-installation",
  PIPELINE_DISPLAY_CYCLE_LIMIT: "#env-pipeline-cycle-limit",
  SUBMISSION_NAME_PREFIX: "#env-submission-prefix",
  SUBMISSION_NAME_SUFFIX: "#env-submission-suffix"
};
const environmentCheckTokens = {};

function environmentFormValues() {
  return Object.fromEntries(Object.entries(environmentInputs)
    .map(([key, selector]) => [key, $(selector).value]));
}

function setEnvironmentValidation(key, state = "", message = "") {
  const status = document.querySelector(`[data-environment-status="${key}"]`);
  const field = document.querySelector(`[data-environment-key="${key}"]`);
  if (!status || !field) return;
  status.className = `environment-validation${state ? ` ${state}` : ""}`;
  status.title = message;
  status.setAttribute("aria-label", message || "Not checked");
  field.classList.toggle("valid", state === "valid");
  field.classList.toggle("invalid", state === "invalid");
  field.classList.toggle("warning", state === "warning");
}

async function validateEnvironmentInput(key) {
  const token = (environmentCheckTokens[key] || 0) + 1;
  environmentCheckTokens[key] = token;
  setEnvironmentValidation(key, "checking", "Checking…");
  try {
    const result = await api("/api/environment/check", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({key, values: environmentFormValues()})
    });
    if (environmentCheckTokens[key] !== token) return;
    const state = result.ok ? (result.warning ? "warning" : "valid") : "invalid";
    setEnvironmentValidation(key, state, result.message);
  } catch (error) {
    if (environmentCheckTokens[key] !== token) return;
    setEnvironmentValidation(key, "invalid", error.message);
  }
}

Object.entries(environmentInputs).forEach(([key, selector]) => {
  $(selector).addEventListener("input", () => {
    environmentCheckTokens[key] = (environmentCheckTokens[key] || 0) + 1;
    setEnvironmentValidation(key);
  });
  $(selector).addEventListener("blur", () => validateEnvironmentInput(key));
});

document.querySelectorAll("[data-install-tool]").forEach(button => {
  button.onclick = async event => {
    event.preventDefault();
    const component = button.dataset.installTool;
    const confirmed = await actionDialog({
      title: `Install ${component}`,
      message: `Open a terminal and install ${component}? This may download source code, install system packages, and request your administrator password.`,
      confirmLabel: "Open installer",
      cancelLabel: "Cancel"
    });
    if (!confirmed) return;
    try {
      const result = await api("/api/install-tool", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({component})
      });
      session.update({lastNormalLog: result.output});
      session.update({lastAdvancedLog: result.output});
      services.updateLog();
    } catch (error) {
      await showActionMessage(`Install ${component}`, error.message);
    }
  };
});

function fillEnvironmentForm(settings) {
  Object.entries(environmentInputs).forEach(([key, selector]) => {
    $(selector).value = settings.values?.[key] || "";
    environmentCheckTokens[key] = (environmentCheckTokens[key] || 0) + 1;
    setEnvironmentValidation(key);
  });
}

async function openEnvironmentSettings() {
  try {
    const settings = await api("/api/environment");
    configuredProgramsDirectory = settings.values?.PROGRAMS_DIRECTORY || "";
    fillEnvironmentForm(settings);
    $("#environment-dialog").showModal();
  } catch (error) {
    await showActionMessage("Settings", error.message);
  }
}

function clearCurrentProject() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  if (draftSaveTimer !== null) {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }
  session.update({current:null,playbackCycle:null,selectedColumn:null,selectedRow:null,selectedSourceLine:null,stepMode:false});
  scaffoldProtectionEnabled = true;
  scaffoldEditAuthorized = false;
  updateScaffoldProtectionUi();
  session.update({pipelineData: null});
  session.update({memoryWatches: []});
  session.update({savedSource: ""});
  session.update({sourceDirty: false});
  updateDirtyIndicator();
  setDraftStatus();
  services.clearDiagnostics();
  $("#project-title").textContent = "Open a project";
  $("#source-name").textContent = "Assembly Editor";
  sourceEditor.replaceDocument("", null);
  services.renderRegisters();
  services.renderMemory();
  $("#save").disabled = true;
  $("#duplicate").disabled = true;
  $("#open-with").disabled = true;
  $("#rename").disabled = true;
  $("#submit").disabled = true;
  $("#run").disabled = true;
  $("#configure").disabled = true;
  $("#delete").disabled = true;
  $("#reset").disabled = true;
  $("#export-pipeline").disabled = true;
  $("#expand-loops").disabled = true;
  $("#cycle-prev").disabled = true;
  $("#cycle-next").disabled = true;
  $("#cycle-position").textContent = "Cycle —/—";
  $("#step").disabled = true;
  services.updateCycleNavigation();
}


async function deleteCurrentProject() {
  if (!session.state.current) return;
  const name = session.state.current.name;
  const confirmation = await actionDialog({
    title: "Delete project",
    message: `Delete project "${name}"? This cannot be undone.\n\nType the project name to confirm.`,
    inputLabel: "Project name",
    confirmLabel: "Delete",
    cancelLabel: "Cancel",
    danger: true
  });
  if (confirmation !== name) return;
  try {
    await api("/api/projects", {
      method: "DELETE",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({name, confirmation})
    });
    localStorage.removeItem(services.memoryWatchStorageKey(name));
    clearLocalDraft(name);
    clearCurrentProject();
    session.update({lastNormalLog: `Deleted project ${name}. Generated results were kept.`});
    session.update({lastAdvancedLog: session.state.lastNormalLog});
    services.updateLog();
    showTab("output");
    await loadProjects();
  } catch (error) {
    await showActionMessage("Delete project", error.message);
  }
}

$("#save").onclick = () => save().catch(error => showActionMessage("Save", error.message));
$("#duplicate").onclick = duplicateCurrentProject;
$("#open-with").onclick = openWithChooser;
$("#rename").onclick = renameCurrentProject;
$("#submit").onclick = submitAssignment;
$("#run").onclick = () => run(false);
$("#reset").onclick = resetSimulation;
$("#step").onclick = runStep;
$("#configure").onclick = openCpuConfiguration;
$("#environment-settings").onclick = openEnvironmentSettings;
$("#delete").onclick = deleteCurrentProject;
$("#export-pipeline").onclick = services.exportVisiblePipeline;
$("#integer-register-format").value = localStorage.getItem("ase-studio-integer-register-format") || "hex";
$("#integer-register-format").onchange = event => {
  localStorage.setItem("ase-studio-integer-register-format", event.target.value);
  services.renderRegisters();
};
$("#float-register-format").value = localStorage.getItem("ase-studio-float-register-format") || "float";
$("#float-register-format").onchange = event => {
  localStorage.setItem("ase-studio-float-register-format", event.target.value);
  services.renderRegisters();
};
$("#memory-format").value = localStorage.getItem("ase-studio-memory-format") || "hex";
$("#memory-format").onchange = event => services.execute("memory:format", {value:event.target.value});
setEditorFontSize(localStorage.getItem("ase-studio-editor-font-size") || 14);
$("#editor-font-size").oninput = event => setEditorFontSize(event.target.value);
$("#theme-toggle").onclick = () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("ase-studio-theme", theme);
  updateThemeButton();
  services.publishMemoryWindowState();
};
updateThemeButton();
$("#about-button").onclick = () => $("#about-dialog").showModal();
$("#close-about").onclick = () => $("#about-dialog").close();
$("#about-dialog").onclick = event => {
  if (event.target === $("#about-dialog")) $("#about-dialog").close();
};
$("#new").onclick = async () => {
  if (!await resolveUnsavedProject("create a new project")) return;
  const name = await actionDialog({
    title: "New project",
    message: "Create a new assembly project.",
    inputLabel: "Project name",
    confirmLabel: "Create",
    cancelLabel: "Cancel",
    trimInput: false
  });
  if (!name) return;
  try {
    await api("/api/projects", {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({name})
    });
    await loadProjects();
    await openProject(name, {skipUnsavedCheck: true});
  } catch (error) {
    await showActionMessage("New project", error.message);
  }
};
$("#message-form").onsubmit = event => {
  event.preventDefault();
  const value = $("#message-input").value;
  closeActionDialog(messageDialogHasInput
    ? (messageDialogTrimInput ? value.trim() : value)
    : messageDialogConfirmValue);
};
$("#message-cancel").onclick = () => closeActionDialog(null);
$("#message-alternate").onclick = () => closeActionDialog(messageDialogAlternateValue);
$("#message-dialog").addEventListener("cancel", event => {
  event.preventDefault();
  closeActionDialog(null);
});

document.addEventListener("contextmenu", event => {
  const register = event.target.closest("[data-register-change]");
  if (register) {
    openChangeContextMenu(event, {
      kind: "register", key: register.dataset.registerChange,
      label: register.dataset.registerChange
    });
    return;
  }
  const memory = event.target.closest("[data-memory-address]");
  if (!memory) return;
  openChangeContextMenu(event, {
    kind: "memory", key: memory.dataset.memoryAddress,
    width: Number(memory.dataset.memoryWidth),
    label: memory.dataset.memoryLabel || memory.dataset.memoryAddress
  });
});
document.addEventListener("pointerdown", event => {
  if (changeContextMenu && !changeContextMenu.contains(event.target)) {
    closeChangeContextMenu();
  }
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeChangeContextMenu();
});
window.addEventListener("resize", closeChangeContextMenu);
$("#memory-symbol-form").onsubmit = event => {
  event.preventDefault();
  services.execute("memory:add", {name:$("#memory-symbol").value});
};
$("#memory-watch-list").onclick = event => {
  const button = event.target.closest("[data-memory-watch-remove]");
  if (!button) return;
  services.execute("memory:remove", {index:button.dataset.memoryWatchRemove});
};
$("#memory-watch-clear").onclick = services.clearMemoryWatches;
$("#memory-popout").onclick = services.openMemoryWindow;
$("#cell-width").oninput = () => session.state.pipelineData && services.renderPipeline();
$("#cell-smaller").onclick = () => services.adjustCellWidth(-6);
$("#cell-larger").onclick = () => services.adjustCellWidth(6);
$("#cycle-prev").onclick = () => movePlaybackCycle(-1);
$("#cycle-next").onclick = () => movePlaybackCycle(1);
$("#cycle-jump-form").onsubmit = event => {
  event.preventDefault();
  jumpToCycle();
};
$("#expand-loops").onchange = () => {
  session.update({selectedRow: null});
  if (session.state.pipelineData) services.renderPipeline();
};
$("#advanced-logs").onchange = services.updateLog;
$("#cpu-model").onchange = () => {
  if (cpuConfigurationOpenedAs === "in-order"
      && $("#cpu-model").value === "out-of-order") {
    const defaultInputs = {
      intAlu: "int-alu", intMul: "int-mul", intDiv: "int-div",
      floatAlu: "float-alu", floatMul: "float-mul", floatDiv: "float-div",
      fetchWidth: "fetch-width", decodeWidth: "decode-width",
      renameWidth: "rename-width", dispatchWidth: "dispatch-width",
      issueWidth: "issue-width",
      writebackWidth: "writeback-width", commitWidth: "commit-width",
      intAluUnits: "int-alu-units", intMulUnits: "int-mul-units",
      intDivUnits: "int-div-units", floatAluUnits: "float-alu-units",
      floatMulUnits: "float-mul-units", floatDivUnits: "float-div-units",
      memoryUnits: "memory-units"
    };
    for (const [key, id] of Object.entries(defaultInputs)) {
      if (o3Defaults[key] !== undefined) $("#" + id).value = o3Defaults[key];
    }
    for (const unit of ["int-alu", "int-mul", "int-div", "float-alu", "float-mul", "float-div"]) {
      const key = unit.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()) + "Pipelined";
      if (o3Defaults[key] !== undefined) $("#" + unit + "-pipelined").checked = o3Defaults[key];
    }
    const defaultStages = new Set(["issue", "execute", "memory", "cdb", "commit"]);
    $("#o3-branch-predictor").value = o3Defaults.branchPredictor || "ideal";
    document.querySelectorAll("[data-o3-stage]").forEach(input => {
      input.checked = defaultStages.has(input.dataset.o3Stage);
    });
    cpuConfigurationOpenedAs = "out-of-order";
  }
  updateForwardingControl();
  updateMemoryControls();
  updatePredictorControls();
};
$("#o3-branch-predictor").onchange = updatePredictorControls;
$("#o3-predictor-parameters").onclick = openPredictorParameters;
$("#cancel-predictor").onclick = () => $("#predictor-dialog").close();
$("#predictor-form").onsubmit = savePredictorParameters;
$("#memory-mode").onchange = updateMemoryControls;
$("#cancel-submission").onclick = () => $("#submission-dialog").close();
$("#submission-dialog").addEventListener("cancel", event => {
  if ($("#submission-confirm").disabled) event.preventDefault();
});
$("#submission-files").onchange = renderSubmissionFiles;
$("#submission-select-all").onclick = () => {
  document.querySelectorAll("[data-submission-project]").forEach(input => { input.checked = true; });
};
$("#submission-select-none").onclick = () => {
  document.querySelectorAll("[data-submission-project]").forEach(input => { input.checked = false; });
};
$("#submission-form").onsubmit = event => {
  event.preventDefault();
  prepareSubmission();
};
$("#cancel-config").onclick = () => $("#cpu-dialog").close();
$("#cancel-environment").onclick = () => $("#environment-dialog").close();
$("#import-environment").onclick = () => $("#environment-import-file").click();
$("#environment-import-file").onchange = async event => {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const result = await api("/api/environment/import", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({filename: file.name, content: await file.text()})
    });
    fillEnvironmentForm(result);
    session.update({lastNormalLog: `Imported settings from ${file.name}. Review them, then select Save settings.`});
    session.update({lastAdvancedLog: session.state.lastNormalLog});
    services.updateLog();
  } catch (error) {
    await showActionMessage("Import settings", error.message);
  } finally {
    input.value = "";
  }
};
$("#cpu-form").onsubmit = async event => {
  event.preventDefault();
  if (!session.state.current) return;
  const config = {
    cpu: $("#cpu-model").value,
    intAlu: Number($("#int-alu").value),
    intMul: Number($("#int-mul").value),
    intDiv: Number($("#int-div").value),
    floatAlu: Number($("#float-alu").value),
    floatMul: Number($("#float-mul").value),
    floatDiv: Number($("#float-div").value),
    floatingPointPrecision: $("#floating-point-precision").value,
    intAluPipelined: $("#int-alu-pipelined").checked,
    intMulPipelined: $("#int-mul-pipelined").checked,
    intDivPipelined: $("#int-div-pipelined").checked,
    floatAluPipelined: $("#float-alu-pipelined").checked,
    floatMulPipelined: $("#float-mul-pipelined").checked,
    floatDivPipelined: $("#float-div-pipelined").checked,
    forwarding: $("#forwarding").checked,
    compressedInstructions: $("#compressed-instructions").checked,
    memoryMode: $("#memory-mode").value,
    cacheStalls: $("#memory-mode").value === "cache",
    instructionMemoryLatency: Number($("#instruction-memory-latency").value),
    dataReadLatency: Number($("#data-read-latency").value),
    dataWriteLatency: Number($("#data-write-latency").value),
    iCacheSize: $("#i-cache-size").value,
    dCacheSize: $("#d-cache-size").value,
    cacheLine: Number($("#cache-line").value),
    cacheLatency: Number($("#cache-latency").value),
    memoryLatency: Number($("#memory-latency").value),
    fetchWidth: Number($("#fetch-width").value),
    decodeWidth: Number($("#decode-width").value),
    renameWidth: Number($("#rename-width").value),
    dispatchWidth: Number($("#dispatch-width").value),
    issueWidth: Number($("#issue-width").value),
    writebackWidth: Number($("#writeback-width").value),
    commitWidth: Number($("#commit-width").value),
    intAluUnits: Number($("#int-alu-units").value),
    intMulUnits: Number($("#int-mul-units").value),
    intDivUnits: Number($("#int-div-units").value),
    floatAluUnits: Number($("#float-alu-units").value),
    floatMulUnits: Number($("#float-mul-units").value),
    floatDivUnits: Number($("#float-div-units").value),
    memoryUnits: Number($("#memory-units").value),
    robEntries: Number($("#rob-entries").value),
    iqEntries: Number($("#iq-entries").value),
    lqEntries: Number($("#lq-entries").value),
    sqEntries: Number($("#sq-entries").value),
    branchPredictor: $("#cpu-model").value === "out-of-order"
      ? $("#o3-branch-predictor").value : "local",
    branchPredictorParameters: predictorParameterDraft,
    speculativeExecution: $("#speculative-execution").checked,
    outOfOrderExecution: $("#out-of-order-execution").checked,
    o3EvaluationLabel: $("#o3-evaluation-label").value.trim(),
    o3VisibleStages: [...document.querySelectorAll("[data-o3-stage]:checked")]
      .map(input => input.dataset.o3Stage)
  };
  try {
    await api("/api/config", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({name: session.state.current.name, config})
    });
    const updatedProject = await api("/api/project?name=" + encodeURIComponent(session.state.current.name));
    session.update({current:{...session.state.current, isa: updatedProject.isa || session.state.current.isa}});
    $("#cpu-dialog").close();
    session.update({lastNormalLog: "CPU configuration saved. It will be used on the next Run."});
    session.update({lastAdvancedLog: session.state.lastNormalLog});
    services.updateLog();
    showTab("output");
  } catch (error) {
    await showActionMessage("CPU configuration", error.message);
  }
};
$("#environment-form").onsubmit = async event => {
  event.preventDefault();
  const values = environmentFormValues();
  const cycleLimitText = values.PIPELINE_DISPLAY_CYCLE_LIMIT.trim();
  const cycleLimit = Number(cycleLimitText);
  if (!/^[0-9]+$/.test(cycleLimitText)
      || !Number.isInteger(cycleLimit) || cycleLimit < 100 || cycleLimit > 20000) {
    const message = "Maximum visible pipeline cycles must be a whole number from 100 to 20,000. Higher values can use excessive browser memory; larger traces are saved automatically as a complete CSV instead.";
    setEnvironmentValidation("PIPELINE_DISPLAY_CYCLE_LIMIT", "invalid", message);
    await showActionMessage("Maximum pipeline cycles", message);
    $("#env-pipeline-cycle-limit").focus();
    return;
  }
  const programsDirectoryChanged = values.PROGRAMS_DIRECTORY.trim()
    !== configuredProgramsDirectory.trim();
  if (programsDirectoryChanged
      && !await resolveUnsavedProject("change the programs folder")) return;
  try {
    const settings = await api("/api/environment", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({values})
    });
    configuredProgramsDirectory = settings.values?.PROGRAMS_DIRECTORY || "";
    fillEnvironmentForm(settings);
    $("#environment-dialog").close();
    if (programsDirectoryChanged) {
      clearCurrentProject();
      await loadProjects();
    }
    session.update({lastNormalLog: programsDirectoryChanged
      ? `Settings saved. Projects are now loaded from ${configuredProgramsDirectory}.`
      : "Settings saved. They will be used by the next build and simulation."});
    session.update({lastAdvancedLog: session.state.lastNormalLog});
    services.updateLog();
    showTab("output");
  } catch (error) {
    await showActionMessage("Settings", error.message);
  }
};
$("#find-source").onclick = () => {shell.open("editor");sourceEditor.find();};

async function checkForUpdate() {
  try {
    const status = await api("/api/update-status");
    $("#update").hidden = !status.available;
    $("#update").disabled = !status.available;
    $("#update").title = status.message;
  } catch (_error) {
    $("#update").hidden = true;
  }
}

$("#update").onclick = async () => {
  $("#update").disabled = true;
  try {
    const status = await api("/api/update-status");
    if (!status.canUpdate) {
      await showActionMessage("Update unavailable", status.message
        + "\nCommit or stash local changes, and reconcile divergent branches with Git.");
      await checkForUpdate();
      return;
    }
    session.update({lastNormalLog: "Updating from the configured origin remotes…"});
    session.update({lastAdvancedLog: session.state.lastNormalLog});
    services.updateLog();
    showTab("output");
    const result = await api("/api/update", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({})
    });
    session.update({lastNormalLog: result.output});
    session.update({lastAdvancedLog: result.advancedOutput || result.output});
    services.updateLog();
    if (result.restartRequired) {
      // Files on disk now belong to the new release, but this page and Python
      // process still execute the old release. Do not update again until the
      // application has restarted.
      $("#update").hidden = true;
      $("#update").disabled = true;
      $("#update").title = "Restart ASE Studio to finish the update.";
      await showActionMessage("Update completed",
        "Restart ASE Studio now to load the updated simulator and interface.");
      return;
    }
    if (!result.ok) {
      await showActionMessage("Update failed",
        result.output || "ASE Studio could not complete the repository update.");
    }
  } catch (error) {
    session.update({lastNormalLog: `Repository update failed\n${error.message}`});
    session.update({lastAdvancedLog: session.state.lastNormalLog});
    services.updateLog();
    await showActionMessage("Update failed", error.message);
  }
  await checkForUpdate();
};

window.aseHasUnsavedChanges = () => session.state.sourceDirty;
window.addEventListener("beforeunload", writeLocalDraft);

window.addEventListener("focus", synchronizeExternalSource);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) synchronizeExternalSource();
});
setInterval(synchronizeExternalSource, 1000);

loadStudioVersion();
loadProjects().then(async () => {
  if (!await initializeReleaseUpdates()) await checkForUpdate();
});


// Modified in the personal fork on 2026-10-30: manage signed application updates without interrupting editing.
let releaseUpdateToken;
let releaseUpdatePolling;
async function releaseUpdateAction(action, values = {}) {
  return api('/api/release-update', {method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-ASE-Update-Token': releaseUpdateToken},
    body: JSON.stringify({action, ...values})});
}
function renderReleaseUpdate(state) {
  const appimage = state.channel === 'appimage';
  $('#release-update-mode').closest('label').hidden = appimage;
  $('#release-update-check').hidden = appimage;
  if (appimage) {
    $('#release-update-status').textContent = state.message;
    for (const id of ['download', 'restart', 'progress', 'notes']) $('#release-update-' + id).hidden = true;
    return;
  }
  $('#release-update-mode').value = state.mode;
  $('#release-update-mode').disabled = state.busy;
  const labels = {checking: 'Checking for updates…', downloading: 'Downloading update…',
    verifying: 'Checking the downloaded application…', available: 'An update is available.',
    ready: 'Ready to update at the next launch.', current: 'Studio is up to date.'};
  $('#release-update-status').textContent = [state.version, state.message || labels[state.phase] || ''].filter(Boolean).join(' — ');
  $('#release-updates').textContent = state.phase === 'ready' ? 'Update ready' : state.phase === 'available' ? 'Update available' : 'Updates';
  $('#release-update-check').disabled = state.busy;
  $('#release-update-download').hidden = state.phase !== 'available';
  $('#release-update-restart').hidden = state.phase !== 'ready';
  const progress = $('#release-update-progress');
  progress.hidden = state.phase !== 'downloading';
  if (state.total) { progress.max = state.total; progress.value = state.received || 0; }
  else progress.removeAttribute('value');
  const notes = $('#release-update-notes');
  notes.hidden = !state.url;
  if (state.url) notes.href = state.url;
}
async function refreshReleaseUpdates() {
  const state = await api('/api/release-update');
  if (state.managed || state.channel === 'appimage') { releaseUpdateToken = state.token; renderReleaseUpdate(state); }
  return state;
}
async function initializeReleaseUpdates() {
  try {
    const state = await refreshReleaseUpdates();
    if (!state.managed && state.channel !== 'appimage') return false;
    $('#release-updates').hidden = false;
    $('#update').hidden = true;
    $('#release-updates').onclick = () => $('#release-update-dialog').showModal();
    $('#release-update-close').onclick = () => $('#release-update-dialog').close();
    if (state.channel === 'appimage') return true;
    const perform = async (action, values) => {
      try { renderReleaseUpdate(await releaseUpdateAction(action, values)); }
      catch (error) { $('#release-update-status').textContent = error.message; }
    };
    $('#release-update-mode').onchange = event => perform('mode', {mode: event.target.value});
    $('#release-update-check').onclick = () => perform('check');
    $('#release-update-download').onclick = () => perform('download');
    $('#release-update-restart').onclick = async () => {
      try {
        await save();
        if (session.state.sourceDirty) throw Error('Save the remaining changes before restarting.');
        await releaseUpdateAction('restart');
        clearInterval(releaseUpdatePolling);
        $('#release-update-status').textContent = 'Restarting Studio…';
        $('#release-update-restart').disabled = true;
      } catch (error) { $('#release-update-status').textContent = error.message; }
    };
    await releaseUpdateAction('ready');
    releaseUpdatePolling = setInterval(() => refreshReleaseUpdates().catch(() => {}), 5000);
    return true;
  } catch (_) { return false; }
}


bindApplicationCommands({commands,session,shell,services,sourceEditor});
session.changed.connect((_sender, keys) => {
 if (keys.some(k=>['current','pipelineData','playbackCycle','stepMode','memoryWatches'].includes(k))) {
   services.renderRegisters(); services.renderMemory();
 }
 if (keys.some(k=>['pipelineData','playbackCycle','stepMode'].includes(k))) services.renderPipeline();
 if (keys.some(k=>['lastNormalLog','lastAdvancedLog'].includes(k))) services.updateLog();
 $("#step").textContent = session.state.stepMode ? (session.state.playbackCycle >= (session.state.pipelineData?.cycles || 0) ? "Restart Step" : "Next Cycle") : "Run Step";
 commands.notifyCommandChanged();
});
shell.shown.connect((_sender,id)=>{
 if(id==='editor') {sourceEditor.layout();}
 if(id==='pipeline') services.renderPipeline();
 if(id==='memory') services.renderMemory();
 if(id==='registers') services.renderRegisters();
});
shell.activated.connect((_sender,id)=>{if(id==='editor')sourceEditor.focus();});
shell.resized.connect((_sender,id)=>{if(id==='editor')sourceEditor.layout();});
return {services,sourceEditor};
}
