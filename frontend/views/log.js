// SPDX-FileCopyrightText: 2026 Behnam Farnaghinejad <behnam.farnaghinejad@polito.it>
// SPDX-License-Identifier: GPL-2.0-only
// Modified in the personal fork on 2026-11-02: extract Studio rendering/operations for Lumino.
// Earlier fork changes (2026-10-27–2026-10-31): Monaco, autosave, playback and managed updates.

/** View contract: session state, owned root and application callbacks; no sibling DOM queries. */
export function createLogView({session, services, shell, root}) {
const $ = selector => root.matches(selector) ? root : root.querySelector(selector);
function renderLogOutput(log) {
  const output = $("#output");
  if (!output) return;
  const text = String(log || "");
  const diagnostics = services.parseCompilerDiagnostics(text);
  const byLine = new Map();
  diagnostics.filter(entry => entry.outputLine).forEach(entry => {
    const entries = byLine.get(entry.outputLine) || [];
    entries.push(entry);
    byLine.set(entry.outputLine, entries);
  });
  const preferredDiagnostic = entries => {
    const located = entries.filter(entry => entry.line);
    const candidates = located.length ? located : entries;
    const rank = {error: 0, warning: 1, note: 2};
    return candidates.reduce((preferred, entry) => {
      if (!preferred || (rank[entry.severity] ?? 3) < (rank[preferred.severity] ?? 3)) return entry;
      return preferred;
    }, null);
  };
  output.innerHTML = text.split(/\r?\n/).map((line, index) => {
    const lineDiagnostics = byLine.get(index + 1) || [];
    const diagnostic = preferredDiagnostic(lineDiagnostics);
    const content = services.escapeHtml(line) || "&#8203;";
    if (diagnostic?.line) {
      const count = lineDiagnostics.length > 1
        ? ` (${lineDiagnostics.length} diagnostics on this output line)` : "";
      return `<button type="button" class="log-diagnostic ${services.escapeHtml(diagnostic.severity || "error")}" data-log-line="${index + 1}" title="Jump to ${services.escapeHtml(diagnostic.file || session.state.current?.sourceName || "source")} line ${diagnostic.line}${count}">${content}</button>`;
    }
    return `<span class="log-line">${content}</span>`;
  }).join("");
  output.querySelectorAll("[data-log-line]").forEach(button => {
    button.onclick = () => {
      const entry = preferredDiagnostic(byLine.get(Number(button.dataset.logLine)) || []);
      if (entry?.line) services.jumpToSourcePosition(entry.line, entry.column);
    };
  });
}

let lastRenderedLog;
function updateLog() {
  const text = $("#advanced-logs").checked ? session.state.lastAdvancedLog : session.state.lastNormalLog;
  if (text === lastRenderedLog) return;
  lastRenderedLog = text;
  renderLogOutput(text);
}
return {renderLogOutput, updateLog};
}
