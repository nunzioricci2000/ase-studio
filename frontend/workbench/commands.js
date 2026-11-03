// SPDX-License-Identifier: GPL-2.0-only
// Created in the personal fork on 2026-11-02: share application actions and enablement across UI entry points.
/** Register existing application operations once. Monaco keeps its native keys. */
export function bindApplicationCommands({commands, session, shell, services, sourceEditor}) {
  const projectActions = new Set(['save','duplicate','open-with','rename','submit','run','reset','step','configure','delete']);
  const exclusive = new Set(['run','step','submit','delete','duplicate','rename','new']);
  function allowed(id, element) {
    const s = session.state;
    if (projectActions.has(id)) return Boolean(s.current) && !s.operation;
    if (id === 'new') return !s.operation;
    if (id === 'export-pipeline') return Boolean(s.pipelineData) && !s.operation;
    if (id === 'cycle-prev') return s.stepMode && s.playbackCycle > 1 && !s.operation;
    if (id === 'cycle-next') return s.stepMode && s.playbackCycle < (s.pipelineData?.cycles || 0) && !s.operation;
    return !element.disabled;
  }
  const bindings = [];
  for (const element of document.querySelectorAll('button[id]')) {
    if (!element.onclick || element.id === 'views-menu') continue;
    const id = element.id, original = element.onclick;
    const command = `app:${id}`;
    commands.addCommand(command, {
      label:() => element.textContent.trim() || element.title || id,
      isEnabled:() => allowed(id,element),
      execute:async () => {
        if (exclusive.has(id)) session.update({operation:id});
        try { return await original.call(element, new Event('click')); }
        catch (error) { await services.showActionMessage(element.textContent.trim(), error.message); }
        finally { if (exclusive.has(id)) session.update({operation:null}); }
      }
    });
    element.onclick = () => commands.execute(command);
    bindings.push([element,command]);
  }
  commands.addCommand('project:open', {label:'Open project',isEnabled:()=>!session.state.operation,
    execute:args=>services.openProject(args.name)});
  commands.addCommand('trace:select-cycle', {label:'Select cycle',isEnabled:()=>!session.state.operation && Boolean(session.state.pipelineData),
    execute:({cycle})=>{if(Number.isInteger(cycle)&&cycle>=1&&cycle<=session.state.pipelineData.cycles) session.update({playbackCycle:cycle,selectedColumn:cycle,stepMode:true});}});
  commands.addCommand('trace:change', {label:'Navigate to value change',isEnabled:()=>!session.state.operation && Boolean(session.state.pipelineData),
    execute:args=>services.navigateToItemChange(args.item,args.direction)});
  for (const [id,run] of Object.entries({add:args=>services.addMemoryWatch(args.name),
    remove:args=>services.removeMemoryWatch(args.index),clear:()=>services.clearMemoryWatches(),
    format:args=>services.setMemoryFormat(args.value)})) {
    commands.addCommand(`memory:${id}`,{label:`Memory ${id}`,execute:run});
  }
  const jumpForm = shell.nodes.pipeline.querySelector('#cycle-jump-form');
  const jump = jumpForm.onsubmit;
  commands.addCommand('trace:jump',{label:'Jump to cycle',
    isEnabled:()=>session.state.stepMode && Boolean(session.state.pipelineData) && !session.state.operation,
    execute:()=>jump.call(jumpForm, new Event('submit',{cancelable:true}))});
  jumpForm.onsubmit=event=>{event.preventDefault();commands.execute('trace:jump');};
  for (const form of document.querySelectorAll('form[id]')) {
    if(!form.onsubmit || form===jumpForm) continue;
    const original=form.onsubmit, id=`form:${form.id}`;
    commands.addCommand(id,{label:form.id,execute:()=>original.call(form,new Event('submit',{cancelable:true}))});
    form.onsubmit=event=>{event.preventDefault();commands.execute(id).catch(error=>services.showActionMessage('Action failed',error.message));};
  }
  services.execute=(id,args={})=>commands.execute(id,args);
  const update = () => {
    for (const [element,id] of bindings) {
      const name=id.slice(4);
      if(projectActions.has(name)||['new','export-pipeline','cycle-prev','cycle-next'].includes(name)) element.disabled=!commands.isEnabled(id);
    }
  };
  session.changed.connect(update);
  update();
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented || (!event.ctrlKey&&!event.metaKey) || event.altKey) return;
    const target=event.target;
    if(target.closest('.monaco-editor, dialog, input, textarea, select, [contenteditable="true"]')) return;
    const id=event.key.toLowerCase()==='s'?'app:save':event.key.toLowerCase()==='f'?'app:find-source':null;
    if(!id) return;
    event.preventDefault();
    if(commands.isEnabled(id)) commands.execute(id);
  });
}
