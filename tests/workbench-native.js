// SPDX-License-Identifier: GPL-2.0-only
// Created in the personal fork on 2026-11-02: run the real docking shell in native WebKit and Chromium.
import {CommandRegistry} from '@lumino/commands';
import {createShell} from '../frontend/workbench/shell.js';
import {createSourceEditor} from '../frontend/editor/editor.js';
import {StudioSession} from '../frontend/workbench/session.js';
const commands=new CommandRegistry(),session=new StudioSession(),shell=createShell(commands);
const editor=createSourceEditor(shell.nodes.editor.querySelector('#source-editor'),{onChange(){},onSave(){}});
shell.resized.connect((_s,id)=>{if(id==='editor')editor.layout();});
shell.shown.connect((_s,id)=>{if(id==='editor')editor.layout();});
const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const check=(ok,label)=>{if(!ok)throw Error(label);window.harness.results.push(label);};
window.harness={ready:true,results:[]};
window.runEditorTests=async()=>{
 const text='# native docking\n.text\n.globl _start\n_start:\n    addi t0, zero, 1\nEnd:\n    li a0, 0\n    li a7, 93\n    ecall\n';
 editor.replaceDocument(text,'native.s');const model=editor.modelIdentity();
 shell.reset();await frame();
 shell.dock.addWidget(shell.panels.pipeline,{mode:'split-right',ref:shell.panels.editor});await frame();
 check(shell.panels.pipeline.isVisible&&shell.panels.editor.isVisible,'Lumino split panels remain visible');
 const before=editor.viewState();shell.panels.editor.close();await frame();
 check(!shell.panels.editor.parent,'close detaches the editor without disposal');
 shell.open('editor');await frame();editor.focus();
 check(editor.modelIdentity()===model&&editor.getValue()===text,'native docking preserves Monaco model and text');
 check(JSON.stringify(editor.viewState().cursorState)===JSON.stringify(before.cursorState),'native docking preserves cursor and selection');
 check(document.activeElement.closest('.monaco-editor'),'Monaco can regain native keyboard focus');
 for(const id of Object.keys(shell.panels)){shell.panels[id].close();shell.open(id);await frame();}
 check(document.querySelectorAll('.studio-panel').length===6,'all six panels reopen without duplicate instances');
 const layout=JSON.parse(localStorage.getItem('ase-studio-layout'));
 check(layout.version===1&&JSON.stringify(layout).includes('editor'),'native layout persistence uses versioned identifiers');
 document.getElementById('views-menu').click();await frame();
 check(document.querySelectorAll('.lm-Menu-item').length===8,'Views menu is accessible after docking');
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,bubbles:true}));
 shell.reset();await frame();
 check(shell.panels.editor.node.clientWidth>250,'restore layout provides a usable editor viewport');
 window.harness.done=true;return window.harness.results;
};
