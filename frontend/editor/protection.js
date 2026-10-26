// SPDX-FileCopyrightText: 2026 Behnam Farnaghinejad <behnam.farnaghinejad@polito.it>
// SPDX-License-Identifier: GPL-2.0-only
export function computeProtectedLines(text) {
  const lines = text.split("\n");
  const locked = new Set();
  const code = lines.map(line => line.split("#", 1)[0].trim());
  const scaffoldComments = new Set([
    "# The text section contains the instructions that the CPU runs.",
    "# Make _start visible as the point where the program begins.",
    "# The End block stops the program and returns control to the simulator."
  ]);
  code.forEach((line, index) => {
    if (/^(?:\.section\s+\.text(?:\b|,)|\.text(?:\b|,))/.test(line)
        || /^\.glob(?:l|al)\s+_start\b/.test(line)
        || /^_start:\s*$/.test(line)
        || scaffoldComments.has(lines[index].trim())) locked.add(index);
  });
  const significant = code.map((line, index) => ({line, index})).filter(item => item.line);
  for (let position = significant.length - 1; position >= 2; position--) {
    if (significant[position].line !== "ecall") continue;
    const a7 = significant[position - 1].line;
    const a0 = significant[position - 2].line;
    if (/^li\s+(?:a7|x17)\s*,\s*93$/.test(a7) && /^li\s+(?:a0|x10)\s*,\s*0$/.test(a0)) {
      locked.add(significant[position].index);
      locked.add(significant[position - 1].index);
      locked.add(significant[position - 2].index);
      const preceding = significant[position - 3];
      if (preceding && /^End:\s*$/i.test(preceding.line)) locked.add(preceding.index);
      break;
    }
  }
  return locked;
}

export function protectedRanges(text) {
  const ranges = [];
  const locked = computeProtectedLines(text);
  let offset = 0;
  text.split("\n").forEach((line, index) => {
    const end = offset + line.length;
    if (locked.has(index)) ranges.push({start: offset, end: end + 1});
    offset = end + 1;
  });
  return ranges;
}


// Offsets refer to the pre-edit document. Test every operation before applying
// any of them, so a multi-cursor edit or replace-all is accepted atomically.
export function touchesProtected(text, edits) {
  return protectedRanges(text).some(range => edits.some(edit => {
    const end = edit.offset + edit.length;
    return edit.offset < range.end && end >= range.start;
  }));
}
