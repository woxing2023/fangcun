/* One optical surface for the entire touch UI. Geometry is read at gesture
   start; subsequent pointer samples only update shader uniforms. */
(() => {
  'use strict';
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const forced = matchMedia('(forced-colors: active)');
  const enabled = () => (root.dataset.materialPerformance === 'touch' || document.body?.dataset.activeView === 'schedule')
    && !reduced.matches && !forced.matches && !document.hidden;
  const interactive = 'button,summary,input:not([type=hidden]),textarea,select,a[href],[role=button],[role=tab],[role=switch],[role=checkbox],[role=radio],[role=option],[role=combobox],[role=menuitem],[data-material=glass],.skin-option,.appearance-mode-option,.switch-label,.import-label,.task-card,.list-row,[data-course-id],[data-task-id]';
  const paper = '[data-material=xuan],.xuan-paper,.today-section,.today-next,.quadrant,.sidebar,.topbar,.schedule-board-wrap,.project-card,dialog';
  const layer = document.createElement('span');
  layer.className = 'touch-material-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = 'position:fixed;left:0;top:0;z-index:190;display:block;pointer-events:none;overflow:hidden;contain:strict;isolation:isolate;';
  // Shadow DOM isolates the single canvas from legacy all-buttons/all-spans
  // material rules and avoids style invalidation of the surrounding content.
  const shadow = layer.attachShadow({mode:'open'});
  shadow.innerHTML = `<style>
    :host{pointer-events:none!important}*{box-sizing:border-box;pointer-events:none}
    .glow,.ring{position:absolute;left:0;top:0;border-radius:50%;opacity:0}
    .glow{width:180px;height:180px;background:radial-gradient(ellipse,rgba(255,255,255,.48),rgba(176,213,245,.14) 35%,transparent 68%)}
    .ring{width:100px;height:100px;border:1.5px solid rgba(255,255,255,.7);box-shadow:inset 0 2px 6px rgba(255,255,255,.3),0 3px 9px rgba(50,81,120,.18)}
  </style><span class="glow"></span><span class="ring"></span>`;
  const glow = shadow.querySelector('.glow'), ring = shadow.querySelector('.ring');
  let renderer = null, loading = null, failed = false, active = null;
  let updateFrame = 0, releaseTimer = 0, latest = null, idle = 0;
  let fallbackAnimation = null, releaseAnimation = null;
  const counts = {gestures:0, pointerSamples:0, uniformUpdates:0, geometryReads:0, cancellations:0};
  const rectOf = element => { counts.geometryReads++; return element.getBoundingClientRect(); };
  const clamp = (value, min, max) => Math.max(min, Math.min(max,value));

  function clear() {
    clearTimeout(releaseTimer); cancelAnimationFrame(updateFrame); updateFrame=0; latest=null;
    fallbackAnimation?.cancel(); fallbackAnimation=null;
    releaseAnimation?.cancel(); releaseAnimation=null;
    renderer?.unmount(); layer.remove(); active=null;
    glow.style.opacity='0'; ring.style.opacity='0';
  }
  function release() { clear(); renderer?.dispose(); renderer=null; }
  async function prepare() {
    if (!enabled() || failed) return null;
    if (renderer) return renderer;
    try {
      loading ||= import('./liquid-renderer.js');
      const module = await loading;
      if (!enabled()) return null;
      renderer ||= module.createRenderer();
      return renderer;
    } catch { failed=true; return null; }
  }
  function scheduleWarmup() {
    if (!enabled() || renderer || failed || idle) return;
    const warm = () => { idle=0; void prepare(); };
    idle = 'requestIdleCallback' in window ? requestIdleCallback(warm,{timeout:1800}) : setTimeout(warm,500);
  }
  function choose(target) {
    if (!(target instanceof Element) || target.closest('[inert],[data-material=none],.sidebar-backdrop')) return null;
    let element=target.closest(interactive);
    if (element?.matches(':disabled,[aria-disabled=true],.liquid-select-native,.appearance-mode-source')) return null;
    // A time slot is a hit area in the shared paper board, not its own lens.
    if (element?.matches('.calendar-time-cell,.schedule-day-track')) element=element.closest('.schedule-board-wrap');
    element ||= target.closest(paper);
    if (!element) return null;
    return {element,kind:element.matches(interactive) ? 'glass' : 'paper'};
  }
  function geometry(element) {
    const rect=rectOf(element), style=getComputedStyle(element);
    if (!rect.width || !rect.height) return null;
    const clip={left:Math.max(0,rect.left),right:Math.min(innerWidth,rect.right),top:Math.max(0,rect.top),bottom:Math.min(innerHeight,rect.bottom)};
    // Only gesture start walks clipping ancestors. A scrolled task must never
    // cast a light sheet over its list header or outside a rounded panel.
    for(let ancestor=element.parentElement;ancestor && ancestor!==document.body;ancestor=ancestor.parentElement) {
      const s=getComputedStyle(ancestor);
      if (!/(auto|scroll|hidden|clip)/.test(s.overflowX+' '+s.overflowY)) continue;
      const r=rectOf(ancestor);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) {clip.left=Math.max(clip.left,r.left);clip.right=Math.min(clip.right,r.right);}
      if (/(auto|scroll|hidden|clip)/.test(s.overflowY)) {clip.top=Math.max(clip.top,r.top);clip.bottom=Math.min(clip.bottom,r.bottom);}
    }
    return {rect,clip,radius:parseFloat(style.borderTopLeftRadius)||0};
  }
  function fallback(state, pulse=true) {
    glow.style.opacity = state.kind==='paper' ? '.65' : '1';
    glow.style.transform=`translate3d(${state.x*state.rect.width-90}px,${state.y*state.rect.height-90}px,0)`;
    if (!pulse) return;
    fallbackAnimation?.cancel();
    const x=state.x*state.rect.width-50,y=state.y*state.rect.height-50;
    fallbackAnimation=ring.animate([
      {transform:`translate(${x}px,${y}px) scale(.12)`,opacity:state.kind==='paper' ? .12 : .7},
      {transform:`translate(${x}px,${y}px) scale(3)`,opacity:0}
    ],{duration:900,easing:'cubic-bezier(.16,.6,.3,1)',fill:'forwards'});
  }
  function mountRenderer(state, gpu) {
    if (!gpu || active!==state || !enabled()) return;
    const health=gpu.getStats?.();
    if (health?.lost || health?.disposed) {state.gpu=false; fallback(state);return;}
    try {
      gpu.mount(shadow,state.rect,{kind:state.kind,dark:root.dataset.mode==='dark',radius:state.radius});
      gpu.move(state.x,state.y); gpu.pulse(state.x,state.y,1);
      state.gpu=true; glow.style.opacity='0'; fallbackAnimation?.cancel();
    } catch {state.gpu=false; fallback(state);}
  }
  function begin(event) {
    if (!enabled()) return;
    if(root.dataset.materialPerformance!=='touch' && !event.target.closest?.('#scheduleView'))return;
    if (event.isPrimary===false) {clear();return;}
    const chosen=choose(event.target);
    if (!chosen) {clear();return;}
    const measured=geometry(chosen.element);
    if (!measured) return;
    clear(); counts.gestures++;
    const {rect,clip,radius}=measured;
    active={target:chosen.element,kind:chosen.kind,rect,radius,pointer:event.pointerId,x:clamp((event.clientX-rect.left)/rect.width,0,1),y:clamp((event.clientY-rect.top)/rect.height,0,1),gpu:false,released:false};
    layer.style.width=rect.width+'px'; layer.style.height=rect.height+'px';
    layer.style.borderRadius=radius+'px';
    // Options rendered in a popover must keep their optics in the same top
    // layer; a body/dialog overlay would be painted behind the open menu.
    const host=chosen.element.closest('.liquid-select-menu,dialog[open]') || document.body;
    active.host=host;
    let left=rect.left,top=rect.top;
    if (host!==document.body) {
      const bounds=rectOf(host);
      left-=bounds.left+host.clientLeft-host.scrollLeft;
      top-=bounds.top+host.clientTop-host.scrollTop;
    }
    layer.style.position=host===document.body ? 'fixed' : 'absolute';
    layer.style.transform=`translate3d(${left}px,${top}px,0)`;
    layer.style.clipPath=`inset(${Math.max(0,clip.top-rect.top)}px ${Math.max(0,rect.right-clip.right)}px ${Math.max(0,rect.bottom-clip.bottom)}px ${Math.max(0,clip.left-rect.left)}px)`;
    // Pop a dialog layer into that dialog's top layer, without changing its
    // controls or hit targets. The overlay remains strictly non-interactive.
    host.append(layer);
    fallback(active);
    if (renderer) mountRenderer(active,renderer);
    else {const state=active; void prepare().then(gpu=>mountRenderer(state,gpu));}
    releaseTimer=setTimeout(clear,1600); // Also covers lost pointerup on app switching.
  }
  function flush() {
    updateFrame=0;
    if (!active || !latest || !enabled()) return;
    const {rect}=active;
    active.x=clamp((latest.clientX-rect.left)/rect.width,0,1);
    active.y=clamp((latest.clientY-rect.top)/rect.height,0,1); latest=null;
    if (active.gpu) renderer.move(active.x,active.y); else fallback(active,false);
    counts.uniformUpdates++;
  }
  function move(event) {
    if (!active || active.released || event.pointerId!==active.pointer || !enabled()) return;
    counts.pointerSamples++;
    clearTimeout(releaseTimer); releaseTimer=setTimeout(clear,1600);
    latest=event;
    if (!updateFrame) updateFrame=requestAnimationFrame(flush);
  }
  function end(event) {
    if (!active || event.pointerId!==active.pointer) return;
    if (latest) {cancelAnimationFrame(updateFrame);flush();}
    active.released=true;
    clearTimeout(releaseTimer);
    releaseAnimation=layer.animate([{opacity:1,offset:0},{opacity:1,offset:.25},{opacity:0}],{duration:1100,easing:'ease-out'});
    releaseTimer=setTimeout(clear,1110);
  }
  document.addEventListener('pointerdown',begin,{passive:true});
  document.addEventListener('pointermove',move,{passive:true});
  document.addEventListener('pointerup',end,{passive:true});
  document.addEventListener('pointercancel',()=>{counts.cancellations++;clear();},{passive:true});
  document.addEventListener('touchstart',event=>{if(event.touches.length>1)clear();},{passive:true});
  document.addEventListener('scroll',clear,{capture:true,passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)release();else scheduleWarmup();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'||event.key==='Tab')clear();});
  window.addEventListener('resize',clear,{passive:true});
  window.addEventListener('pagehide',release);
  window.addEventListener('pageshow',scheduleWarmup);
  shadow.addEventListener('webglcontextlost',()=>{
    if(active){active.gpu=false;fallback(active);}
  },true);
  shadow.addEventListener('webglcontextrestored',()=>{
    // A native event may run a microtask checkpoint between listeners.
    // Wait for dispatch to finish so the renderer has restored GL resources.
    const state=active,gpu=renderer;
    setTimeout(()=>{if(active && active===state && renderer===gpu)mountRenderer(state,gpu);},0);
  },true);
  const observeTargets=()=>new MutationObserver(records=>{
    if(active && (!active.target.isConnected || active.host.hidden || (active.host.matches('dialog') && !active.host.open)))clear();
    if(records.some(record=>record.attributeName==='data-active-view')){if(!enabled())release();else scheduleWarmup();}
  }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','data-active-view']});
  if(document.body)observeTargets();else document.addEventListener('DOMContentLoaded',observeTargets,{once:true});
  for(const preference of [reduced,forced]) preference.addEventListener('change',()=>{release();scheduleWarmup();});
  new MutationObserver(()=>{clear();if(!enabled())release();else scheduleWarmup();}).observe(root,{attributes:true,attributeFilter:['data-skin','data-mode','data-material-performance']});
  window.FangcunTouchMaterial=Object.freeze({get enabled(){return enabled();},getStats(){return {...counts,enabled:enabled(),active:!!active,kind:active?.kind||null,fallback:!!active&&!active.gpu,renderer:renderer?.getStats?.()||null};}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scheduleWarmup,{once:true});else scheduleWarmup();
})();
