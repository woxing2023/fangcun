/* Shared optical feedback. One decorative DOM surface, no perpetual animation
   or extra WebGL context. Passive paper panels remain non-interactive. */
(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const forced = matchMedia('(forced-colors: active)');
  const compact = matchMedia('(max-width: 900px), (pointer: coarse), (hover: none)');
  const enabled = () => document.documentElement.dataset.materialPerformance !== 'touch'
    && !compact.matches && !reduced.matches && !forced.matches && !document.hidden
    && typeof window.FangcunNative?.syncReminders !== 'function'
    && !/Android/i.test(navigator.userAgent || '');
  const paper = '.xuan-paper,[data-material="xuan"],.today-section,.today-next,.sidebar,.topbar,dialog,.auth-card,.quadrant,.list-panel';
  const controls = 'button,summary,[data-material="glass"],[role="button"],[role="tab"]';
  let active = null, frame = 0, timer = 0, latest = null;
  function clear() {
    cancelAnimationFrame(frame); frame=0; clearTimeout(timer);
    if (!active) return;
    active.ripple?.cancel(); active.node.remove();
    active.target.classList.remove('material-light-host','material-light-relative');
    active=null;
  }
  function paint(event, press=false) {
    if (!enabled() || !(event.target instanceof Element)) { clear(); return; }
    const target=event.target.closest(controls) || event.target.closest(paper);
    if (!target || target.disabled || target.closest('#scheduleView,[inert],[data-material="none"]')
      || target.matches('.sidebar-backdrop,[aria-disabled="true"]')) { clear(); return; }
    if (active?.target !== target) {
      clear();
      const node=document.createElement('span');
      node.className='material-light'; node.setAttribute('aria-hidden','true');
      const isControl=target.matches(controls);
      node.classList.toggle('material-light-glass',isControl);
      const rim=document.createElement('span'); rim.className='material-light-rim'; node.append(rim);
      active={target,node,ripple:null};
      if (getComputedStyle(target).position==='static') target.classList.add('material-light-relative');
      target.classList.add('material-light-host');
      target.append(node);
    }
    const rect=target.getBoundingClientRect();
    const x=Number.isFinite(event.clientX) ? Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)) : .5;
    const y=Number.isFinite(event.clientY) ? Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height)) : .5;
    active.node.style.setProperty('--light-x',`${(x*100).toFixed(2)}%`);
    active.node.style.setProperty('--light-y',`${(y*100).toFixed(2)}%`);
    if (press) {
      active.ripple?.cancel();
      // Only the light deforms. The control's text and hit area stay fixed.
      active.ripple=active.node.animate([
        {opacity:.35,scale:'.96 .90'}, {opacity:1,scale:'1.01 1.02',offset:.36}, {opacity:.8,scale:'1'}
      ],{duration:650,easing:'cubic-bezier(.22,1,.36,1)'});
    }
    clearTimeout(timer); timer=setTimeout(clear,press ? 950 : 1400);
  }
  document.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch' || !enabled()) return;
    latest=event;
    if(!frame) frame=requestAnimationFrame(()=>{frame=0;paint(latest)});
  },{passive:true});
  document.addEventListener('pointerdown',event=>paint(event,true),{passive:true});
  document.addEventListener('keydown',event=>{
    if(event.key==='Enter' || event.key===' ') paint({target:event.target},true);
    else if(event.key==='Escape' || event.key==='Tab') clear();
  });
  document.addEventListener('scroll',clear,{capture:true,passive:true});
  document.addEventListener('pointerout',event=>{if(!event.relatedTarget)clear()},{passive:true});
  document.addEventListener('visibilitychange',clear);
  window.addEventListener('resize',clear);
  window.addEventListener('pagehide',clear);
  reduced.addEventListener('change',clear); forced.addEventListener('change',clear); compact.addEventListener('change',clear);
  new MutationObserver(clear).observe(document.documentElement,{attributes:true,attributeFilter:['data-skin','data-mode','data-material-performance']});
})();
