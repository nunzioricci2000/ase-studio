// SPDX-License-Identifier: GPL-2.0-only
// Created in the personal fork on 2026-11-02: validate persistent layouts without touching drafts/preferences.
export const PANEL_IDS = ['projects', 'editor', 'registers', 'output', 'pipeline', 'memory'];
export const LAYOUT_KEY = 'ase-studio-layout';
export const LAYOUT_VERSION = 1;

/** Convert Lumino's widget references into stable, single-instance identifiers. */
export function encodeLayout(layout) {
  const visit = area => area === null ? null : area.type === 'tab-area'
    ? {type:area.type, currentIndex:area.currentIndex, widgets:area.widgets.map(w => w.panelId || w.id)}
    : {type:area.type, orientation:area.orientation, sizes:[...area.sizes], children:area.children.map(visit)};
  return {version:LAYOUT_VERSION, main:visit(layout.main)};
}

/** Reject unknown versions, duplicate panels and malformed or unbounded trees.
 * Missing IDs mean intentionally closed panels. An empty layout is valid. */
export function decodeLayout(saved, widgets) {
  if (!saved || saved.version !== LAYOUT_VERSION) throw Error('Unsupported layout');
  const seen = new Set();
  let nodes = 0;
  function visit(area, depth = 0) {
    if (area === null && depth === 0) return null;
    if (!area || depth > 12 || ++nodes > 24) throw Error('Invalid layout tree');
    if (area.type === 'tab-area') {
      if (!Array.isArray(area.widgets) || !area.widgets.length || area.widgets.length > PANEL_IDS.length
        || !Number.isInteger(area.currentIndex) || area.currentIndex < 0 || area.currentIndex >= area.widgets.length) throw Error('Invalid tabs');
      return {type:'tab-area', currentIndex:area.currentIndex, widgets:area.widgets.map(id => {
        if (!PANEL_IDS.includes(id) || seen.has(id)) throw Error('Invalid panel');
        seen.add(id); return widgets[id];
      })};
    }
    if (area.type !== 'split-area' || !['horizontal','vertical'].includes(area.orientation)
      || !Array.isArray(area.children) || area.children.length < 2 || area.children.length > 6
      || !Array.isArray(area.sizes) || area.sizes.length !== area.children.length
      || area.sizes.some(n => !Number.isFinite(n) || n <= 0)) throw Error('Invalid split');
    return {type:'split-area', orientation:area.orientation, sizes:[...area.sizes], children:area.children.map(child => visit(child, depth + 1))};
  }
  return {main:visit(saved.main)};
}
