// SPDX-FileCopyrightText: 2026 Behnam Farnaghinejad <behnam.farnaghinejad@polito.it>
// SPDX-License-Identifier: GPL-2.0-only
// Modified in the personal fork on 2026-11-02: extract Studio rendering/operations for Lumino.
// Earlier fork changes (2026-10-27–2026-10-31): Monaco, autosave, playback and managed updates.

/** View contract: session state, owned root and application callbacks; no sibling DOM queries. */
export function createMemoryView({session, services, shell, root}) {
const $ = selector => root.matches(selector) ? root : root.querySelector(selector);
let memoryPopoutWindow = null;

const memoryWindowChannel = "BroadcastChannel" in window
  ? new BroadcastChannel("ase-studio-memory-window") : null;

if (memoryWindowChannel) {
  memoryWindowChannel.onmessage = event => {
    const message = event.data;
    if (message?.type === "memory-request-state") {
      publishMemoryWindowState();
      return;
    }
    if (message?.type !== "memory-action") return;
    if (message.action === "add") services.execute("memory:add", {name:message.name});
    else if (message.action === "remove") services.execute("memory:remove", {index:message.index});
    else if (message.action === "clear") services.execute("memory:clear");
    else if (message.action === "format") services.execute("memory:format", {value:message.value});
    else if (message.action === "navigate-change") {
      services.execute("trace:change", {item:{
        kind: "memory", key: message.address,
        width: Number(message.width), label: message.label
      }, direction:message.direction});
    }
  };
}

function memoryWatchStorageKey(projectName = session.state.current?.name) {
  return projectName ? `ase-studio-memory-watches:${projectName}` : null;
}

function canonicalMemoryAddress(value) {
  const text = String(value).trim();
  if (!/^(?:0[xX][0-9a-fA-F]+|[0-9]+)$/.test(text)) {
    throw Error("Enter a hexadecimal address such as 0x11120 or a decimal address.");
  }
  return `0x${BigInt(text).toString(16)}`;
}

function loadMemoryWatches() {
  session.update({memoryWatches: []});
  const key = memoryWatchStorageKey();
  if (!key) return;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(saved)) return;
    saved.forEach(entry => {
      if (entry?.type === "symbol" && typeof entry.name === "string" && entry.name) {
        session.state.memoryWatches.push({type: "symbol", name: entry.name});
      }
    });
    // Rewrite once to discard obsolete address-based watches from older releases.
    localStorage.setItem(key, JSON.stringify(session.state.memoryWatches));
  } catch (_error) {
    session.update({memoryWatches: []});
  }
}

function saveMemoryWatches() {
  const key = memoryWatchStorageKey();
  if (key) localStorage.setItem(key, JSON.stringify(session.state.memoryWatches));
}

const MEMORY_ELEMENT_NAMES = {1: "byte", 2: "halfword", 4: "word", 8: "doubleword"};

const MEMORY_ROWS_PER_SYMBOL = 256;

function availableMemorySymbols() {
  const source = session.state.pipelineData?.dataSymbols?.length
    ? session.state.pipelineData.dataSymbols : (session.state.current?.dataSymbols || []);
  return source.map(symbol => {
    const size = Math.max(1, Number(symbol.size) || 4);
    let elementSize = Number(symbol.elementSize);
    if (!MEMORY_ELEMENT_NAMES[elementSize]) elementSize = size % 4 === 0 ? 4 : 1;
    if (size % elementSize) elementSize = 1;
    return {
      ...symbol,
      address: canonicalMemoryAddress(symbol.address),
      size,
      elementSize,
      elementCount: size / elementSize
    };
  }).sort((left, right) => BigInt(left.address) < BigInt(right.address)
    ? -1 : BigInt(left.address) > BigInt(right.address) ? 1 : 0);
}

function describeMemorySymbol(symbol) {
  const unit = MEMORY_ELEMENT_NAMES[symbol.elementSize];
  return `${symbol.elementCount} ${unit}${symbol.elementCount === 1 ? "" : "s"}`;
}

function memoryDisplayLayout(symbol, format) {
  let elementSize = symbol.elementSize;
  if (format === "float" && symbol.untypedStorage) {
    const floatingBytes = session.state.pipelineData?.configuration?.floatingPointPrecision === "double" ? 8 : 4;
    if (symbol.size % floatingBytes === 0) elementSize = floatingBytes;
  }
  return {elementSize, elementCount: symbol.size / elementSize};
}

function memorySymbolHue(symbol, symbols) {
  const index = Math.max(0, symbols.indexOf(symbol));
  return Math.round((index * 137.508) % 360);
}

function renderMemoryWatchControls(symbols) {
  const select = $("#memory-symbol");
  const previous = select.value;
  select.innerHTML = symbols.length
    ? symbols.map(symbol => `<option value="${services.escapeHtml(symbol.name)}">${services.escapeHtml(symbol.name)} · ${describeMemorySymbol(symbol)} · ${symbol.address}</option>`).join("")
    : '<option value="">No symbols available</option>';
  select.disabled = !symbols.length;
  $("#memory-symbol-form button").disabled = !symbols.length;
  if (symbols.some(symbol => symbol.name === previous)) select.value = previous;

  $("#memory-watch-list").innerHTML = session.state.memoryWatches.map((watch, index) => {
    const symbol = symbols.find(candidate => candidate.name === watch.name);
    const label = `${watch.name}${symbol ? ` · ${describeMemorySymbol(symbol)}` : " · unavailable"}`;
    const color = symbol ? " memory-symbol-color" : "";
    const style = symbol ? ` style="--memory-symbol-hue:${memorySymbolHue(symbol, symbols)}deg"` : "";
    return `<span class="memory-watch${color}"${style}>${services.escapeHtml(label)}<button type="button" data-memory-watch-remove="${index}" aria-label="Remove ${services.escapeHtml(label)} from the watch list">×</button></span>`;
  }).join("");
  $("#memory-watch-clear").disabled = session.state.memoryWatches.length === 0;
}

function renderMemoryMap() {
  const container = $("#memory-map-sections");
  const sections = session.state.pipelineData?.memoryMap?.length
    ? session.state.pipelineData.memoryMap : (session.state.current?.memoryMap || []);
  if (!sections.length) {
    container.innerHTML = '<div class="memory-map-empty">Build the project to see its allocated ELF sections.</div>';
    return;
  }
  const ordered = [...sections].sort((left, right) =>
    BigInt(left.start) < BigInt(right.start) ? 1 : -1);
  container.innerHTML = ordered.map(section => {
    const type = String(section.kind || "allocated").replaceAll(" ", "-");
    const parts = [...(section.parts || [])].reverse().map(part =>
      `<div class="memory-map-part"><strong>${services.escapeHtml(part.name)}</strong><span>${Number(part.size).toLocaleString()} bytes</span><code>${services.escapeHtml(part.start)}–${services.escapeHtml(part.end)}</code></div>`
    ).join("");
    return `<div class="memory-map-section memory-map-${services.escapeHtml(type)}" title="${services.escapeHtml(`${section.name}: ${section.start}–${section.end}`)}"><div class="memory-map-address"><span>End</span><code>${services.escapeHtml(section.end)}</code></div><strong>${services.escapeHtml(section.name)}</strong><span>${services.escapeHtml(section.kind)} · ${Number(section.size).toLocaleString()} bytes</span>${parts}<div class="memory-map-address"><span>Begin</span><code>${services.escapeHtml(section.start)}</code></div></div>`;
  }).join("");
}

function publishMemoryWindowState() {
  if (!memoryWindowChannel) return;
  const symbol = $("#memory-symbol");
  memoryWindowChannel.postMessage({
    type: "memory-state",
    project: session.state.current?.name || "",
    theme: document.documentElement.dataset.theme,
    symbolOptionsHtml: symbol.innerHTML,
    symbolValue: symbol.value,
    symbolDisabled: symbol.disabled,
    addDisabled: $("#memory-symbol-form button").disabled,
    clearDisabled: $("#memory-watch-clear").disabled,
    format: $("#memory-format").value,
    watchesHtml: $("#memory-watch-list").innerHTML,
    summary: $("#memory-summary").textContent,
    tableHtml: $("#memory-table").innerHTML,
    mapHtml: $("#memory-map-sections").innerHTML
  });
}

function addMemoryWatch(name) {
  if (!session.state.current || !name) return;
  if (!availableMemorySymbols().some(symbol => symbol.name === name)) return;
  if (!session.state.memoryWatches.some(watch => watch.type === "symbol" && watch.name === name)) {
    session.update({memoryWatches: [...session.state.memoryWatches, {type:"symbol", name}]});
    saveMemoryWatches();
  }
  renderMemory();
}

function removeMemoryWatch(index) {
  const selected = Number(index);
  if (!Number.isInteger(selected) || selected < 0 || selected >= session.state.memoryWatches.length) return;
  session.update({memoryWatches: session.state.memoryWatches.filter((_, index) => index !== selected)});
  saveMemoryWatches();
  renderMemory();
}

function clearMemoryWatches() {
  session.update({memoryWatches: []});
  saveMemoryWatches();
  renderMemory();
}

function setMemoryFormat(value) {
  const formats = new Set(["hex", "binary", "signed", "unsigned", "float"]);
  if (!formats.has(value)) return;
  $("#memory-format").value = value;
  localStorage.setItem("ase-studio-memory-format", value);
  renderMemory();
}

async function openMemoryWindow() {
  memoryPopoutWindow = window.open(
    "memory-window.html", "ase-studio-memory", "popup,width=1050,height=720");
  if (!memoryPopoutWindow) {
    await services.showActionMessage("Open memory window", "The separate memory window was blocked.");
    return;
  }
  memoryPopoutWindow.focus();
}

let lastRender = [];
function renderMemory() {
  const signature = [session.state.pipelineData, session.state.playbackCycle,
    session.state.current, session.state.memoryWatches, $("#memory-format").value];
  if (signature.every((value, index) => value === lastRender[index])) return;
  lastRender = signature;

  const table = $("#memory-table");
  const symbols = availableMemorySymbols();
  renderMemoryMap();
  renderMemoryWatchControls(symbols);
  if (!session.state.pipelineData || session.state.playbackCycle === null) {
    $("#memory-summary").textContent = session.state.memoryWatches.length
      ? "Run a trace to inspect the watched memory locations."
      : "Add a variable or vector to the watch list.";
    table.innerHTML = '<div class="memory-empty">Memory values appear here after a successful run.</div>';
    publishMemoryWindowState();
    return;
  }

  // Replay memory one byte at a time so byte and halfword stores change only
  // the bytes they write; each watched element is then rebuilt from bytes.
  const initialRanges = Object.entries(session.state.pipelineData.initialMemory || session.state.current?.initialMemory || {})
    .filter(([, hex]) => typeof hex === "string")
    .map(([address, hex]) => ({start: Number(BigInt(address)), hex}));
  const accessed = new Map();
  const deltas = session.state.pipelineData.memoryDeltas || {};
  for (let cycle = 1; cycle <= session.state.playbackCycle; cycle++) {
    const update = deltas[String(cycle)];
    if (!update) continue;
    Object.entries(update).forEach(([address, event]) => {
      const start = Number(BigInt(address));
      const width = Math.max(1, Math.floor((Number(event.bits) || 32) / 8));
      let bits = null;
      try {
        bits = BigInt(event.value);
      } catch (_error) {
        bits = null;
      }
      for (let offset = 0; offset < width; offset++) {
        const previous = accessed.get(start + offset);
        accessed.set(start + offset, {
          value: bits === null ? (previous?.value ?? null) : Number((bits >> BigInt(8 * offset)) & 0xffn),
          access: event.access,
          cycle
        });
      }
    });
  }
  const byteAt = address => {
    const value = accessed.get(address)?.value;
    if (value !== null && value !== undefined) return value;
    const range = initialRanges.find(candidate =>
      address >= candidate.start && address < candidate.start + candidate.hex.length / 2);
    if (!range) return null;
    const offset = (address - range.start) * 2;
    return Number.parseInt(range.hex.slice(offset, offset + 2), 16);
  };

  if (!session.state.memoryWatches.length) {
    $("#memory-summary").textContent = `Memory watch through cycle ${session.state.playbackCycle}`;
    table.innerHTML = '<div class="memory-empty">The watch list is empty. Add a variable or vector above.</div>';
    publishMemoryWindowState();
    return;
  }

  const format = $("#memory-format").value;
  const rows = [];
  let truncated = false;
  session.state.memoryWatches.forEach(watch => {
    const symbol = symbols.find(candidate => candidate.name === watch.name);
    if (!symbol) return;
    const start = Number(BigInt(symbol.address));
    const layout = memoryDisplayLayout(symbol, format);
    const shown = Math.min(layout.elementCount, MEMORY_ROWS_PER_SYMBOL);
    truncated ||= shown < layout.elementCount;
    for (let index = 0; index < shown; index++) {
      const address = start + index * layout.elementSize;
      let value = 0n;
      let known = true;
      let latest = null;
      // RISC-V is little-endian: the highest address holds the most significant byte.
      for (let offset = layout.elementSize - 1; offset >= 0; offset--) {
        const byte = byteAt(address + offset);
        if (byte === null) known = false;
        else value = (value << 8n) | BigInt(byte);
        const event = accessed.get(address + offset);
        if (event && (!latest || event.cycle > latest.cycle)) latest = event;
      }
      const width = layout.elementSize * 8;
      // Floating-point views only exist for single and double precision.
      const elementFormat = format === "float" && width < 32 ? "hex" : format;
      rows.push({
        address,
        width: layout.elementSize,
        symbol,
        label: layout.elementCount > 1 ? `${symbol.name}[${index}]` : symbol.name,
        access: latest ? latest.access : known ? "initial value" : "not accessed",
        value: known ? services.formatWordValue(value, elementFormat, width) : "—",
        changed: latest?.cycle === session.state.playbackCycle
      });
    }
  });
  rows.sort((left, right) => left.address - right.address);
  const limitNote = truncated ? ` · first ${MEMORY_ROWS_PER_SYMBOL} elements per vector` : "";
  $("#memory-summary").textContent = `Memory watch through cycle ${session.state.playbackCycle} · ${rows.length} location${rows.length === 1 ? "" : "s"}${limitNote}`;
  table.innerHTML = rows.length ? rows.map(row => {
    const style = ` style="--memory-symbol-hue:${memorySymbolHue(row.symbol, symbols)}deg"`;
    return `<div class="memory-value memory-symbol-color${row.changed ? " changed" : ""}" data-memory-address="0x${row.address.toString(16)}" data-memory-width="${row.width}" data-memory-label="${services.escapeHtml(row.label)}"${style}><strong class="memory-symbol-name">${services.escapeHtml(row.label)}</strong><span class="memory-address">0x${row.address.toString(16)}</span><span>${row.access}</span><code>${row.value}</code></div>`;
  }).join("") : '<div class="memory-empty">No matching memory locations were found in this build.</div>';
  publishMemoryWindowState();
}
return {memoryWatchStorageKey, canonicalMemoryAddress, loadMemoryWatches, saveMemoryWatches, availableMemorySymbols, describeMemorySymbol, memoryDisplayLayout, memorySymbolHue, renderMemoryWatchControls, renderMemoryMap, publishMemoryWindowState, addMemoryWatch, removeMemoryWatch, clearMemoryWatches, setMemoryFormat, openMemoryWindow, renderMemory};
}
