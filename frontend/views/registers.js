// SPDX-FileCopyrightText: 2026 Behnam Farnaghinejad <behnam.farnaghinejad@polito.it>
// SPDX-License-Identifier: GPL-2.0-only
// Modified in the personal fork on 2026-11-02: extract Studio rendering/operations for Lumino.
// Earlier fork changes (2026-10-27–2026-10-31): Monaco, autosave, playback and managed updates.

/** View contract: session state, owned root and application callbacks; no sibling DOM queries. */
export function createRegistersView({session, services, shell, root}) {
const $ = selector => root.matches(selector) ? root : root.querySelector(selector);
let lastRender = [];
function renderRegisters() {
  const signature = [session.state.pipelineData, session.state.playbackCycle,
    $("#integer-register-format").value, $("#float-register-format").value];
  if (signature.every((value, index) => value === lastRender[index])) return;
  lastRender = signature;

  const integerContainer = $("#integer-registers");
  const floatContainer = $("#float-registers");
  if (!session.state.pipelineData || session.state.playbackCycle === null) {
    integerContainer.innerHTML = "";
    floatContainer.innerHTML = "";
    return;
  }
  const deltas = session.state.pipelineData.registerDeltas || {};
  const state = {x0: "0x00000000", ...(session.state.pipelineData.initialRegisters || {})};
  const changed = new Set();
  for (let cycle = 1; cycle <= session.state.playbackCycle; cycle++) {
    const update = deltas[String(cycle)];
    if (update) {
      if (cycle === session.state.playbackCycle) Object.keys(update).forEach(register => changed.add(register));
      Object.assign(state, update);
    }

  }
  const integerAbi = ["zero", "ra", "sp", "gp", "tp", "t0", "t1", "t2", "s0/fp", "s1", "a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "t3", "t4", "t5", "t6"];
  const floatAbi = ["ft0", "ft1", "ft2", "ft3", "ft4", "ft5", "ft6", "ft7", "fs0", "fs1", "fa0", "fa1", "fa2", "fa3", "fa4", "fa5", "fa6", "fa7", "fs2", "fs3", "fs4", "fs5", "fs6", "fs7", "fs8", "fs9", "fs10", "fs11", "ft8", "ft9", "ft10", "ft11"];
  const integerRoles = ["constant zero", "return address", "stack pointer", "global pointer", "thread pointer", "temporary", "temporary", "temporary", "saved register / frame pointer", "saved register", "argument / return value", "argument / return value", "argument / return value", "argument / return value", "argument / return value", "argument / return value", "argument / return value", "argument / return value", "saved register", "saved register", "saved register", "saved register", "saved register", "saved register", "saved register", "saved register", "saved register", "saved register", "temporary", "temporary", "temporary", "temporary"];
  const floatRoles = ["temporary FP register", "temporary FP register", "temporary FP register", "temporary FP register", "temporary FP register", "temporary FP register", "temporary FP register", "temporary FP register", "saved FP register", "saved FP register", "FP argument / return value", "FP argument / return value", "FP argument / return value", "FP argument / return value", "FP argument / return value", "FP argument / return value", "FP argument / return value", "FP argument / return value", "saved FP register", "saved FP register", "saved FP register", "saved FP register", "saved FP register", "saved FP register", "saved FP register", "saved FP register", "saved FP register", "saved FP register", "temporary FP register", "temporary FP register", "temporary FP register", "temporary FP register"];
  const renderColumn = (prefix, aliases, roles, format, width) => aliases.map((alias, index) => {
    const name = `${prefix}${index}`;
    const label = `${name} / ${alias.replace("/", " / ")} — ${roles[index] || "register"}`;
    return `<div class="register-value${changed.has(name) ? " changed" : ""}" data-register-change="${name}" title="${services.escapeHtml(label)}" aria-label="${services.escapeHtml(label)}"><strong>${name}</strong><span>${services.escapeHtml(alias)}</span><code>${state[name] === undefined ? "—" : services.formatWordValue(state[name], format, width)}</code></div>`;
  }).join("");

  const floatWidth = session.state.pipelineData.configuration?.floatingPointPrecision === "double" ? 64 : 32;
  integerContainer.innerHTML = renderColumn("x", integerAbi, integerRoles, $("#integer-register-format").value, 32);
  floatContainer.innerHTML = renderColumn("f", floatAbi, floatRoles, $("#float-register-format").value, floatWidth);
}
return {renderRegisters};
}
