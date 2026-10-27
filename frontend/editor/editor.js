// SPDX-License-Identifier: GPL-2.0-only
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/browser/coreCommands.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/editor/contrib/snippet/browser/snippetController2.js';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor.js';
import 'monaco-editor/editor/contrib/indentation/browser/indentation.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/readOnlyMessage/browser/contribution.js';
import 'monaco-editor/editor/contrib/tokenization/browser/tokenization.js';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js';
import 'monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js';
import {computeProtectedLines, touchesProtected} from './protection.js';
import {registerRiscv} from './riscv.js';
import {registerStudioThemes} from './theme.js';

self.MonacoEnvironment = {
  getWorker() { return new Worker(new URL('./editor.worker.js', import.meta.url), {type:'module'}); },
};
registerRiscv(monaco);
registerStudioThemes(monaco);

export function createSourceEditor(container, {onChange, onSave}) {
  const editor = monaco.editor.create(container, {
    theme:document.documentElement.dataset.theme === 'dark' ? 'ase-dark' : 'ase-light',
    model:null, automaticLayout:true, minimap:{enabled:false}, wordWrap:'off',
    fontFamily:'"DejaVu Sans Mono", monospace', fontSize:14, lineHeight:23,
    tabSize:4, insertSpaces:true, detectIndentation:false, scrollBeyondLastLine:false,
    readOnly:true, ariaLabel:'RISC-V assembly source', glyphMargin:true,
    renderWhitespace:'selection', padding:{top:10}, fixedOverflowWidgets:true,
    quickSuggestions:{other:true,comments:false,strings:false}, wordBasedSuggestions:'off',
    unicodeHighlight:{ambiguousCharacters:false},
  });
  const protectedDecoration = editor.createDecorationsCollection();
  const pipelineDecoration = editor.createDecorationsCollection();
  const status = document.querySelector('#editor-status');
  let model = null;
  let listener = null;
  let selectedLine = null;
  let serial = 0;
  let protectionEnabled = true;
  let statusTimer;
  function reject() {
    status.textContent = 'Entry and exit instructions are protected. No changes were applied.';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = ''; }, 5000);
  }
  function decorate() {
    protectedDecoration.set(model && protectionEnabled ? [...computeProtectedLines(model.getValue())].map(line=>({
      range:new monaco.Range(line+1,1,line+1,1),
      options:{isWholeLine:true,className:'ase-protected-line',glyphMarginClassName:'ase-protected-glyph',glyphMarginHoverMessage:{value:'Protected entry/exit instruction'},stickiness:monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges},
    })) : []);
    pipelineDecoration.set(model && selectedLine && selectedLine <= model.getLineCount() ? [{
      range:new monaco.Range(selectedLine,1,selectedLine,1),
      options:{isWholeLine:true,className:'ase-pipeline-line',linesDecorationsClassName:'ase-pipeline-glyph'},
    }] : []);
  }
  function guardEdits(target) {
    // Monaco has no cancellable before-change event. Guard its public model edit
    // entry points before either the document or native undo stack is changed.
    // Keep this covered by browser tests when upgrading the pinned Monaco version.
    const allowed = edits => !protectionEnabled || !touchesProtected(target.getValue(), edits.map(edit=>{
      const range = target.validateRange(edit.range);
      const offset = target.getOffsetAt(range.getStartPosition());
      return {offset,length:target.getOffsetAt(range.getEndPosition())-offset};
    }));
    const push = target.pushEditOperations.bind(target);
    target.pushEditOperations = (selections, edits, cursorStateComputer, ...rest) => {
      if (!allowed(edits)) { reject(); return selections; }
      return push(selections, edits, cursorStateComputer, ...rest);
    };
    const apply = target.applyEdits.bind(target);
    target.applyEdits = (edits, computeUndoEdits, ...rest) => {
      if (!allowed(edits)) { reject(); return computeUndoEdits ? [] : undefined; }
      return apply(edits, computeUndoEdits, ...rest);
    };
    // Undo/redo only contain accepted transactions; they must be allowed to
    // restore prior valid documents, including undoing a newly typed directive.
  }
  const adapter = {
    getValue:()=>model?.getValue() || '',
    replaceDocument(text, name, {preserveView=false}={}) {
      const view = preserveView ? editor.saveViewState() : null;
      listener?.dispose();
      const previous = model;
      model = name == null ? null : monaco.editor.createModel(text,'riscv',monaco.Uri.from({scheme:'ase',path:`/${++serial}/${name}`}));
      if (model) {
        model.updateOptions({tabSize:4,insertSpaces:true});
        guardEdits(model);
      }
      editor.setModel(model);
      previous?.dispose();
      selectedLine = null;
      status.textContent = '';
      editor.updateOptions({readOnly:!model});
      if (view) editor.restoreViewState(view);
      if (model) listener = model.onDidChangeContent(()=>{ decorate(); onChange(); });
      decorate();
    },
    highlightLine(line, reveal=false) {
      selectedLine = line;
      decorate();
      if (reveal && model && line > 0 && line <= model.getLineCount()) editor.revealLineInCenterIfOutsideViewport(line);
    },
    setIsa(isa) { if (model) model.aseIsaExtensions = isa?.extensions?.map(value=>value.toLowerCase()); },
    setProtectionEnabled(enabled) { protectionEnabled = enabled; decorate(); },
    goToPosition(line, column=1) {
      if (!model) return;
      const position = model.validatePosition({lineNumber:Number(line) || 1, column:Number(column) || 1});
      editor.setPosition(position);
      editor.revealPositionInCenter(position);
      editor.focus();
    },
    setFontSize(size) { editor.updateOptions({fontSize:size,lineHeight:Math.round(size*1.65)}); },
    setTheme(dark) { monaco.editor.setTheme(dark ? 'ase-dark' : 'ase-light'); },
    find() { editor.focus(); editor.getAction('actions.find').run(); },
    dispose() { clearTimeout(statusTimer); listener?.dispose(); editor.dispose(); model?.dispose(); },
  };
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, ()=>onSave());
  return adapter;
}
