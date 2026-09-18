/* Appearance owns only device preferences and decorative interaction; no app data. */
(() => {
  "use strict";
  const THEME_COLORS = Object.freeze({
    classic: Object.freeze({ light: "#f4f2ed", dark: "#1f211f" }),
    liquid: Object.freeze({ light: "#e9ecef", dark: "#24282e" }),
  });
  const root = document.documentElement;
  // Touch layouts use the shared GPU optical layer in touch-material.js.
  // Desktop pointer optics retain their existing adapter.
  const compact = matchMedia("(max-width: 900px), (pointer: coarse), (hover: none)");
  const nativeAndroid = () => typeof window.FangcunNative?.syncReminders === "function"
    || /Android/i.test(navigator.userAgent || "");
  const updatePerformance = () => {
    const profile = compact.matches || nativeAndroid() ? "touch" : "dynamic";
    if (root.dataset.materialPerformance !== profile) root.dataset.materialPerformance = profile;
  };
  updatePerformance();
  const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
  root.dataset.skin = read("fangcun-skin", "classic") === "liquid" ? "liquid" : "classic";
  root.dataset.mode = read("fangcun-theme", "light") === "dark" ? "dark" : "light";
  const syncThemeColor = () => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = THEME_COLORS[root.dataset.skin]?.[root.dataset.mode] || THEME_COLORS.classic.light;
  };
  syncThemeColor();
  document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById("appearanceModal");
    document.body.classList.toggle("dark", root.dataset.mode === "dark");
    if (!modal) return;
    const status = document.getElementById("appearanceStatus");
    const mode = document.getElementById("appearanceMode");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const forced = matchMedia("(forced-colors: active)");
    const effectsEnabled = () => root.dataset.materialPerformance === "dynamic"
      && !reduced.matches && !forced.matches && !document.hidden;
    let active = null;
    let frame = 0;
    let latest = null;
    let lastTrail = 0;
    let renderer = null, rendererLoading = null, rendererFailed = false, liquidMotion = null;
    let rendererFactory = null;
    const dialogAnimations = new WeakMap();
    const animatedDialogs = new Set();
    const cancelDialogAnimation = (dialog, settle = true) => {
      const entry = dialogAnimations.get(dialog);
      if (!entry) return;
      entry.animation.cancel(); dialogAnimations.delete(dialog); animatedDialogs.delete(dialog);
      dialog.style.opacity = ''; dialog.style.transform = '';
      if (settle && entry.direction === 'close' && dialog.open) dialog.close(entry.returnValue);
    };
    const settleDialogAnimations = () => [...animatedDialogs].forEach(dialog => cancelDialogAnimation(dialog));
    function openDialog(dialog) {
      if (!dialog) return;
      cancelDialogAnimation(dialog, false);
      if (dialog.open) return;
      dialog.showModal();
      if (reduced.matches || forced.matches || typeof dialog.animate !== "function") return;
      const animation = dialog.animate([{opacity:0,transform:"translateY(8px) scale(.98)"},{opacity:1,transform:"translateY(0) scale(1)"}], {duration:250,easing:"cubic-bezier(.23,1,.32,1)"});
      const entry = { animation, direction:'open', returnValue:'' };
      dialogAnimations.set(dialog, entry); animatedDialogs.add(dialog);
      animation.finished.catch(() => {}).finally(() => { if (dialogAnimations.get(dialog) === entry) { dialogAnimations.delete(dialog); animatedDialogs.delete(dialog); dialog.style.opacity = ''; dialog.style.transform = ''; } });
    }
    function closeDialog(dialog, returnValue = "") {
      if (!dialog?.open) return;
      cancelDialogAnimation(dialog, false);
      if (reduced.matches || forced.matches || typeof dialog.animate !== "function") { dialog.close(returnValue); return; }
      const animation = dialog.animate([{opacity:1,transform:"translateY(0) scale(1)"},{opacity:0,transform:"translateY(4px) scale(.99)"}], {duration:160,easing:"cubic-bezier(.23,1,.32,1)"});
      const entry = { animation, direction:'close', returnValue };
      dialogAnimations.set(dialog, entry); animatedDialogs.add(dialog);
      animation.finished.catch(() => {}).finally(() => {
        if (dialogAnimations.get(dialog) !== entry) return;
        dialogAnimations.delete(dialog); animatedDialogs.delete(dialog); dialog.style.opacity = ''; dialog.style.transform = ''; if (dialog.open) dialog.close(returnValue);
      });
    }
    // Extension point for native DOM, custom elements, or framework-mounted controls.
    window.FangcunAppearance = Object.freeze({
      registerRenderer(factory) {
        if (typeof factory !== 'function') throw new TypeError('Renderer factory must be a function');
        clear(); renderer?.dispose(); renderer=null; rendererLoading=null; rendererFactory=factory; rendererFailed=false;
      },
      openDialog,
      closeDialog,
      get skin() { return root.dataset.skin; },
      get effectsEnabled() { return effectsEnabled(); }
    });
    async function ensureRenderer(state) {
      if (rendererFailed || !effectsEnabled()) return;
      try {
        if (!renderer) {
          rendererLoading ||= rendererFactory ? Promise.resolve(rendererFactory) : import('./liquid-renderer.js').then(module => { liquidMotion = module.LIQUID_MOTION; return module.createRenderer; });
          const factory = await rendererLoading;
          if (active !== state || !effectsEnabled() || root.dataset.skin !== 'liquid') return;
          renderer ||= factory();
        }
        if (active === state) renderer.mount(state.lens, state.rect, {kind:"glass", dark:root.dataset.mode === "dark", radius:state.radius, tint:state.tint});
      } catch { rendererFailed=true; renderer?.dispose(); renderer=null; }
    }
    function releaseRenderer() { clear(); renderer?.dispose(); renderer=null; }
    const materialHosts = '.sidebar,.topbar,.mobile-bottom-nav,.quick-add,.week-toolbar,.sidebar-note,.matrix-board,.quadrant,.list-panel,.today-next,.today-section,.today-aside,.today-progress,.project-card,.project-dashboard > div,.admin-card,.admin-stat,.admin-user,.admin-detail,.schedule-board-wrap,.year-calendar,.month-calendar,.week-calendar,.mini-month,.overview-day,.overview-summary > div,.reminders-card,.calendar-integration-setting,.calendar-subscription-setting,.smart-preview-card,.smart-source,.smart-time-suggestion,.decision-box,.quadrant-preview,.course-task-actions,.course-linked-panel,.sync-recovery,.update-banner,.view-switch,.calendar-zoom-tools,.data-hub-tabs,.auth-tabs,.segmented,[data-material="glass"]';
    const largeSurfaceObserver = typeof ResizeObserver === "function" ? new ResizeObserver(entries => {
      for (const entry of entries) {
        const box = Array.isArray(entry.borderBoxSize) ? entry.borderBoxSize[0] : entry.borderBoxSize;
        const width = Number(box?.inlineSize) || entry.target.offsetWidth;
        const height = Number(box?.blockSize) || entry.target.offsetHeight;
        const next = width >= 160 && height >= 100 ? "true" : "false";
        if (entry.target.dataset.largeSurface !== next) entry.target.dataset.largeSurface = next;
      }
    }) : null;
    const observeMaterialHosts = rootNode => {
      if (!largeSurfaceObserver || !(rootNode instanceof Element)) return;
      if (rootNode.matches(materialHosts)) largeSurfaceObserver.observe(rootNode);
      rootNode.querySelectorAll(materialHosts).forEach(node => largeSurfaceObserver.observe(node));
    };
    observeMaterialHosts(document.body);
    new MutationObserver(records => {
      for (const record of records) {
        record.removedNodes.forEach(node => { if (node.nodeType === 1) largeSurfaceObserver?.unobserve(node); });
        record.addedNodes.forEach(node => { if (node.nodeType === 1) observeMaterialHosts(node); });
      }
    }).observe(document.body, {childList:true,subtree:true});
    const save = (key, value) => {
      try { localStorage.setItem(key, value); status.textContent = "已保存，仅在当前设备生效。"; }
      catch { status.textContent = "已应用。浏览器无法保存偏好，下次打开需重新选择。"; }
    };
    const sync = () => {
      document.body.classList.toggle("dark", root.dataset.mode === "dark");
      mode.value = root.dataset.mode;
      modal.querySelectorAll('[name="skin"]').forEach(input => { input.checked = input.value === root.dataset.skin; });
      syncThemeColor();
    };
    document.getElementById("appearanceSettingsBtn").addEventListener("click", () => { sync(); openDialog(modal); });
    modal.addEventListener("change", event => {
      if (event.target.name === "skin") { root.dataset.skin = event.target.value; save("fangcun-skin", root.dataset.skin); releaseRenderer(); }
      if (event.target === mode) { root.dataset.mode = mode.value; save("fangcun-theme", mode.value); }
      sync();
    });
    // Observe the existing theme shortcut so it and the settings always agree.
    new MutationObserver(() => {
      const nextMode = document.body.classList.contains("dark") ? "dark" : "light";
      if (root.dataset.mode !== nextMode) root.dataset.mode = nextMode;
      mode.value = root.dataset.mode;
      syncThemeColor();
    }).observe(document.body, { attributes:true, attributeFilter:["class"] });
    window.addEventListener("storage", event => {
      if (event.key === "fangcun-skin") root.dataset.skin = event.newValue === "liquid" ? "liquid" : "classic";
      if (event.key === "fangcun-theme") root.dataset.mode = event.newValue === "dark" ? "dark" : "light";
      releaseRenderer(); sync();
    });
    function clear() {
      cancelAnimationFrame(frame); frame = 0;
      renderer?.unmount();
      trailPoint = null;
      if (!active) return;
      active.lens.remove();
      if (active.positionChanged) active.target.style.position = active.position;
      active = null;
    }
    function surface(target) {
      if (root.dataset.skin !== "liquid" || !effectsEnabled()) return null;
      if (!(target instanceof Element) || target.closest("#scheduleView")) return null;
      const control = target.closest('[data-material="glass"], button, input, textarea, select, summary, a[href], [contenteditable="true"], [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="option"], [role="combobox"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], .skin-option, .switch-label, .import-choice label, .import-label');
      if (!control || control.disabled || control.matches('[aria-disabled="true"],.liquid-select-native,.sidebar-backdrop') || control.closest('[inert], [data-material="none"], [data-material="paper"], .task-card, .list-row, .today-class, .today-timeline-row, .today-ddl-row, .day-course-card, .day-task-card, .agenda-course, .overview-course, .course-block, .calendar-week-event, .calendar-entry, .month-day, [data-calendar-date]')) return null;
      if (active?.target === control) return active;
      clear();
      const rect = control.getBoundingClientRect();
      const lens = document.createElement("span");
      lens.className = "liquid-lens"; lens.setAttribute("aria-hidden", "true");
      const computed = getComputedStyle(control);
      const dialog = control.closest("dialog");
      const dialogRect = dialog?.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const tint = computed.getPropertyValue("--liquid-glass-tint").trim().split(/\s+/).map(value => Number(value) / 255).filter(Number.isFinite);
      active = { target:control, lens, rect, radius:parseFloat(computed.borderTopLeftRadius) || 0, tint:tint.length === 3 ? tint : undefined, position:control.style.position, positionChanged:false };
      if (dialog) {
        // A backdrop-filter makes the dialog a fixed-position containing block.
        // Use its padding-box coordinates; never move/resize the real control.
        lens.style.cssText = `position:absolute;inset:auto;pointer-events:none;left:${rect.left - dialogRect.left - dialog.clientLeft + dialog.scrollLeft}px;top:${rect.top - dialogRect.top - dialog.clientTop + dialog.scrollTop}px;width:${rect.width}px;height:${rect.height}px;border-radius:${computed.borderRadius};z-index:250;`;
        dialog.append(lens);
      } else if (control.matches('input,textarea,select')) {
        lens.style.cssText = `position:fixed;inset:auto;pointer-events:none;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;border-radius:${computed.borderRadius};z-index:250;`;
        document.body.append(lens);
      } else {
        if (computed.position === "static") { control.style.position = "relative"; active.positionChanged = true; }
        control.append(lens);
      }
      ensureRenderer(active);
      return active;
    }
    function pulse(state, x, y, kind, segment = {}) {
      const trail = kind === "trail";
      if (trail) {
        const trailSpeed = Math.min(1.5, segment.distance / Math.max(segment.dtSeconds, 0.008) / 650);
        const labTrail = (liquidMotion?.trailStrength || 0) * 1.05
          * (1.1 + trailSpeed) * Math.min(1, segment.distance / 8);
        const energy = labTrail * (renderer?.getStats?.().profile?.amplitude || 0);
        state.lens.style.setProperty("--trail-energy", String(energy));
      }
      renderer?.pulse(x/state.rect.width, y/state.rect.height, kind);
    }
    let trailPoint = null;
    document.addEventListener("pointermove", event => {
      if (event.pointerType === "touch" || !effectsEnabled()) return;
      latest = event;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const state = surface(latest.target); if (!state) { clear(); return; }
        const x = latest.clientX - state.rect.left, y = latest.clientY - state.rect.top;
        renderer?.move(x/state.rect.width,y/state.rect.height);
        const now = performance.now();
        const distance = trailPoint ? Math.hypot(x - trailPoint.x, y - trailPoint.y) : 0;
        const dtSeconds = trailPoint ? Math.max((now - trailPoint.time) / 1000, 0.008) : 0.008;
        if (now - lastTrail > 65) {
          const pulseX = trailPoint ? (x + trailPoint.x) / 2 : x;
          const pulseY = trailPoint ? (y + trailPoint.y) / 2 : y;
          pulse(state, pulseX, pulseY, "trail", {distance, dtSeconds}); lastTrail = now;
        }
        trailPoint = {x, y, time:now};
      });
    }, { passive:true });
    document.addEventListener("pointerdown", event => {
      const state = surface(event.target); if (!state) return;
      pulse(state, event.clientX - state.rect.left, event.clientY - state.rect.top, "ripple");
    }, { passive:true });
    // Keep a lens for the lifetime of its target, including idle hover. Cleanup
    // follows real boundaries rather than a timer that mutates focused controls.
    document.addEventListener("pointerout", event => { if (!event.relatedTarget) clear(); }, { passive:true });
    document.addEventListener("focusout", event => { if (active?.target === event.target && event.relatedTarget !== event.target) clear(); });
    document.addEventListener("close", event => { if (event.target.contains(active?.lens)) clear(); }, true);
    window.addEventListener("blur", clear);
    document.addEventListener("scroll", clear, { capture:true, passive:true });
    document.addEventListener("visibilitychange", releaseRenderer);
    function refreshPerformance() { updatePerformance(); releaseRenderer(); }
    window.addEventListener("resize", refreshPerformance);
    compact.addEventListener("change", refreshPerformance);
    forced.addEventListener("change", () => { settleDialogAnimations(); releaseRenderer(); });
    reduced.addEventListener("change", () => { settleDialogAnimations(); releaseRenderer(); });
    window.addEventListener("pagehide", releaseRenderer);
    sync();
  });
})();
