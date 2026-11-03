// SPDX-License-Identifier: GPL-2.0-only
// Created in the personal fork on 2026-11-02: keep project state independent of panel lifetime.
import {Signal} from '@lumino/signaling';

/** One project session. Text and undo history belong exclusively to Monaco.
 * Updates are coalesced at the microtask boundary so views see complete actions.
 * @typedef {{current: object|null, pipelineData: object|null, playbackCycle: number|null,
 * selectedRow: number|null, selectedColumn: number|null, selectedSourceLine: number|null,
 * stepMode: boolean, lastNormalLog: string, lastAdvancedLog: string, savedSource: string,
 * sourceDirty: boolean, memoryWatches: object[], diagnostics: object[], operation: string|null}} SessionState
 */
export class StudioSession {
  constructor() {
    /** @type {SessionState} */
    this.state = Object.freeze({current:null, pipelineData:null, playbackCycle:null,
      selectedRow:null, selectedColumn:null, selectedSourceLine:null, stepMode:false,
      lastNormalLog:'', lastAdvancedLog:'', savedSource:'', sourceDirty:false,
      memoryWatches:[], diagnostics:[], operation:null});
    this.changed = new Signal(this);
    this.pending = new Set();
  }
  /** Apply an explicit operation's state patch. Never store DOM nodes here.
   * @param {Partial<SessionState>} patch */
  update(patch) {
    const keys = Object.keys(patch).filter(key => this.state[key] !== patch[key]);
    if (!keys.length) return;
    const scheduled = this.pending.size > 0;
    this.state = Object.freeze({...this.state, ...patch});
    keys.forEach(key => this.pending.add(key));
    if (!scheduled) queueMicrotask(() => {
      const changed = [...this.pending];
      this.pending.clear();
      this.changed.emit(changed);
    });
  }
}
