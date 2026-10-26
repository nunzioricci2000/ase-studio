import test from 'node:test';
import assert from 'node:assert/strict';
import {computeProtectedLines, touchesProtected} from '../frontend/editor/protection.js';
import {instructions, registers, completionContext} from '../frontend/editor/riscv.js';
const source = '.text\n.globl _start\n_start:\n    addi t0, zero, 1\n\nEnd:\n    li a0, 0\n    li a7, 93\n    ecall\n';
test('protect the existing entry and final exit scaffold', () => {
  assert.deepEqual([...computeProtectedLines(source)].sort((a,b)=>a-b), [0,1,2,5,6,7,8]);
});
test('accept edits in the body and reject locked text, newline merges, and mixed transactions', () => {
  const body = source.indexOf('addi');
  assert.equal(touchesProtected(source, [{offset:body,length:4}]), false);
  assert.equal(touchesProtected(source, [{offset:0,length:0}]), true);
  assert.equal(touchesProtected(source, [{offset:source.indexOf('End:')-1,length:1}]), true);
  assert.equal(touchesProtected(source, [{offset:body,length:4},{offset:source.indexOf('ecall'),length:5}]), true);
  assert.equal(touchesProtected(source, [{offset:0,length:source.length}]), true);
  assert.equal(touchesProtected(source, [{offset:source.indexOf('\n\n')+1,length:0}]), false);
});
test('protect exit aliases and scaffold without trailing newline', () => {
  const text = '.section .text\n.global _start\n_start:\naddi t0,t0,1\nEnd:\nli x10,0\nli x17,93\necall';
  assert.equal(computeProtectedLines(text).size, 7);
  assert.equal(touchesProtected(text,[{offset:text.length,length:0}]),true);
});
test('recognize instruction and operand contexts, comments, and escaped strings', () => {
  for (const prefix of ['', '  ad', 'Loop: ', 'Loop: fadd.']) assert.equal(completionContext(prefix),'instruction');
  for (const prefix of ['  add ', 'Loop: add t0, ']) assert.equal(completionContext(prefix),'register');
  for (const prefix of ['# add', 'add t0 # comment', '.string "text', '"escaped \\" quote', '.word ']) assert.equal(completionContext(prefix),null);
});
test('catalog has unique documented instructions and all register aliases', () => {
  assert.equal(new Set(instructions.map(i=>i.mnemonic)).size, instructions.length);
  for (const name of ['addi','fadd.s','fcvt.w.d','c.addi','amoadd.w','ret']) assert.ok(instructions.find(i=>i.mnemonic===name));
  for (const item of instructions) assert.ok(item.description && item.extension);
  for (const name of ['x31','f31','fp','t6','ft11','s11','fs11','a7','fa7']) assert.ok(registers.find(r=>r.name===name));
});
