// SPDX-License-Identifier: GPL-2.0-only
// Created in the personal fork on 2026-10-28: open the disposable packaged project before checking Monaco's rendered view.
(() => {
  const loaded = typeof window.aseHasUnsavedChanges === 'function';
  if (loaded && !window.__asePackagedSmokeOpened) {
    const project = document.querySelector('.project[data-name="native-smoke"]');
    if (project) {
      window.__asePackagedSmokeOpened = true;
      project.click();
    }
  }
  return JSON.stringify({url:location.href, state:document.readyState,
    ready:loaded && !!document.querySelector('.monaco-editor'),
    editor:!!document.querySelector('.monaco-editor'),
    projectOpened:!!window.__asePackagedSmokeOpened,
    dirtyHook:typeof window.aseHasUnsavedChanges, title:document.title});
})()
