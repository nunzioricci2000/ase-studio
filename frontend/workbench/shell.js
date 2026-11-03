// SPDX-License-Identifier: GPL-2.0-only
// Created in the personal fork on 2026-11-02: reusable single-instance Studio panels with persistent docking.
import {DockPanel, Widget, Menu} from '@lumino/widgets';
import {Signal} from '@lumino/signaling';
import {PANEL_IDS, LAYOUT_KEY, encodeLayout, decodeLayout} from './layout.js';
import '@lumino/widgets/style/index.css';
import './shell.css';

const definitions = {
  projects:['Projects', 'project-panel'], editor:['Editor', 'work'], registers:['Registers', 'register-panel'],
  output:['Log Output', 'output-pane'], pipeline:['Pipeline', 'pipeline'], memory:['Memory', 'memory']
};

/** The shell owns widget lifetimes; closing a view only removes it from docking.
 * @param {import('@lumino/commands').CommandRegistry} commands
 * @returns {{dock: DockPanel, panels: Object<string, Widget>, nodes: Object<string, HTMLElement>,
 * shown: Signal, resized: Signal, activated: Signal, open: function(string):void,
 * reset: function():void, persist: function():void, isVisible: function(string):boolean}}
 */
export function createShell(commands) {
  const shown = new Signal({});
  const resized = new Signal({});
  const activated = new Signal({});
  const dock = new DockPanel({spacing:7});
  dock.id = 'studio-dock';
  const parking = document.createElement('div');
  parking.hidden = true;
  parking.id = 'closed-panels';
  document.body.append(parking);
  const nodes = Object.fromEntries(PANEL_IDS.map(id => [id, document.getElementById(definitions[id][1])]));
  const panels = {};
  let restoring = true;
  class StudioPanel extends Widget {
    constructor(id) {
      const content = nodes[id];
      content.hidden = false;
      // Lumino controls the wrapper's geometry; Studio retains its existing DOM.
      super();
      this.id = `panel-${id}`;
      this.panelId = id;
      this.addClass('studio-panel');
      this.node.dataset.panel = id;
      this.node.append(content);
      this.title.label = definitions[id][0];
      this.title.closable = true;
      this.title.caption = `${this.title.label} — drag to move, or use Views`;
      this.node.tabIndex = -1;
    }
    onCloseRequest() {
      this.parent = null;
      parking.append(this.node);
      commands.notifyCommandChanged();
      persist();
    }
    onAfterShow() { shown.emit(this.panelId); }
    onResize() { resized.emit(this.panelId); }
    onActivateRequest() {
      if (this.panelId === 'editor') activated.emit(this.panelId);
      else this.node.focus({preventScroll:true});
    }
  }
  for (const id of PANEL_IDS) panels[id] = new StudioPanel(id);
  const host = document.createElement('div');
  host.id = 'workspace';
  host.setAttribute('aria-label','Studio workspace');
  document.querySelector('header').after(host);
  document.querySelector('main').remove();
  document.getElementById('bottom').remove();
  document.getElementById('splitter').remove();
  Widget.attach(dock, host);
  const tabs = (...ids) => ({type:'tab-area', currentIndex:0, widgets:ids.map(id => panels[id])});
  function reset() {
    restoring = true;
    dock.restoreLayout({main:{type:'split-area',orientation:'vertical',sizes:[.56,.44],children:[
      {type:'split-area',orientation:'horizontal',sizes:[.16,.64,.20],children:[tabs('projects'),tabs('editor'),tabs('registers')]},
      tabs('output','pipeline','memory')
    ]}});
    restoring = false;
    dock.update();
    commands.notifyCommandChanged();
    persist();
  }
  function persist() {
    if (restoring) return;
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(encodeLayout(dock.saveLayout()))); }
    catch (_) { /* A full or disabled storage area must not stop editing. */ }
  }
  function open(id) {
    const panel = panels[id];
    if (!panel) return;
    if (panel.parent !== dock) {
      // A closed view stays alive in the parking area, including its Monaco model.
      panel.node.remove();
      const reference = panels.editor.parent === dock ? panels.editor : [...dock.widgets()][0];
      dock.addWidget(panel, reference ? {mode:'tab-after',ref:reference} : undefined);
    }
    dock.activateWidget(panel);
    commands.notifyCommandChanged();
  }
  try {
    const stored = localStorage.getItem(LAYOUT_KEY);
    if (!stored) reset();
    else {
      dock.restoreLayout(decodeLayout(JSON.parse(stored),panels));
      for (const panel of Object.values(panels)) if (!panel.parent) parking.append(panel.node);
    }
  } catch (_) { reset(); }
  restoring = false;
  dock.layoutModified.connect(() => { commands.notifyCommandChanged(); persist(); });
  const observer = new ResizeObserver(() => dock.update());
  observer.observe(host);
  const menu = new Menu({commands});
  menu.title.label = 'Views';
  for (const id of PANEL_IDS) {
    commands.addCommand(`view:${id}`, {label:definitions[id][0], isToggled:()=>panels[id].parent === dock,
      execute:()=>open(id)});
    menu.addItem({command:`view:${id}`});
  }
  commands.addCommand('view:reset',{label:'Restore default layout',execute:reset});
  menu.addItem({type:'separator'});
  menu.addItem({command:'view:reset'});
  const button = document.createElement('button');
  button.id = 'views-menu';
  button.textContent = 'Views';
  button.setAttribute('aria-haspopup','menu');
  button.setAttribute('aria-expanded','false');
  button.onclick = () => {
    const rect = button.getBoundingClientRect();
    menu.open(rect.left, rect.bottom);
    button.setAttribute('aria-expanded','true');
  };
  menu.aboutToClose.connect(() => {button.setAttribute('aria-expanded','false');button.focus();});
  document.querySelector('.project-actions').prepend(button);
  return {dock, panels, nodes, shown, resized, activated, open, reset, persist,
    isVisible:id=>panels[id].isVisible};
}
