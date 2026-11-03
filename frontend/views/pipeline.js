// SPDX-FileCopyrightText: 2026 Behnam Farnaghinejad <behnam.farnaghinejad@polito.it>
// SPDX-License-Identifier: GPL-2.0-only
// Modified in the personal fork on 2026-11-02: extract Studio rendering/operations for Lumino.
// Earlier fork changes (2026-10-27–2026-10-31): Monaco, autosave, playback and managed updates.

/** View contract: session state, owned root and application callbacks; no sibling DOM queries. */
export function createPipelineView({session, services, shell, root}) {
const $ = selector => root.matches(selector) ? root : root.querySelector(selector);
let pipelineSelectTarget = null;

let pipelinePaintFrame = null;

let pipelineResizeObserver = null;

function resetPipelineViewport() {
  const scroll = $("#pipeline-scroll");
  const reset = () => {
    scroll.scrollTop = 0;
    scroll.scrollLeft = 0;
  };
  reset();
  requestAnimationFrame(reset);
}

function positionPipelineCycle(cycle) {
  const scroll = $("#pipeline-scroll");
  const grid = $("#pipeline-grid");
  if (!session.state.pipelineData) return;
  const frozenWidth = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--address-width"))
    + Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--instruction-width"))
    + Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--flow-width"));
  const cellWidth = Number($("#cell-width").value);
  const displayCycles = pipelineDisplayCycles();
  const cycleIndex = displayCycles.findIndex(value => value >= cycle);
  // The three frozen columns occupy positions 1–3. Leave one preceding
  // cycle visible so the requested cycle appears at table column 5.
  const pipelineWidth = frozenWidth + displayCycles.length * cellWidth;
  const horizontalTail = Math.max(
    0, scroll.clientWidth - frozenWidth - 2 * cellWidth);
  grid.style.width = `${pipelineWidth + horizontalTail}px`;
  scroll.scrollLeft = Math.max(
    0, (cycleIndex - 1) * cellWidth);

  const eventRow = displayedPipelineRows().findIndex(row =>
    row.cycles?.[String(cycle)] !== undefined);
  if (eventRow < 0) return;
  const rowHeight = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--row-height"));
  // The sticky header is row 1. Preserve one preceding instruction when
  // possible so the first event for this cycle appears at table row 3.
  const rows = grid.querySelector(".pipeline-rows");
  const verticalTail = Math.max(0, scroll.clientHeight - 3 * rowHeight);
  rows.style.height = `${displayedPipelineRows().length * rowHeight + verticalTail}px`;
  scroll.scrollTop = Math.max(0, (eventRow - 1) * rowHeight);
}

function updateCycleNavigation() {
  const hasTrace = Boolean(session.state.pipelineData && session.state.playbackCycle !== null);
  $("#cycle-position").textContent = hasTrace
    ? `Cycle ${session.state.playbackCycle}/${session.state.pipelineData.cycles}` : "Cycle —/—";
  $("#cycle-prev").disabled = !hasTrace || !session.state.stepMode || session.state.playbackCycle <= 1;
  $("#cycle-next").disabled = !hasTrace || !session.state.stepMode || session.state.playbackCycle >= session.state.pipelineData.cycles;
  const canJump = hasTrace && session.state.stepMode;
  const jumpInput = $("#cycle-jump");
  jumpInput.disabled = !canJump;
  $("#cycle-jump-form button").disabled = !canJump;
  if (hasTrace) {
    jumpInput.max = session.state.pipelineData.cycles;
    jumpInput.placeholder = `1–${session.state.pipelineData.cycles}`;
  } else {
    jumpInput.removeAttribute("max");
    jumpInput.placeholder = "Cycle";
    jumpInput.value = "";
  }
}

function renderPipelineDiagram() {
  if (!session.state.pipelineData) return;
  const config = session.state.pipelineData.configuration || {};
  const o3 = config.cpu === "out-of-order";
  const visibleO3Stages = new Set(config.o3VisibleStages || ["issue", "execute", "memory", "cdb", "commit"]);
  const o3Stages = [
    ["fetch", `Fetch × ${config.fetchWidth || 2}`, "F"],
    ["decode", `Decode × ${config.decodeWidth || 2}`, "D"],
    ["rename", `Rename × ${config.renameWidth || 2}`, "R"],
    ["issue", `Issue × ${config.dispatchWidth || 2}`, "I"],
    ["execute", "EXE", "E"], ["memory", "MEM", "M"],
    ["cdb", `CDB × ${config.writebackWidth || 1}`, "C"],
    ["commit", `Commit × ${config.commitWidth || 2}`, "W"]
  ];
  const stages = o3
    ? o3Stages.filter(([key]) => visibleO3Stages.has(key)).map(([_key, label, code]) => [label, code])
    : [["Fetch", "F"], ["Decode", "D"], ["Execute", "E"], ["Memory", "M"], ["Writeback", "W"]];
  const blocks = stages.map(([stage, code], index) => `${index ? '<div class="diagram-arrow">↓</div>' : ""}<div class="diagram-stage stage-${code}">${stage}</div>`).join("");
  const memoryMode = config.memoryMode === "cache" ? "cache" : "direct";
  const memoryDetails = memoryMode === "cache"
    ? `L1 I ${config.iCacheSize} · D ${config.dCacheSize}<br>Hit ${config.cacheLatency} cycles · RAM ${config.memoryLatency} cycles`
    : `Direct memory · I ${config.instructionMemoryLatency} · Read ${config.dataReadLatency} · Write ${config.dataWriteLatency} cycles`;
  const predictorName = {
    ideal: "Ideal (teaching baseline)",
    local: "Local counter (2-bit baseline)",
    tournament: "Tournament (local + global)",
    bimode: "Bi-mode", tage: "TAGE (tagged hybrid)"
  }[config.branchPredictor] || "Ideal (teaching baseline)";
  const details = (o3
    ? `Out-of-order execution · speculation on<br>Predictor: ${predictorName}<br>Fetch ${config.fetchWidth} · Decode ${config.decodeWidth} · Rename ${config.renameWidth}<br>Issue ${config.dispatchWidth} · branches/jumps issue alone<br>CDB ${config.writebackWidth} · Commit ${config.commitWidth}<br>EXE: Int ALU ${config.intAluUnits || 1} · Mul ${config.intMulUnits || 1} · Div ${config.intDivUnits || 1}<br>FP ALU ${config.floatAluUnits || 1} · Mul ${config.floatMulUnits || 1} · Div ${config.floatDivUnits || 1}<br>Shared load/store units: ${config.memoryUnits || 1}<br>ROB · RS/IQ · LQ · SQ: unlimited`
    : `Forwarding: ${config.forwarding ? "on" : "off"}<br>Out-of-order execution: ${config.outOfOrderExecution !== false ? "on" : "off"}`)
    + `<br>Floating point: ${config.floatingPointPrecision === "double" ? "double (64-bit)" : "single (32-bit)"}`
    + `<br>Compressed instructions: ${config.compressedInstructions ? "on" : "off"}`
    + `<br>${memoryDetails}`;
  $("#pipeline-diagram").innerHTML = `<div class="diagram-title">${o3 ? "Superscalar" : "Five-Stage Pipeline (F/D/E/M/W)"}</div>${blocks}<div class="diagram-detail">${details}</div>`;
}

function expandedLoopView() {
  return Boolean($("#expand-loops").checked && session.state.pipelineData?.dynamicInstructions?.length);
}

function displayedPipelineRows() {
  if (!session.state.pipelineData) return [];
  return expandedLoopView() ? session.state.pipelineData.dynamicInstructions : session.state.pipelineData.instructions;
}

function pipelineRowBounds(row) {
  const cycles = Object.keys(row.cycles).map(Number);
  return {first: Math.min(...cycles), last: Math.max(...cycles)};
}

function jumpsForPipelineRow(row, lastVisibleCycle, expanded = expandedLoopView()) {
  if (row.squashed) return [];
  let jumps = (session.state.pipelineData.jumps || []).filter(jump =>
    jump.fromAddress === row.address && jump.cycle <= lastVisibleCycle);
  if (expanded) {
    const bounds = pipelineRowBounds(row);
    jumps = jumps.filter(jump => jump.instructionSequence != null && row.sequence != null
      ? jump.instructionSequence === row.sequence
      : bounds.first <= jump.cycle && jump.cycle <= bounds.last);
  }
  const grouped = new Map();
  jumps.forEach(jump => {
    const entry = grouped.get(jump.toAddress) || {target: jump.toAddress, cycles: []};
    entry.cycles.push(jump.cycle);
    grouped.set(jump.toAddress, entry);
  });
  return [...grouped.values()];
}

function cacheEventsForPipelineRow(row, lastVisibleCycle) {
  const grouped = new Map();
  (row.cacheEvents || []).filter(event =>
    Number(event.cycle) <= lastVisibleCycle
  ).forEach(event => {
    const key = `${event.cache}:${event.result}`;
    const entry = grouped.get(key) || {...event, count: 0};
    entry.count += 1;
    grouped.set(key, entry);
  });
  return [...grouped.values()];
}

function jumpTargetRow(rows, address, afterCycle = 0) {
  if (!expandedLoopView()) return rows.findIndex(row => row.address === address);
  let fallback = -1;
  for (let index = 0; index < rows.length; index++) {
    if (rows[index].address !== address) continue;
    if (fallback < 0) fallback = index;
    if (pipelineRowBounds(rows[index]).first > afterCycle) return index;
  }
  return fallback;
}

function pipelineStageTokens(stage) {
  return stage.match(/[A-Z]\*?/g) || [];
}

function pipelineStageLabel(stage, o3) {
  const tokens = pipelineStageTokens(stage);
  if (o3) {
    return tokens.map(token =>
      ({C: "CDB", W: "C"}[token[0]] || token[0]) + token.slice(1)).join("/");
  }
  return tokens.length > 1 ? tokens.join("/") : stage;
}

function pipelineDisplayCycles(data = session.state.pipelineData) {
  if (!data) return [];
  const hidden = new Set(data.collapsedRecoveryCycles || []);
  const cycles = [];
  for (let cycle = 1; cycle <= data.cycles; cycle++) {
    if (!hidden.has(cycle)) cycles.push(cycle);
  }
  return cycles;
}

let lastRender = [];
function renderPipeline() {
  // Operations and Lumino visibility signals can arrive in the same turn.
  // Reuse the existing virtual viewport when neither data nor geometry changed.
  const signature = [session.state.pipelineData, session.state.playbackCycle,
    session.state.selectedRow, session.state.selectedColumn, session.state.stepMode,
    $("#expand-loops").checked, $("#cell-width").value, root.clientWidth, root.clientHeight];
  if (signature.every((value, index) => value === lastRender[index])) return;
  lastRender = signature;

  if (pipelinePaintFrame !== null) {
    cancelAnimationFrame(pipelinePaintFrame);
    pipelinePaintFrame = null;
  }
  if (pipelineResizeObserver) {
    pipelineResizeObserver.disconnect();
    pipelineResizeObserver = null;
  }
  renderProgramCounter();
  const data = session.state.pipelineData;
  if (!data) {
    $("#pipeline-grid").innerHTML = "";
    updatePipelineScrollButtons();
    $("#pipeline-diagram").innerHTML = "";
    $("#pipeline-pc").textContent = "PC —";
    $("#pipeline-summary").textContent = "No pipeline trace loaded.";
    $("#detail").textContent = "Hover a pipeline cell to inspect it.";
    updateCycleNavigation();
    return;
  }
  const displayRows = displayedPipelineRows();
  const displayCycles = pipelineDisplayCycles(data);
  const columnCount = displayCycles.length;
  const dynamicRows = (data.dynamicInstructions?.length ? data.dynamicInstructions : data.instructions)
    .filter(row => !row.squashed);
  const cellWidth = Number($("#cell-width").value);
  const rowHeight = 27;
  const addressWidth = 88;
  const instructionWidth = window.innerWidth <= 700 ? 150 : 182;
  const flowWidth = window.innerWidth <= 700 ? 132 : 140;
  const frozenWidth = addressWidth + instructionWidth + flowWidth;
  const totalWidth = addressWidth + instructionWidth + flowWidth + columnCount * cellWidth;
  const grid = $("#pipeline-grid");
  const scroll = $("#pipeline-scroll");
  const savedLeft = scroll.scrollLeft;
  const savedTop = scroll.scrollTop;

  document.documentElement.style.setProperty("--cell", cellWidth + "px");
  document.documentElement.style.setProperty("--address-width", addressWidth + "px");
  document.documentElement.style.setProperty("--instruction-width", instructionWidth + "px");
  document.documentElement.style.setProperty("--flow-width", flowWidth + "px");
  const visibleCycle = session.state.playbackCycle === null ? data.cycles : session.state.playbackCycle;
  const cpi = dynamicRows.length ? (data.cycles / dynamicRows.length).toFixed(2) : "—";
  const codeBytes = data.codeBytes ?? new Set(data.instructions.map(row => row.address)).size * 4;
  const instructionCount = displayRows.filter(row =>
    !row.squashed && row.iterations !== 0).length;
  const predictionMisses = displayRows.reduce((total, row) =>
    total + Number(row.mispredictions || (row.mispredicted ? 1 : 0)), 0);
  const predictionSummary = predictionMisses ? ` · ${predictionMisses} BP misses` : "";
  $("#pipeline-summary").textContent = `${instructionCount} instructions · ${codeBytes} bytes pipeline code${predictionSummary} · CPI ${cpi}`;
  updateCycleNavigation();
  // Leave one cell of scrollable breathing room without adding fake cycles
  // or instructions to the table, playback, statistics, or CSV exports.
  grid.style.width = (totalWidth + cellWidth) + "px";
  grid.innerHTML = `<div class="pipeline-header" style="width:${totalWidth}px"></div><div class="pipeline-rows" style="height:${(displayRows.length + 1) * rowHeight}px;width:${totalWidth}px"></div>`;
  const header = grid.querySelector(".pipeline-header");
  const rows = grid.querySelector(".pipeline-rows");
  const cycleOverscan = 8;
  let paintedFirstRow = -1;
  let paintedLastRow = -1;
  let paintedFirstCycle = -1;
  let paintedLastCycle = -1;
  let forceNextPaint = false;

  function visibleCycleWindow() {
    const cycleViewportWidth = Math.max(
      cellWidth, scroll.clientWidth - frozenWidth);
    const firstVisible = Math.max(
      1, Math.floor(scroll.scrollLeft / cellWidth) + 1);
    const lastVisible = Math.min(
      columnCount,
      Math.ceil((scroll.scrollLeft + cycleViewportWidth) / cellWidth));
    return {
      first: Math.max(1, firstVisible - cycleOverscan),
      last: Math.min(columnCount, lastVisible + cycleOverscan)
    };
  }

  function virtualColumns(firstCycle, lastCycle) {
    const beforeWidth = (firstCycle - 1) * cellWidth;
    const cycleCount = Math.max(0, lastCycle - firstCycle + 1);
    const afterWidth = Math.max(0, columnCount - lastCycle) * cellWidth;
    return `${addressWidth}px ${instructionWidth}px ${flowWidth}px ${beforeWidth}px repeat(${cycleCount}, ${cellWidth}px) ${afterWidth}px`;
  }

  function paintHeader(firstCycle, lastCycle, columns) {
    let html = '<div class="cell address-cell head corner">PC Address</div>';
    html += '<div class="cell inst head corner">Instruction</div>';
    html += '<div class="cell flow-cell head corner" title="Control-flow transfers, prediction misses, and cache misses">Control / cache</div>';
    html += '<div class="pipeline-cycle-spacer" aria-hidden="true"></div>';
    for (let column = firstCycle; column <= lastCycle; column++) {
      const cycle = displayCycles[column - 1];
      html += `<div class="cell head ${session.state.selectedColumn === cycle ? "column-selected" : ""}${cycle > visibleCycle ? " future" : ""}" data-col="${cycle}">${cycle}</div>`;
    }
    html += '<div class="pipeline-cycle-spacer" aria-hidden="true"></div>';
    header.style.gridTemplateColumns = columns;
    header.innerHTML = html;
  }

  function paintRows(first, last, firstCycle, lastCycle, columns) {
    let html = "";

    for (let rowIndex = first; rowIndex < last; rowIndex++) {
      const row = displayRows[rowIndex];
      html += `<div class="pipeline-row ${session.state.selectedRow === rowIndex ? "row-selected" : ""}${row.squashed ? " wrong-path" : ""}" style="top:${rowIndex * rowHeight}px;grid-template-columns:${columns};width:${totalWidth}px">`;
      const iterationText = row.iterations > 1 ? ` · ${row.iterations} iterations` : "";
      const address = row.address ? `0x${services.escapeHtml(row.address)}` : "—";
      html += `<div class="cell address-cell" data-row="${rowIndex}" title="Program counter">${address}</div>`;
      html += `<div class="cell inst" data-row="${rowIndex}" title="${services.escapeHtml(row.instruction + iterationText)}">${services.highlightAsmLine(row.instruction)}</div>`;
      const jumpLinks = jumpsForPipelineRow(row, visibleCycle).map(jump => {
        const targetRow = jumpTargetRow(displayRows, jump.target, jump.cycles[0]);
        const arrow = targetRow >= 0 && targetRow < rowIndex ? "↶" : "↷";
        const count = jump.cycles.length > 1 ? ` ×${jump.cycles.length}` : "";
        const cycles = jump.cycles.join(", ");
        if (expandedLoopView()) {
          return `<span class="jump-label" title="Taken at cycle${jump.cycles.length > 1 ? "s" : ""} ${cycles}">${arrow} 0x${services.escapeHtml(jump.target)}${count}</span>`;
        }
        return `<button class="jump-arrow" data-jump-target="${services.escapeHtml(jump.target)}" data-jump-cycle="${jump.cycles[0]}" title="Taken at cycle${jump.cycles.length > 1 ? "s" : ""} ${cycles}">${arrow} 0x${services.escapeHtml(jump.target)}${count}</button>`;
      }).join("");
      const cacheEvents = cacheEventsForPipelineRow(row, visibleCycle).map(event => {
        const count = event.count > 1 ? ` ×${event.count}` : "";
        const status = `${event.cache}$ ${event.result}`;
        return `<span class="cache-event cache-${event.result}" title="${services.escapeHtml(`${status}; see Log Output for address and timing details`)}">${status}${count}</span>`;
      }).join("");
      const predictionMisses = Number(row.mispredictions || (row.mispredicted ? 1 : 0));
      const predictionEvent = predictionMisses
        ? `<span class="branch-miss">BP miss${predictionMisses > 1 ? ` ×${predictionMisses}` : ""}</span>`
        : "";
      const squashEvent = row.squashed
        ? `<span class="squash-label" title="Wrong-path instruction discarded after a branch misprediction">Squashed</span>`
        : "";
      html += `<div class="cell flow-cell" data-row="${rowIndex}">${jumpLinks}${predictionEvent}${cacheEvents}${squashEvent}</div>`;
      html += '<div class="pipeline-cycle-spacer" aria-hidden="true"></div>';
      for (let column = firstCycle; column <= lastCycle; column++) {
        const cycle = displayCycles[column - 1];
        const stage = row.cycles[cycle] || "";
        const label = pipelineStageLabel(stage, session.state.pipelineData.format === "o3");
        const tokens = pipelineStageTokens(stage);
        const stageClass = tokens.length ? "stage-" + tokens.at(-1)[0] : "";
        const squashedClass = stage.includes("*") ? " squashed-stage" : "";
        const columnClass = session.state.selectedColumn === cycle ? " column-selected" : "";
        html += `<div class="cell ${stageClass}${squashedClass}${columnClass}${cycle > visibleCycle ? " future" : ""}" data-row="${rowIndex}" data-col="${cycle}" data-stage="${stage}">${label}</div>`;
      }
      html += '<div class="pipeline-cycle-spacer" aria-hidden="true"></div>';
      html += "</div>";
    }
    rows.innerHTML = html;
  }

  function paintViewport(force = false) {
    const visibleTop = Math.max(0, scroll.scrollTop - rowHeight);
    const firstRow = Math.max(0, Math.floor(visibleTop / rowHeight) - 6);
    const visibleRowCount = Math.ceil(scroll.clientHeight / rowHeight) + 14;
    const lastRow = Math.min(displayRows.length, firstRow + visibleRowCount);
    const cycleWindow = visibleCycleWindow();
    const rowsChanged = firstRow !== paintedFirstRow || lastRow !== paintedLastRow;
    const cyclesChanged = cycleWindow.first !== paintedFirstCycle
      || cycleWindow.last !== paintedLastCycle;
    if (!force && !rowsChanged && !cyclesChanged) return;
    const columns = virtualColumns(cycleWindow.first, cycleWindow.last);
    if (force || cyclesChanged) {
      paintHeader(cycleWindow.first, cycleWindow.last, columns);
    }
    if (force || rowsChanged || cyclesChanged) {
      paintRows(firstRow, lastRow, cycleWindow.first, cycleWindow.last, columns);
    }
    paintedFirstRow = firstRow;
    paintedLastRow = lastRow;
    paintedFirstCycle = cycleWindow.first;
    paintedLastCycle = cycleWindow.last;
  }

  function schedulePaint(force = false) {
    forceNextPaint ||= force;
    if (pipelinePaintFrame !== null) return;
    pipelinePaintFrame = requestAnimationFrame(() => {
      pipelinePaintFrame = null;
      const repaintAll = forceNextPaint;
      forceNextPaint = false;
      paintViewport(repaintAll);
    });
  }

  grid.onmousemove = event => {
    const cell = event.target.closest("[data-col]");
    if (!cell) return;
    const stage = cell.dataset.stage;
    if (stage) {
      const row = displayRows[Number(cell.dataset.row)];
      const stageNames = {
        F: "Fetch",
        D: "Decode",
        R: "Rename",
        I: "In-order issue to reservation station / IQ",
        E: "Execute",
        M: "Memory access / request",
        C: "Write result on CDB",
        W: session.state.pipelineData.format === "o3" ? "Commit" : "Writeback",
        S: session.state.pipelineData.format === "o3" ? "Wait in reservation station / ROB" : "Pipeline stall / wait",
        X: "Squashed after incorrect speculation"
      };
      const stageName = pipelineStageTokens(stage)
        .map(token => (stageNames[token[0]] || token[0])
          + (token.endsWith("*") ? " (wrong path; later squashed)" : ""))
        .join(" / ");
      $("#detail").textContent = `Instruction: ${row.instruction} | Cycle: ${cell.dataset.col} | Stage: ${stageName} | Iterations: ${row.iterations}`;
    } else {
      $("#detail").textContent = `Clock cycle ${cell.dataset.col}`;
    }
  };

  pipelineSelectTarget = target => {
    const jumpLink = target.closest("[data-jump-target]");
    if (jumpLink) {
      const targetRow = jumpTargetRow(displayRows, jumpLink.dataset.jumpTarget,
        Number(jumpLink.dataset.jumpCycle || 0));
      if (targetRow >= 0) {
        session.update({selectedRow: targetRow});
        scroll.scrollTop = Math.max(0, targetRow * rowHeight - rowHeight * 2);
        services.highlightSourceLine(displayRows[targetRow].sourceLine);
        paintViewport(true);
      }
      return;
    }
    const cell = target.closest("[data-row], [data-col]");
    if (!cell) return;
    if (cell.dataset.row !== undefined) {
      session.update({selectedRow: Number(cell.dataset.row)});
      services.highlightSourceLine(displayRows[session.state.selectedRow].sourceLine);
    }
    if (cell.dataset.col !== undefined) services.execute("trace:select-cycle", {cycle:Number(cell.dataset.col)});
    paintViewport(true);
  };
  grid.onclick = null;
  grid.oncontextmenu = event => {
    if (!event.target.closest("[data-row], [data-col], [data-jump-target]")) return;
    event.preventDefault();
    pipelineSelectTarget(event.target);
  };

  scroll.onscroll = () => schedulePaint();
  scroll.scrollLeft = savedLeft;
  scroll.scrollTop = savedTop;
  paintViewport(true);
  if ("ResizeObserver" in window) {
    pipelineResizeObserver = new ResizeObserver(() => schedulePaint(true));
    pipelineResizeObserver.observe(scroll);
  }
  // renderPipeline can run while its tab is hidden. Recalculate once the
  // browser has laid out the newly visible pipeline viewport.
  schedulePaint(true);
  updatePipelineScrollButtons();
  renderPipelineDiagram();
}

function adjustCellWidth(delta) {
  const slider = $("#cell-width");
  slider.value = Math.max(Number(slider.min), Math.min(Number(slider.max), Number(slider.value) + delta));
  if (session.state.pipelineData) renderPipeline();
}

function exportVisiblePipeline() {
  if (!session.state.pipelineData || !session.state.current) return;
  const lastCycle = session.state.playbackCycle === null ? session.state.pipelineData.cycles : session.state.playbackCycle;
  const displayCycles = pipelineDisplayCycles(session.state.pipelineData)
    .filter(cycle => cycle <= lastCycle);
  const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const dynamicRows = (session.state.pipelineData.dynamicInstructions?.length
    ? session.state.pipelineData.dynamicInstructions : session.state.pipelineData.instructions)
    .filter(row => !row.squashed);
  const stalls = dynamicRows.reduce((total, row) =>
    total + Object.values(row.cycles).filter(stage => stage === "S").length, 0);
  const instructionCount = dynamicRows.length;
  const predictionMisses = displayedPipelineRows().reduce((total, row) =>
    total + Number(row.mispredictions || (row.mispredicted ? 1 : 0)), 0);
  const cpi = instructionCount ? (session.state.pipelineData.cycles / instructionCount).toFixed(3) : "0";
  const headers = ["PC Address", "Instruction", "Control flow / cache"];
  for (const cycle of displayCycles) {
    headers.push(`Cycle ${cycle}`);
  }
  const rows = displayedPipelineRows().map(row => {
    const flow = [
      ...jumpsForPipelineRow(row, lastCycle).map(jump =>
        `0x${row.address} -> 0x${jump.target}${jump.cycles.length > 1 ? ` x${jump.cycles.length}` : ""}`),
      ...cacheEventsForPipelineRow(row, lastCycle).map(event =>
        `${event.cache}$ ${event.result}${event.count > 1 ? ` x${event.count}` : ""}`),
      ...(Number(row.mispredictions || (row.mispredicted ? 1 : 0))
        ? [`BP miss${Number(row.mispredictions || 1) > 1 ? ` x${Number(row.mispredictions)}` : ""}`]
        : []),
      ...(session.state.pipelineData.format === "o3" && row.squashed ? ["Squashed"] : [])
    ].join("; ");
    const values = [row.address ? `0x${row.address}` : "", row.instruction, flow];
    for (const cycle of displayCycles) {
      values.push(pipelineStageLabel(row.cycles[cycle] || "", session.state.pipelineData.format === "o3"));
    }
    return values;
  });
  const summary = [
    ["Pipeline summary", "Value"],
    ["Total cycles", session.state.pipelineData.cycles],
    ["Executed instructions", instructionCount],
    ["Pipeline code size (bytes)", session.state.pipelineData.codeBytes || 0],
    ["Branch prediction misses", predictionMisses],
    ["Stalls", stalls],
    ["CPI", cpi],
    []
  ];
  const csv = [...summary, headers, ...rows]
    .map(row => row.map(quote).join(",")).join("\r\n") + "\r\n";
  const blob = new Blob(["\ufeff", csv], {type: "text/csv;charset=utf-8"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${session.state.current.name}-pipeline-cycle-${lastCycle}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function pipelineScrollbarMetrics(viewport, extent, position, trackLength) {
  const limit = Math.max(0, extent - viewport);
  const length = Math.min(trackLength, Math.max(24,
    extent > 0 ? trackLength * viewport / extent : trackLength));
  const travel = Math.max(0, trackLength - length);
  const offset = limit ? travel * Math.max(0, Math.min(limit, position)) / limit : 0;
  return {limit, length, travel, offset};
}

function pipelineScrollbarsNeeded(width, height, contentWidth, contentHeight, size) {
  let horizontal = false;
  let vertical = false;
  // An overflowing axis reduces the other axis's available space. Start with
  // the full frame each time so a resize cannot leave unnecessary bars behind.
  for (let pass = 0; pass < 3; pass++) {
    horizontal = contentWidth > width - (vertical ? size : 0) + 1;
    vertical = contentHeight > height - (horizontal ? size : 0) + 1;
  }
  return {horizontal: width > 0 && horizontal, vertical: height > 0 && vertical};
}

function installPipelineScrollControls(scroll, buttons, getStep, tracks = []) {
  const frame = scroll.parentElement;
  const scrollbarSize = 18;
  const integrated = tracks.length === 2;
  if (integrated) frame.classList.add("scrollbars-ready");
  const axes = {
    horizontal: ["scrollLeft", "scrollWidth", "clientWidth", "clientX", "left", "width", "left", "right"],
    vertical: ["scrollTop", "scrollHeight", "clientHeight", "clientY", "top", "height", "up", "down"]
  };
  const directions = {
    left: ["scrollLeft", "scrollWidth", "clientWidth", -1],
    right: ["scrollLeft", "scrollWidth", "clientWidth", 1],
    up: ["scrollTop", "scrollHeight", "clientHeight", -1],
    down: ["scrollTop", "scrollHeight", "clientHeight", 1]
  };
  function update() {
    if (integrated) {
      const needed = pipelineScrollbarsNeeded(frame.clientWidth, frame.clientHeight,
        scroll.scrollWidth, scroll.scrollHeight, scrollbarSize);
      frame.style.setProperty("--pipeline-scrollbar-x", needed.horizontal ? scrollbarSize + "px" : "0px");
      frame.style.setProperty("--pipeline-scrollbar-y", needed.vertical ? scrollbarSize + "px" : "0px");
      for (const track of tracks) {
        track.parentElement.hidden = !needed[track.dataset.pipelineScrollAxis];
      }
    }
    for (const button of buttons) {
      const [position, extent, viewport, sign] = directions[button.dataset.pipelineScroll];
      const limit = Math.max(0, scroll[extent] - scroll[viewport]);
      button.disabled = scroll[viewport] === 0 || (sign < 0
        ? scroll[position] <= 0 : scroll[position] >= limit - 1);
    }
    for (const track of tracks) {
      const [position, extent, viewport, , offset, length] = axes[track.dataset.pipelineScrollAxis];
      const metrics = pipelineScrollbarMetrics(scroll[viewport], scroll[extent],
        scroll[position], track[viewport]);
      const thumb = track.firstElementChild;
      thumb.style[length] = metrics.length + "px";
      thumb.style[offset] = metrics.offset + "px";
      thumb.setAttribute("aria-valuemax", String(Math.round(metrics.limit)));
      thumb.setAttribute("aria-valuenow", String(Math.round(
        Math.max(0, Math.min(metrics.limit, scroll[position])))));
    }
  }
  for (const button of buttons) {
    const direction = button.dataset.pipelineScroll;
    let repeatTimer = null;
    let activePointer = null;
    let repeated = false;
    function move() {
      if (button.disabled) return;
      const [position, extent, viewport, sign] = directions[direction];
      const limit = Math.max(0, scroll[extent] - scroll[viewport]);
      scroll[position] = Math.max(0, Math.min(limit,
        scroll[position] + sign * getStep(direction)));
      update();
    }
    function stop() {
      clearTimeout(repeatTimer);
      repeatTimer = null;
      if (activePointer !== null && button.hasPointerCapture(activePointer)) {
        button.releasePointerCapture(activePointer);
      }
      activePointer = null;
    }
    function repeat() {
      repeated = true;
      move();
      if (!button.disabled) repeatTimer = setTimeout(repeat, 70);
    }
    button.addEventListener("click", event => {
      // Pointer holds already scrolled; keyboard and ordinary clicks move once.
      if (!repeated || event.detail === 0) move();
      repeated = false;
    });
    button.addEventListener("pointerdown", event => {
      if (event.button !== 0 || button.disabled) return;
      stop();
      repeated = false;
      activePointer = event.pointerId;
      button.setPointerCapture(activePointer);
      repeatTimer = setTimeout(repeat, 350);
    });
    button.addEventListener("pointerup", stop);
    button.addEventListener("pointercancel", stop);
    button.addEventListener("lostpointercapture", stop);
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
    });
  }
  for (const track of tracks) {
    const [position, extent, viewport, coordinate, offset, , backward, forward] = axes[track.dataset.pipelineScrollAxis];
    const thumb = track.firstElementChild;
    let drag = null;
    function moveTo(value) {
      scroll[position] = Math.max(0, Math.min(scroll[extent] - scroll[viewport], value));
      update();
    }
    function stopDrag() {
      const pointerId = drag?.pointerId;
      drag = null;
      thumb.classList.remove("dragging");
      if (pointerId !== undefined && track.hasPointerCapture(pointerId)) {
        track.releasePointerCapture(pointerId);
      }
    }
    track.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      thumb.focus({preventScroll: true});
      if (event.target === thumb) {
        drag = {pointerId: event.pointerId, coordinate: event[coordinate], position: scroll[position]};
        track.setPointerCapture(event.pointerId);
        thumb.classList.add("dragging");
      } else {
        const metrics = pipelineScrollbarMetrics(scroll[viewport], scroll[extent],
          scroll[position], track[viewport]);
        const before = event[coordinate] - track.getBoundingClientRect()[offset] < metrics.offset;
        moveTo(scroll[position] + (before ? -1 : 1) * scroll[viewport]);
      }
    });
    track.addEventListener("pointermove", event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const metrics = pipelineScrollbarMetrics(scroll[viewport], scroll[extent],
        scroll[position], track[viewport]);
      if (metrics.travel) moveTo(drag.position
        + (event[coordinate] - drag.coordinate) * metrics.limit / metrics.travel);
    });
    track.addEventListener("pointerup", stopDrag);
    track.addEventListener("pointercancel", stopDrag);
    track.addEventListener("lostpointercapture", stopDrag);
    window.addEventListener("blur", stopDrag);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopDrag();
    });
    thumb.addEventListener("keydown", event => {
      const keys = track.dataset.pipelineScrollAxis === "horizontal"
        ? {ArrowLeft: -getStep(backward), ArrowRight: getStep(forward)}
        : {ArrowUp: -getStep(backward), ArrowDown: getStep(forward)};
      keys.PageUp = -scroll[viewport];
      keys.PageDown = scroll[viewport];
      let target;
      if (event.key === "Home") target = 0;
      else if (event.key === "End") target = scroll[extent] - scroll[viewport];
      else if (Object.hasOwn(keys, event.key)) target = scroll[position] + keys[event.key];
      else return;
      event.preventDefault();
      moveTo(target);
    });
    // Scroll-wheel events over the replacement track still reach the viewport.
    track.parentElement.addEventListener("wheel", event => {
      const scale = event.deltaMode === 1 ? 27
        : event.deltaMode === 2 ? scroll[viewport] : 1;
      const delta = track.dataset.pipelineScrollAxis === "horizontal"
        ? event.deltaX || event.deltaY : event.deltaY;
      if (!delta) return;
      event.preventDefault();
      moveTo(scroll[position] + delta * scale);
    }, {passive: false});
  }
  scroll.addEventListener("scroll", update, {passive: true});
  if ("ResizeObserver" in window) {
    let resizePending = false;
    const observer = new ResizeObserver(() => {
      // Changing scrollbar visibility changes the observed viewport size.
      // Defer that layout change to avoid a ResizeObserver delivery loop.
      if (resizePending) return;
      resizePending = true;
      window.requestAnimationFrame(() => {
        resizePending = false;
        update();
      });
    });
    observer.observe(scroll);
    observer.observe(scroll.firstElementChild);
    if (integrated) observer.observe(frame);
  }
  update();
  return update;
}

function pipelinePointerOnScrollbar(scroll, event) {
  const bounds = scroll.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  return x < scroll.clientLeft || x >= scroll.clientLeft + scroll.clientWidth
    || y < scroll.clientTop || y >= scroll.clientTop + scroll.clientHeight;
}

const pipelineScroll = $("#pipeline-scroll");

const updatePipelineScrollButtons = installPipelineScrollControls(
  pipelineScroll, root.querySelectorAll("[data-pipeline-scroll]"),
  direction => direction === "left" || direction === "right"
    ? Number($("#cell-width").value) : 27,
  root.querySelectorAll("[data-pipeline-scroll-axis]"));

let pipelinePan = null;

pipelineScroll.addEventListener("pointerdown", event => {
  if (event.button !== 0 && event.button !== 1) return;
  if (pipelinePointerOnScrollbar(pipelineScroll, event)) return;
  if (event.button === 0 && event.target.closest(".jump-arrow")) return;
  if (event.button === 1) event.preventDefault();
  pipelinePan = {
    pointerId: event.pointerId,
    button: event.button,
    x: event.clientX,
    y: event.clientY,
    left: pipelineScroll.scrollLeft,
    top: pipelineScroll.scrollTop,
    target: event.target,
    moved: false
  };
  pipelineScroll.setPointerCapture(event.pointerId);
});

pipelineScroll.addEventListener("pointermove", event => {
  if (!pipelinePan || event.pointerId !== pipelinePan.pointerId) return;
  const distance = Math.hypot(event.clientX - pipelinePan.x, event.clientY - pipelinePan.y);
  if (!pipelinePan.moved && distance < 3) return;
  pipelinePan.moved = true;
  pipelineScroll.classList.add("panning");
  pipelineScroll.scrollLeft = pipelinePan.left - (event.clientX - pipelinePan.x);
  pipelineScroll.scrollTop = pipelinePan.top - (event.clientY - pipelinePan.y);
});

function finishPipelinePan(event) {
  if (!pipelinePan || event.pointerId !== pipelinePan.pointerId) return;
  if (pipelineScroll.hasPointerCapture(event.pointerId)) pipelineScroll.releasePointerCapture(event.pointerId);
  pipelinePan = null;
  pipelineScroll.classList.remove("panning");
}

pipelineScroll.addEventListener("pointerup", finishPipelinePan);

pipelineScroll.addEventListener("pointercancel", finishPipelinePan);

pipelineScroll.addEventListener("auxclick", event => {
  if (event.button === 1) event.preventDefault();
});

function renderProgramCounter() {
  const changes = session.state.pipelineData?.pcDeltas || {};
  let pc = '—';
  for (let i = 1; i <= (session.state.playbackCycle || 0); i++) if (changes[i]) pc = changes[i];
  $("#pipeline-pc").textContent = 'PC ' + pc;
  $("#pipeline-pc").classList.toggle('changed', Boolean(changes[session.state.playbackCycle]));
}
return {selectPipelineTarget:target=>pipelineSelectTarget?.(target), resetPipelineViewport, positionPipelineCycle, updateCycleNavigation, renderPipelineDiagram, expandedLoopView, displayedPipelineRows, pipelineRowBounds, jumpsForPipelineRow, cacheEventsForPipelineRow, jumpTargetRow, pipelineStageTokens, pipelineStageLabel, pipelineDisplayCycles, renderPipeline, adjustCellWidth, exportVisiblePipeline, pipelineScrollbarMetrics, pipelineScrollbarsNeeded, installPipelineScrollControls, pipelinePointerOnScrollbar, finishPipelinePan, renderProgramCounter};
}
