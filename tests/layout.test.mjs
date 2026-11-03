// SPDX-License-Identifier: GPL-2.0-only
// Created in the personal fork on 2026-11-02: cover persisted layout corruption and closed views.
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeLayout,decodeLayout,PANEL_IDS} from '../frontend/workbench/layout.js';
const widgets=Object.fromEntries(PANEL_IDS.map(id=>[id,{id:`panel-${id}`,panelId:id}]));
const tab={type:'tab-area',currentIndex:0,widgets:[widgets.editor,widgets.pipeline]};
test('layout round trip restores object identity, order and intentionally closed views',()=>{
 const layout={main:{type:'split-area',orientation:'horizontal',sizes:[.7,.3],children:[tab,{type:'tab-area',currentIndex:0,widgets:[widgets.memory]}]}};
 const saved=JSON.parse(JSON.stringify(encodeLayout(layout)));
 const restored=decodeLayout(saved,widgets);
 assert.deepEqual(restored,layout);
 assert.equal(restored.main.children[0].widgets[0],widgets.editor);
 assert.deepEqual(decodeLayout(encodeLayout({main:null}),widgets),{main:null});
});
test('reject unknown versions, panels, duplicate identities and invalid dimensions',()=>{
 const valid=encodeLayout({main:tab});
 for(const saved of [null,{}, {...valid,version:999}, {...valid,main:{...valid.main,widgets:['unknown']}},
   {...valid,main:{...valid.main,widgets:['editor','editor']}}, {...valid,main:{...valid.main,currentIndex:4}},
   {...valid,main:{type:'split-area',orientation:'horizontal',children:[valid.main,valid.main],sizes:[NaN,1]}},
   {...valid,main:{type:'split-area',orientation:'vertical',children:[valid.main],sizes:[1]}}]) assert.throws(()=>decodeLayout(saved,widgets));
});
