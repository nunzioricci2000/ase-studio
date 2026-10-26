// SPDX-License-Identifier: GPL-2.0-only
// Match studio.css: editor surfaces follow the app panels, and assembly tokens
// use the same palette as instructions in the pipeline table.
export function registerStudioThemes(monaco) {
  for (const dark of [false, true]) {
    const p = dark ? {
      background:'#111827', foreground:'#e5edf7', muted:'#9baabd', border:'#344256',
      surface:'#182233', input:'#1f2937', accent:'#60a5fa', selection:'#17365f',
      comment:'#91a0b4', directive:'#d8b4fe', register:'#fdba74', opcode:'#93c5fd',
      label:'#f9a8d4', string:'#86efac', match:'#854d0e', guide:'#344256',
    } : {
      background:'#ffffff', foreground:'#172235', muted:'#64748b', border:'#d9e1ec',
      surface:'#f6f8fb', input:'#ffffff', accent:'#1565c0', selection:'#e8f1ff',
      comment:'#64748b', directive:'#8b3bb3', register:'#b54b00', opcode:'#0759b3',
      label:'#a13a58', string:'#15803d', match:'#fde047', guide:'#d9e1ec',
    };
    const token = (name, color, fontStyle='') => ({token:name, foreground:color.slice(1), fontStyle});
    monaco.editor.defineTheme(dark ? 'ase-dark' : 'ase-light', {
      base:dark ? 'vs-dark' : 'vs', inherit:true,
      rules:[
        token('', p.foreground), token('comment', p.comment),
        token('keyword', p.opcode, 'bold'), token('keyword.directive', p.directive),
        token('variable.predefined', p.register), token('type.identifier', p.label),
        token('number', p.register), token('string', p.string),
        token('delimiter', p.muted),
      ],
      colors:{
        'focusBorder':p.accent, 'foreground':p.foreground, 'descriptionForeground':p.muted,
        'widget.border':p.border, 'widget.shadow':dark ? '#00000055' : '#17223522',
        'editor.background':p.background, 'editor.foreground':p.foreground,
        'editorGutter.background':p.background,
        'editorLineNumber.foreground':p.muted, 'editorLineNumber.activeForeground':p.foreground,
        'editorCursor.foreground':p.accent, 'editorCursor.background':p.background,
        'editor.lineHighlightBackground':p.surface, 'editor.lineHighlightBorder':'#00000000',
        'editor.selectionBackground':p.selection,
        'editor.inactiveSelectionBackground':p.selection+'99',
        'editor.selectionHighlightBackground':p.selection+'88',
        'editor.selectionHighlightBorder':p.accent+'66',
        'editor.wordHighlightBackground':p.selection+'88',
        'editor.wordHighlightStrongBackground':p.selection,
        'editor.findMatchBackground':p.match, 'editor.findMatchBorder':dark ? '#d97706' : '#ca8a04',
        'editor.findMatchHighlightBackground':p.match+'66',
        'editor.findMatchHighlightBorder':'#00000000',
        'editor.rangeHighlightBackground':p.selection+'66',
        'editorWhitespace.foreground':p.muted+'55',
        'editorIndentGuide.background1':p.guide, 'editorIndentGuide.activeBackground1':p.muted,
        'editorBracketMatch.background':p.selection, 'editorBracketMatch.border':p.accent,
        'editorOverviewRuler.border':p.border,
        'editorWidget.background':p.surface, 'editorWidget.foreground':p.foreground,
        'editorWidget.border':p.border, 'editorWidget.resizeBorder':p.accent,
        'editorHoverWidget.background':p.surface, 'editorHoverWidget.foreground':p.foreground,
        'editorHoverWidget.border':p.border, 'editorHoverWidget.statusBarBackground':p.input,
        'editorSuggestWidget.background':p.surface, 'editorSuggestWidget.foreground':p.foreground,
        'editorSuggestWidget.border':p.border, 'editorSuggestWidget.selectedBackground':p.selection,
        'editorSuggestWidget.selectedForeground':p.foreground,
        'editorSuggestWidget.highlightForeground':p.accent,
        'editorSuggestWidget.focusHighlightForeground':p.accent,
        'input.background':p.input, 'input.foreground':p.foreground, 'input.border':p.border,
        'input.placeholderForeground':p.muted,
        'inputOption.activeBackground':p.selection, 'inputOption.activeBorder':p.accent,
        'inputOption.activeForeground':p.foreground,
        'list.hoverBackground':p.selection+'88', 'list.focusBackground':p.selection,
        'list.focusForeground':p.foreground, 'list.highlightForeground':p.accent,
        'list.activeSelectionBackground':p.selection, 'list.activeSelectionForeground':p.foreground,
        'list.inactiveSelectionBackground':p.selection,
        'quickInput.background':p.surface, 'quickInput.foreground':p.foreground,
        'quickInputList.focusBackground':p.selection, 'quickInputList.focusForeground':p.foreground,
        'menu.background':p.surface, 'menu.foreground':p.foreground, 'menu.border':p.border,
        'menu.selectionBackground':p.selection, 'menu.selectionForeground':p.foreground,
        'menu.separatorBackground':p.border,
        'button.background':p.accent, 'button.foreground':dark ? '#07111f' : '#ffffff',
        'textLink.foreground':p.accent, 'textLink.activeForeground':p.accent,
        'textCodeBlock.background':p.background,
        'scrollbar.shadow':'#00000000', 'scrollbarSlider.background':p.muted+'44',
        'scrollbarSlider.hoverBackground':p.muted+'66', 'scrollbarSlider.activeBackground':p.muted+'88',
      },
    });
  }
}
