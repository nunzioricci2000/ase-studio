// SPDX-License-Identifier: GPL-2.0-only
// Created in the personal fork on 2026-11-02: exercise docking through UI, persistent sessions and real simulation.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.argv[2];
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith(url+'/')?r.continue():r.abort());
 await page.goto(url+'/?workbench-test');
 await page.getByRole('button',{name:'arithmetic',exact:true}).click();
 await page.locator('.view-line').first().waitFor();
 const tab=name=>page.locator('.lm-TabBar-tab').filter({has:page.locator('.lm-TabBar-tabLabel',{hasText:new RegExp(`^${name}$`)})});
 const open=async name=>{await page.locator('#views-menu').click();await page.locator('.lm-Menu-itemLabel').getByText(name,{exact:true}).click();};
 const initial=await page.evaluate(()=>({text:studioWorkbench.editor.getValue(),model:studioWorkbench.editor.modelIdentity()}));
 await page.locator('.monaco-editor').first().click();await page.keyboard.press('Control+Home');
 await page.keyboard.insertText('#docking_');
 const selected=await page.evaluate(()=>studioWorkbench.editor.viewState());
 await tab('Editor').locator('.lm-TabBar-tabCloseIcon').click();
 await page.waitForFunction(()=>studioWorkbench.shell.panels.editor.parent===null);
 assert.equal(await page.evaluate(()=>studioWorkbench.editor.modelIdentity()),initial.model);
 await open('Editor');
 await page.waitForFunction(()=>studioWorkbench.shell.panels.editor.isVisible);
 assert.deepEqual(await page.evaluate(()=>studioWorkbench.editor.viewState().cursorState),selected.cursorState);
 await page.evaluate(()=>studioWorkbench.editor.focus());await page.keyboard.press('Control+z');
 assert.equal(await page.evaluate(()=>studioWorkbench.editor.getValue()),initial.text);
 await page.keyboard.press('Control+Shift+z');
 assert.ok((await page.evaluate(()=>studioWorkbench.editor.getValue())).startsWith('#docking_'));
 console.log('PASS close/reopen preserves document, cursor, selection and undo/redo');
 let saves=0;page.on('request',r=>{if(r.url().endsWith('/api/save'))saves++;});
 const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));
 await page.keyboard.press('Control+s');await response;
 await page.waitForFunction(()=>!window.aseHasUnsavedChanges());
 await page.waitForTimeout(600);assert.equal(saves,1);
 await page.keyboard.press('Control+f');await page.locator('.find-widget.visible').waitFor();await page.keyboard.press('Escape');
 console.log('PASS one save per Monaco shortcut and native Find');
 await page.locator('#views-menu').click();await page.locator('.lm-Menu-itemLabel').getByText('Restore default layout',{exact:true}).click();
 await open('Pipeline');
 // Actual mouse drag from the bottom tab into the editor's right docking zone.
 const from=await tab('Pipeline').boundingBox(),to=await page.locator('#panel-editor').boundingBox();
 await page.mouse.move(from.x+35,from.y+14);await page.mouse.down();
 await page.mouse.move(from.x+45,from.y-30,{steps:5});
 await page.mouse.move(to.x+to.width-30,to.y+to.height/2,{steps:20});await page.mouse.up();
 await page.waitForTimeout(200);
 assert.equal(await page.evaluate(()=>studioWorkbench.shell.panels.pipeline.isVisible&&studioWorkbench.shell.panels.editor.isVisible),true);
 assert.equal(await page.evaluate(()=>document.querySelectorAll('#source-editor').length),1);
 const beforeReload=await page.evaluate(()=>JSON.parse(localStorage.getItem('ase-studio-layout')));
 await page.reload();await page.waitForFunction(()=>window.studioWorkbench);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('ase-studio-layout'))),beforeReload);
 console.log('PASS mouse docking, independent views and layout persistence');
 await page.getByRole('button',{name:'arithmetic',exact:true}).click();
 // Reset before real simulation so the initial view has predictable space.
 await page.evaluate(()=>studioWorkbench.shell.reset());
 const runResponse=page.waitForResponse(r=>r.url().endsWith('/api/run'));
 await page.locator('#run').click();assert.equal((await(await runResponse).json()).ok,true);
 await page.waitForFunction(()=>studioWorkbench.session.state.pipelineData!==null);
 await open('Pipeline');
 await page.locator('#pipeline-grid .cell[data-col="2"]').first().click({button:'right'});
 await page.waitForFunction(()=>studioWorkbench.session.state.playbackCycle===2 && studioWorkbench.session.state.selectedColumn===2);
 console.log('PASS pipeline cell selection updates the shared playback cycle');
 await open('Memory');
 const pop=page.waitForEvent('popup');await page.locator('#memory-popout').click();const popup=await pop;await popup.waitForLoadState();
 popup.on('pageerror',e=>errors.push(e.message));
 await tab('Memory').locator('.lm-TabBar-tabCloseIcon').click();
 await page.evaluate(()=>studioWorkbench.session.update({stepMode:true,playbackCycle:1,selectedColumn:1}));
 // With no watches the summary still proves that the detached view updated.
 await popup.waitForFunction(()=>document.querySelector('#memory-summary')?.textContent.includes('cycle 1'));
 await page.evaluate(()=>{const s=studioWorkbench.session;s.update({playbackCycle:s.state.pipelineData.cycles,selectedColumn:s.state.pipelineData.cycles});});
 const cycle=await page.evaluate(()=>studioWorkbench.session.state.playbackCycle);
 await popup.waitForFunction(c=>document.querySelector('#memory-summary')?.textContent.includes('cycle '+c),cycle);
 await open('Memory');
 assert.ok((await page.locator('#memory-summary').textContent()).includes('cycle '+cycle));
 assert.equal(await page.locator('[data-register-change=x7] code').innerText(),'0x00000046');
 await popup.close();
 console.log('PASS hidden memory, separate window and registers share the selected cycle');
 for(const name of ['Projects','Editor','Registers','Log Output','Pipeline','Memory']){
  await open(name);await tab(name).locator('.lm-TabBar-tabCloseIcon').click();await open(name);
 }
 assert.equal(await page.locator('.studio-panel').count(),6);
 console.log('PASS all six single-instance panels close and reopen');
 await page.evaluate(()=>{localStorage.setItem('ase-studio-layout','{"version":1,"main":{"type":"tab-area","widgets":["unknown"],"currentIndex":0}}');localStorage.setItem('ase-studio-draft:untouched', 'sentinel');});
 await page.reload();await page.waitForFunction(()=>window.studioWorkbench);
 assert.equal(await page.evaluate(()=>localStorage.getItem('ase-studio-draft:untouched')),'sentinel');
 assert.equal(await page.evaluate(()=>[...studioWorkbench.shell.dock.widgets()].length),6);
 await page.evaluate(()=>localStorage.removeItem('ase-studio-draft:untouched'));
 assert.deepEqual(errors,[]);
 console.log('PASS invalid layout restores defaults without deleting drafts; no JavaScript errors');
} finally {await browser.close();}
