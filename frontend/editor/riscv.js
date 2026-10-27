import {RISCV_OPCODE_CATALOG} from '../riscv-opcodes.js';
// SPDX-License-Identifier: GPL-2.0-only
// Instruction help is descriptive, not a guarantee of support by an ASE CPU.
export const instructions = [];
function add(names, operands, description, extension = 'I') {
  for (const mnemonic of names.split(' ')) instructions.push({mnemonic, operands, description, extension});
}
for (const [op, description] of Object.entries({
  add: 'Add', sub: 'Subtract', sll: 'Shift left logically', slt: 'Compare less than (signed)',
  sltu: 'Compare less than (unsigned)', xor: 'Bitwise exclusive OR', srl: 'Shift right logically',
  sra: 'Shift right arithmetically', or: 'Bitwise OR', and: 'Bitwise AND',
})) add(op, 'rd, rs1, rs2', `${description} using source registers; write the result to rd.`);
for (const [op, description] of Object.entries({addi:'Add', slli:'Shift left logically', slti:'Compare less than (signed)', sltiu:'Compare less than (unsigned)', xori:'Bitwise exclusive OR', srli:'Shift right logically', srai:'Shift right arithmetically', ori:'Bitwise OR', andi:'Bitwise AND'}))
  add(op, 'rd, rs1, imm', `${description} using rs1 and an immediate; write the result to rd.`);
add('lui', 'rd, imm', 'Load the upper immediate into rd.');
add('auipc', 'rd, imm', 'Add the upper immediate to the current instruction address.');
for (const [op, kind] of Object.entries({lb:'signed byte', lbu:'unsigned byte', lh:'signed halfword', lhu:'unsigned halfword', lw:'signed word', lwu:'unsigned word', ld:'doubleword'}))
  add(op, 'rd, offset(rs1)', `Load a ${kind} from memory into rd.`, ['lwu','ld'].includes(op) ? 'RV64I' : 'I');
for (const [op, kind] of Object.entries({sb:'byte', sh:'halfword', sw:'word', sd:'doubleword'}))
  add(op, 'rs2, offset(rs1)', `Store the low ${kind} of rs2 to memory.`, op === 'sd' ? 'RV64I' : 'I');
for (const [op, condition] of Object.entries({beq:'equal', bne:'not equal', blt:'less than (signed)', bge:'greater than or equal (signed)', bltu:'less than (unsigned)', bgeu:'greater than or equal (unsigned)'}))
  add(op, 'rs1, rs2, label', `Branch to label if rs1 is ${condition} compared with rs2.`);
add('jal', 'rd, label', 'Jump to label and save the return address in rd.');
add('jalr', 'rd, offset(rs1)', 'Jump to rs1 + offset (clearing bit zero) and save the return address in rd.');
for (const [op, description] of Object.entries({mul:'Low half of integer product',mulh:'High half of signed product',mulhsu:'High half of signed × unsigned product',mulhu:'High half of unsigned product',div:'Signed quotient (truncated toward zero)',divu:'Unsigned quotient',rem:'Signed remainder',remu:'Unsigned remainder'}))
  add(op, 'rd, rs1, rs2', `${description}; write the result to rd.`, 'M');
add('fence', 'pred, succ', 'Order memory operations selected by predecessor and successor sets.');
add('fence.i', '', 'Synchronize instruction fetch with previous writes to instruction memory.', 'Zifencei');
add('ecall', '', 'Request a service from the execution environment.');
add('ebreak', '', 'Raise a breakpoint exception.');
add('wfi', '', 'Wait for an interrupt; availability depends on execution privilege.', 'Privileged');
add('mret', '', 'Return from a machine-mode trap.', 'Privileged');
for (const [op, desc] of Object.entries({csrrw:'Read and replace',csrrs:'Read and set bits in',csrrc:'Read and clear bits in'})) {
  add(op, 'rd, csr, rs1', `${desc} a control/status register.`, 'Zicsr');
  add(op+'i', 'rd, csr, uimm', `${desc} a control/status register using a five-bit immediate.`, 'Zicsr');
}
for (const [op, operands, desc] of [
 ['j','label','Jump unconditionally.'],['jr','rs1','Jump to the address in rs1.'],['ret','','Return to the address in ra.'],
 ['call','label','Call a procedure, saving the return address in ra.'],['tail','label','Tail-call a procedure without changing the return address.'],
 ['li','rd, imm','Load an immediate constant.'],['la','rd, label','Load the address of a symbol.'],['mv','rd, rs','Copy a register.'],
 ['neg','rd, rs','Negate a signed value.'],['not','rd, rs','Invert every bit.'],['seqz','rd, rs','Set rd to one if rs is zero; otherwise zero.'],
 ['snez','rd, rs','Set rd to one if rs is nonzero; otherwise zero.'],['sltz','rd, rs','Set rd to one if rs is negative; otherwise zero.'],['sgtz','rd, rs','Set rd to one if rs is positive; otherwise zero.'],
 ['beqz','rs, label','Branch if rs is zero.'],['bnez','rs, label','Branch if rs is nonzero.'],['nop','','Perform no operation.'],
 ['csrr','rd, csr','Read a control/status register.'],['csrw','csr, rs','Write a control/status register.'],['csrs','csr, rs','Set bits in a control/status register.'],['csrc','csr, rs','Clear bits in a control/status register.'],
 ['csrwi','csr, uimm','Write an immediate to a control/status register.'],['csrsi','csr, uimm','Set bits using an immediate.'],['csrci','csr, uimm','Clear bits using an immediate.'],
 ['rdcycle','rd','Read the cycle counter (Zicntr).'],['rdtime','rd','Read the time counter (Zicntr).'],['rdinstret','rd','Read the retired-instruction counter (Zicntr).'],
]) add(op, operands, desc, 'Pseudoinstruction');
for (const [suffix, ext, size] of [['s','F','single'],['d','D','double']]) {
  add(suffix === 's' ? 'flw' : 'fld', 'fd, offset(rs1)', `Load a ${size}-precision floating-point value.`, ext);
  add(suffix === 's' ? 'fsw' : 'fsd', 'fs2, offset(rs1)', `Store a ${size}-precision floating-point value.`, ext);
  for (const [op, desc] of Object.entries({add:'Add',sub:'Subtract',mul:'Multiply',div:'Divide',min:'Select the minimum of',max:'Select the maximum of'}))
    add(`f${op}.${suffix}`, 'fd, fs1, fs2', `${desc} ${size}-precision operands. Arithmetic operations may accept a rounding-mode operand.`, ext);
  add(`fsqrt.${suffix}`, 'fd, fs1', `Compute the ${size}-precision square root; optional rounding mode.`, ext);
  for (const [op, formula] of Object.entries({madd:'(fs1 × fs2) + fs3',msub:'(fs1 × fs2) − fs3',nmsub:'−(fs1 × fs2) + fs3',nmadd:'−(fs1 × fs2) − fs3'}))
    add(`f${op}.${suffix}`, 'fd, fs1, fs2, fs3', `Compute ${formula} with one rounding step; optional rounding mode.`, ext);
  for (const [op, desc] of Object.entries({sgnj:'Copy the sign of fs2',sgnjn:'Copy the inverted sign of fs2',sgnjx:'Use the XOR of the source signs'}))
    add(`f${op}.${suffix}`, 'fd, fs1, fs2', `${desc} with the magnitude of fs1.`, ext);
  for (const [op, desc] of Object.entries({eq:'equal to',lt:'less than',le:'less than or equal to'}))
    add(`f${op}.${suffix}`, 'rd, fs1, fs2', `Set integer rd to one if fs1 is ${desc} fs2; otherwise zero.`, ext);
  add(`fclass.${suffix}`, 'rd, fs1', 'Write a bit mask describing the floating-point classification to integer rd.', ext);
  for (const integer of ['w','wu','l','lu']) {
    const kind = `${integer.endsWith('u') ? 'unsigned' : 'signed'} ${integer.startsWith('l') ? '64' : '32'}-bit integer`;
    const requirement = `${integer.startsWith('l') ? 'RV64 + ' : ''}${ext}`;
    add(`fcvt.${integer}.${suffix}`, 'rd, fs1', `Convert ${size}-precision to a ${kind}; optional rounding mode.`, requirement);
    add(`fcvt.${suffix}.${integer}`, 'fd, rs1', `Convert a ${kind} to ${size}-precision; optional rounding mode.`, requirement);
  }
}
add('fcvt.s.d', 'fd, fs1', 'Convert double precision to single precision; optional rounding mode.', 'D');
add('fcvt.d.s', 'fd, fs1', 'Convert single precision to double precision.', 'D');
add('fmv.x.w', 'rd, fs1', 'Copy single-precision bits into an integer register (sign-extend on RV64).', 'F');
add('fmv.w.x', 'fd, rs1', 'Copy the low 32 integer bits into a floating-point register.', 'F');
add('lr.w', 'rd, (rs1)', 'Load a word and establish a reservation.', 'A');
add('sc.w', 'rd, rs2, (rs1)', 'Conditionally store a word; rd is zero on success and nonzero on failure.', 'A');
for (const [op, desc] of Object.entries({swap:'exchange',add:'add',xor:'XOR',and:'AND',or:'OR',min:'signed minimum',max:'signed maximum',minu:'unsigned minimum',maxu:'unsigned maximum'}))
  add(`amo${op}.w`, 'rd, rs2, (rs1)', `Atomic word ${desc}; return the original memory value in rd. Optional .aq/.rl ordering suffixes.`, 'A');
for (const [op, operands, desc] of [
 ['nop','','No operation.'],['addi','rd, imm','Add an immediate to rd.'],['li','rd, imm','Load an immediate.'],['lui','rd, imm','Load an upper immediate.'],
 ['mv','rd, rs2','Copy rs2 to rd.'],['add','rd, rs2','Add rs2 to rd.'],['sub','rd, rs2','Subtract rs2 from rd.'],['xor','rd, rs2','XOR rs2 with rd.'],['or','rd, rs2','OR rs2 with rd.'],['and','rd, rs2','AND rs2 with rd.'],
 ['andi','rd, imm','AND an immediate with rd.'],['slli','rd, shamt','Shift left logically.'],['srli','rd, shamt','Shift right logically.'],['srai','rd, shamt','Shift right arithmetically.'],
 ['j','label','Jump unconditionally.'],['jr','rs1','Jump to rs1.'],['jalr','rs1','Jump to rs1 and save the return address.'],['beqz','rs1, label','Branch if zero.'],['bnez','rs1, label','Branch if nonzero.'],
 ['lw','rd, offset(rs1)','Load a word.'],['sw','rs2, offset(rs1)','Store a word.'],['lwsp','rd, offset(sp)','Load a word relative to sp.'],['swsp','rs2, offset(sp)','Store a word relative to sp.'],
 ['addi4spn','rd, imm','Add a nonzero unsigned immediate to sp.'],['addi16sp','sp, imm','Add a nonzero immediate to sp.'],['ebreak','','Raise a breakpoint exception.'],
]) add(`c.${op}`, operands, `${desc} Compressed encoding has register/immediate restrictions.`, 'C');

const integerAliases = ['zero','ra','sp','gp','tp','t0','t1','t2','s0','s1',...Array.from({length:8},(_,i)=>`a${i}`),...Array.from({length:10},(_,i)=>`s${i+2}`),'t3','t4','t5','t6'];
const floatAliases = [...Array.from({length:8},(_,i)=>`ft${i}`),'fs0','fs1',...Array.from({length:8},(_,i)=>`fa${i}`),...Array.from({length:10},(_,i)=>`fs${i+2}`),'ft8','ft9','ft10','ft11'];
export const registers = [...integerAliases.flatMap((alias,i)=>[{name:`x${i}`,detail:alias},{name:alias,detail:`x${i}`}]),{name:'fp',detail:'x8 / s0'},...floatAliases.flatMap((alias,i)=>[{name:`f${i}`,detail:alias},{name:alias,detail:`f${i}`}])];

// Scan before the cursor so '#' inside a quoted string is not a comment.
export function completionContext(prefix) {
  let quote = null, escaped = false;
  for (const ch of prefix) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && quote) { escaped = true; continue; }
    if (quote) { if (ch === quote) quote = null; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return null;
  }
  if (quote) return null;
  const code = prefix.replace(/^\s*[\w.$]+:\s*/, '').trimStart();
  if (code.startsWith('.')) return null;
  return /^\S*$/u.test(code) ? 'instruction' : 'register';
}
const upstreamInstructions = new Map(RISCV_OPCODE_CATALOG.map(item=>[item.mnemonic,item]));
for (const item of RISCV_OPCODE_CATALOG) {
  if (!instructions.some(existing=>existing.mnemonic===item.mnemonic)) {
    instructions.push({mnemonic:item.mnemonic, operands:item.syntax, description:item.description, extension:item.extension});
  }
}

export function instructionSnippet(mnemonic) {
  const item = upstreamInstructions.get(mnemonic);
  if (!item) return mnemonic;
  return item.template.replace(/\{(\d+)\}/g, (_, index)=>
    '${' + (Number(index)+1) + ':' + item.operands[Number(index)].placeholder + '}');
}

export function instructionEnabled(instruction, extensions) {
  if (!extensions) return true;
  if (instruction.extension.toLowerCase() === 'pseudo') return true;
  return instruction.extension.toLowerCase().split(/\s*\+\s*/).every(extension=>extensions.includes(extension));
}

export function registerRiscv(monaco) {
  const catalog = new Map(instructions.map(item => [item.mnemonic, item]));
  monaco.languages.register({id:'riscv', extensions:['.s','.S','.asm']});
  monaco.languages.setLanguageConfiguration('riscv', {
    comments:{lineComment:'#'}, brackets:[['(',')'],['[',']']],
    autoClosingPairs:[{open:'(',close:')'},{open:'[',close:']'},{open:'"',close:'"',notIn:['string','comment']}],
    wordPattern:/[A-Za-z_.$][\w.$]*/g,
  });
  monaco.languages.setMonarchTokensProvider('riscv', {
    ignoreCase:true, keywords:[...catalog.keys()], registers:registers.map(r=>r.name),
    tokenizer:{root:[
      [/#.*$/, 'comment'], [/"([^"\\]|\\.)*"/, 'string'], [/'([^'\\]|\\.)*'/, 'string'],
      [/[\w.$]+:/, 'type.identifier'], [/\.[A-Za-z][\w.]*/, 'keyword.directive'],
      [/\b(?:0x[\da-f]+|0b[01]+|\d+)\b/, 'number'],
      [/c[._][a-z][\w.]*/, 'keyword'],
      [/[A-Za-z_][\w.]*/, {cases:{'@keywords':'keyword','@registers':'variable.predefined','@default':'identifier'}}],
      [/[()[\]]/, '@brackets'],
    ]},
  });
  monaco.languages.registerCompletionItemProvider('riscv', {
    provideCompletionItems(model,position) {
      const context = completionContext(model.getLineContent(position.lineNumber).slice(0,position.column-1));
      if (!context) return {suggestions:[]};
      const word = model.getWordUntilPosition(position);
      const range = {startLineNumber:position.lineNumber,endLineNumber:position.lineNumber,startColumn:word.startColumn,endColumn:word.endColumn};
      return {suggestions:context === 'instruction' ? instructions.filter(i=>instructionEnabled(i,model.aseIsaExtensions)).map(i=>({label:i.mnemonic,kind:monaco.languages.CompletionItemKind.Function,insertText:model.getLineContent(position.lineNumber).slice(word.endColumn-1).trim() ? i.mnemonic : instructionSnippet(i.mnemonic),insertTextRules:monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,detail:`${i.operands} · ${i.extension}`,documentation:i.description,range})) : registers.map(r=>({label:r.name,kind:monaco.languages.CompletionItemKind.Variable,insertText:r.name,detail:r.detail,range}))};
    },
  });
  monaco.languages.registerHoverProvider('riscv', {
    provideHover(model,position) {
      const word = model.getWordAtPosition(position);
      if (!word || completionContext(model.getLineContent(position.lineNumber).slice(0,word.startColumn-1)) !== 'instruction') return null;
      const item = catalog.get(word.word.toLowerCase());
      if (!item) return null;
      return {range:new monaco.Range(position.lineNumber,word.startColumn,position.lineNumber,word.endColumn),contents:[
        {value:`\`\`\`riscv\n${item.mnemonic} ${item.operands}\n\`\`\``},
        {value:`${item.description}\n\n**${item.extension}** — availability depends on the configured ISA and execution environment.`},
      ]};
    },
  });
}
