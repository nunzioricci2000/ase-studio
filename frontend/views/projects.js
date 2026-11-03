// SPDX-FileCopyrightText: 2026 Behnam Farnaghinejad <behnam.farnaghinejad@polito.it>
// SPDX-License-Identifier: GPL-2.0-only
// Modified in the personal fork on 2026-11-02: render projects within their owned docking panel.
/** The project list requests operations; it does not own the current project. */
export function createProjectsView({session, services, root}) {
  const heading=root.querySelector('h2'),list=root.querySelector('#projects');
  function renderProjects(data) {
    heading.title=`Programs folder: ${data.directory || 'unknown'}`;
    list.innerHTML=data.projects.map(name=>`<button class="project ${name===session.state.current?.name?'selected':''}" data-name="${services.escapeHtml(name)}">${services.escapeHtml(name)}</button>`).join('');
    for(const button of list.querySelectorAll('.project')) button.onclick=()=>services.execute('project:open',{name:button.dataset.name});
  }
  return {renderProjects};
}
