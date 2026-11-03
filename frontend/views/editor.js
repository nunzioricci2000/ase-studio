// SPDX-FileCopyrightText: 2026 Behnam Farnaghinejad <behnam.farnaghinejad@polito.it>
// SPDX-License-Identifier: GPL-2.0-only
// Modified in the personal fork on 2026-11-02: extract Studio rendering/operations for Lumino.
// Earlier fork changes (2026-10-27–2026-10-31): Monaco, autosave, playback and managed updates.

/** View contract: session state, owned root and application callbacks; no sibling DOM queries. */
export function createEditorView({session, services, shell, root}) {
const $ = selector => root.matches(selector) ? root : root.querySelector(selector);
function clearDiagnostics() {
  session.update({diagnostics:[]});
  const container = $("#diagnostics");
  if (!container) return;
  container.hidden = true;
  container.innerHTML = "";
}

function jumpToSourcePosition(lineNumber, columnNumber = 1) {
  shell.open("editor");
  if (!session.state.current) return;
  highlightSourceLine(lineNumber);
  services.sourceEditor.goToPosition(lineNumber, columnNumber);
}

function renderDiagnostics(entries, heading = "Source diagnostics") {
  const container = $("#diagnostics");
  if (!container) return;
  if (!entries.length) {
    clearDiagnostics();
    return;
  }
  const shown = entries.slice(0, 40);
  const remaining = entries.length - shown.length;
  container.hidden = false;
  container.innerHTML = `<div class="diagnostics-header">${services.escapeHtml(heading)} · ${entries.length}</div><div class="diagnostics-list">${shown.map((entry, index) => {
    const location = entry.line
      ? `${entry.file ? `${entry.file}:` : ""}${entry.line}:${entry.column || 1}`
      : entry.kind === "linker" ? "linker" : "source";
    const content = `<span class="diagnostic-location">${services.escapeHtml(location)}</span><span class="diagnostic-message">${services.escapeHtml(entry.message)}</span>`;
    if (!entry.line) return `<div class="diagnostic-item ${services.escapeHtml(entry.severity || "error")}">${content}</div>`;
    const title = entry.inferred ? "Jump to the inferred source location" : "Jump to source location";
    return `<button type="button" class="diagnostic-item ${services.escapeHtml(entry.severity || "error")}" data-diagnostic-index="${index}" title="${title}">${content}</button>`;
  }).join("")}${remaining > 0 ? `<div class="diagnostic-message">… and ${remaining} more diagnostics</div>` : ""}</div>`;
  container.querySelectorAll("[data-diagnostic-index]").forEach(button => {
    button.onclick = () => {
      const entry = shown[Number(button.dataset.diagnosticIndex)];
      if (entry?.line) jumpToSourcePosition(entry.line, entry.column);
    };
  });
}

function setDiagnostics(entries, heading = "Source diagnostics") {
  session.update({diagnostics:entries});
  renderDiagnostics(entries, heading);
}

function syncEditor() {
  services.sourceEditor.setIsa(session.state.current?.isa);
  services.sourceEditor.setProtectionEnabled(services.protectionEnabled());
  services.sourceEditor.highlightLine(session.state.selectedSourceLine);
}

function highlightSourceLine(lineNumber) {
  shell.open("editor");
  session.update({selectedSourceLine: lineNumber || null});
  syncEditor();
  if (!session.state.selectedSourceLine) return;
  services.sourceEditor.highlightLine(session.state.selectedSourceLine, true);
}

function clearSourceLineHighlight() {
  if (session.state.selectedSourceLine === null) return;
  session.update({selectedSourceLine: null});
  syncEditor();
}
return {clearDiagnostics, jumpToSourcePosition, renderDiagnostics, setDiagnostics, syncEditor, highlightSourceLine, clearSourceLineHighlight};
}
