/* Appearance owns only device preferences and decorative interaction; no app data. */
(() => {
  "use strict";
  const root = document.documentElement;
  const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
  root.dataset.skin = read("fangcun-skin", "classic") === "liquid" ? "liquid" : "classic";
  root.dataset.mode = read("fangcun-theme", "light") === "dark" ? "dark" : "light";
  document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById("appearanceModal");
    document.body.classList.toggle("dark", root.dataset.mode === "dark");
    if (!modal) return;
    const status = document.getElementById("appearanceStatus");
    const mode = document.getElementById("appearanceMode");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let active = null;
    let frame = 0;
    let latest = null;
    let lastTrail = 0;
    let cleanupTimer = 0;
    let renderer = null, rendererLoading = null, rendererFailed = false;
    let rendererFactory = null;
    // Extension point for native DOM, custom elements, or framework-mounted controls.
    window.FangcunAppearance = Object.freeze({
      registerRenderer(factory) {
        if (typeof factory !== 'function') throw new TypeError('Renderer factory must be a function');
        clear(); renderer?.dispose(); renderer=null; rendererLoading=null; rendererFactory=factory; rendererFailed=false;
      },
      get skin() { return root.dataset.skin; }
    });
    async function ensureRenderer(state) {
      if (rendererFailed || reduced.matches) return;
      try {
        if (!renderer) {
          rendererLoading ||= rendererFactory ? Promise.resolve(rendererFactory) : import('./liquid-renderer.js').then(module => module.createRenderer);
          const factory = await rendererLoading;
          if (active !== state || reduced.matches || root.dataset.skin !== 'liquid') return;
          renderer ||= factory();
        }
        if (active === state) renderer.mount(state.lens, state.rect);
      } catch { rendererFailed=true; renderer?.dispose(); renderer=null; }
    }
    function releaseRenderer() { clear(); renderer?.dispose(); renderer=null; }
    const save = (key, value) => {
      try { localStorage.setItem(key, value); status.textContent = "已保存，仅在当前设备生效。"; }
      catch { status.textContent = "已应用。浏览器无法保存偏好，下次打开需重新选择。"; }
    };
    const sync = () => {
      document.body.classList.toggle("dark", root.dataset.mode === "dark");
      mode.value = root.dataset.mode;
      modal.querySelectorAll('[name="skin"]').forEach(input => { input.checked = input.value === root.dataset.skin; });
      document.querySelector('meta[name="theme-color"]').content = root.dataset.mode === "dark" ? (root.dataset.skin === "liquid" ? "#202934" : "#1f211f") : root.dataset.skin === "liquid" ? "#e8edf2" : "#f4f2ed";
    };
    document.getElementById("appearanceSettingsBtn").addEventListener("click", () => { sync(); modal.showModal(); });
    modal.addEventListener("change", event => {
      if (event.target.name === "skin") { root.dataset.skin = event.target.value; save("fangcun-skin", root.dataset.skin); releaseRenderer(); }
      if (event.target === mode) { root.dataset.mode = mode.value; save("fangcun-theme", mode.value); }
      sync();
    });
    // Observe the existing theme shortcut so it and the settings always agree.
    new MutationObserver(() => {
      root.dataset.mode = document.body.classList.contains("dark") ? "dark" : "light";
      mode.value = root.dataset.mode;
      document.querySelector('meta[name="theme-color"]').content = root.dataset.mode === "dark" ? (root.dataset.skin === "liquid" ? "#202934" : "#1f211f") : root.dataset.skin === "liquid" ? "#e8edf2" : "#f4f2ed";
    }).observe(document.body, { attributes:true, attributeFilter:["class"] });
    window.addEventListener("storage", event => {
      if (event.key === "fangcun-skin") root.dataset.skin = event.newValue === "liquid" ? "liquid" : "classic";
      if (event.key === "fangcun-theme") root.dataset.mode = event.newValue === "dark" ? "dark" : "light";
      releaseRenderer(); sync();
    });
    function clear() {
      cancelAnimationFrame(frame); frame = 0; clearTimeout(cleanupTimer);
      renderer?.unmount();
      if (!active) return;
      active.animations.forEach(animation => animation.cancel());
      active.lens.remove();
      active.target.style.position = active.position;
      active.target.style.borderRadius = active.radius;
      active = null;
    }
    function surface(target) {
      if (root.dataset.skin !== "liquid" || reduced.matches || document.hidden) return null;
      if (!(target instanceof Element)) return null;
      const control = target.closest('[data-material="glass"], button, input, textarea, select, summary, a[href], [role="button"], [role="tab"], [role="switch"], [role="option"], .skin-option, .switch-label, .import-choice label, .import-label, .task-card, .list-row, .today-class, .today-timeline-row, .today-ddl-row, .day-course-card, .day-task-card, .agenda-course, .overview-course, .month-day, [data-calendar-date]');
      if (!control || control.disabled || control.matches('[aria-disabled="true"],.liquid-select-native,.sidebar-backdrop') || control.closest('[inert], [data-material="none"]')) return null;
      if (active?.target === control) return active;
      clear();
      const rect = control.getBoundingClientRect();
      const lens = document.createElement("span");
      lens.className = "liquid-lens"; lens.setAttribute("aria-hidden", "true");
      const caustic = document.createElement("span"); caustic.className = "liquid-caustic"; lens.append(caustic);
      const computed = getComputedStyle(control);
      if (!rect.width || !rect.height) return null;
      active = { target:control, lens, rect, position:control.style.position, radius:control.style.borderRadius, animations:new Set() };
      if (control.matches('input,textarea,select')) {
        // Native/replaced controls cannot contain children. A fixed decorative
        // proxy matches the control itself, never its label or helper text.
        lens.style.cssText = `position:fixed;inset:auto;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;border-radius:${computed.borderRadius};z-index:250;`;
        (control.closest('dialog') || document.body).append(lens);
      } else {
        if (computed.position === "static") control.style.position = "relative";
        control.append(lens);
      }
      ensureRenderer(active);
      return active;
    }
    function particle(state, x, y, trail) {
      renderer?.pulse(x/state.rect.width, y/state.rect.height, trail ? .3 : 1);
      if (state.lens.childElementCount > 16) return;
      const node = document.createElement("span"); node.className = trail ? "liquid-trail" : "liquid-wave";
      node.style.left = `${x}px`; node.style.top = `${y}px`; state.lens.append(node);
      const scale = trail ? 2.8 : Math.max(state.rect.width, state.rect.height) / 10;
      const animation = node.animate([
        { transform:"translate(-50%,-50%) scale(.3)", opacity:trail ? .5 : .8 },
        { transform:`translate(-50%,-50%) scale(${scale})`, opacity:0 }
      ], { duration:trail ? 650 : 900, easing:"cubic-bezier(.22,1,.36,1)" });
      state.animations.add(animation);
      animation.onfinish = () => { node.remove(); state.animations.delete(animation); };
    }
    document.addEventListener("pointermove", event => {
      if (event.pointerType === "touch") return;
      latest = event;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const state = surface(latest.target); if (!state) { clear(); return; }
        clearTimeout(cleanupTimer);
        const x = latest.clientX - state.rect.left, y = latest.clientY - state.rect.top;
        state.lens.style.setProperty("--water-x", `${x}px`); state.lens.style.setProperty("--water-y", `${y}px`);
        renderer?.move(x/state.rect.width,y/state.rect.height);
        // Shape response stays in the decorative lens, preserving circular controls
        // and segmented ends in the functional DOM.
        state.lens.style.borderRadius = getComputedStyle(state.target).borderRadius;
        if (performance.now() - lastTrail > 65) { particle(state, x, y, true); lastTrail = performance.now(); }
        cleanupTimer = setTimeout(clear, 1000);
      });
    }, { passive:true });
    document.addEventListener("pointerdown", event => {
      const state = surface(event.target); if (!state) return;
      particle(state, event.clientX - state.rect.left, event.clientY - state.rect.top, false);
      clearTimeout(cleanupTimer); cleanupTimer = setTimeout(clear, 1100);
    }, { passive:true });
    document.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const state = surface(event.target); if (!state) return;
      particle(state, state.rect.width / 2, state.rect.height / 2, false);
      clearTimeout(cleanupTimer); cleanupTimer = setTimeout(clear, 1100);
    });
    document.addEventListener("scroll", clear, { capture:true, passive:true });
    document.addEventListener("visibilitychange", releaseRenderer);
    window.addEventListener("resize", clear);
    reduced.addEventListener("change", releaseRenderer);
    window.addEventListener("pagehide", releaseRenderer);
    sync();
  });
})();
