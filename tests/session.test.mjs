// SPDX-License-Identifier: GPL-2.0-only
// Created in the personal fork on 2026-11-02: observe complete session operations across hidden views.
import test from 'node:test';
import assert from 'node:assert/strict';
import {StudioSession} from '../frontend/workbench/session.js';
test('views observe a complete coalesced operation, preserving the trace identity',async()=>{
 const session=new StudioSession(),events=[],trace={cycles:3};
 session.changed.connect((sender,keys)=>events.push({keys,state:sender.state}));
 session.update({pipelineData:trace});session.update({playbackCycle:2});session.update({selectedColumn:2});
 assert.equal(events.length,0);await Promise.resolve();
 assert.equal(events.length,1);assert.equal(events[0].state.pipelineData,trace);
 assert.equal(events[0].state.playbackCycle,2);assert.equal(events[0].state.selectedColumn,2);
 session.update({playbackCycle:2});await Promise.resolve();assert.equal(events.length,1);
 assert.throws(()=>{session.state.playbackCycle=9;});
});
