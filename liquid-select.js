/* Progressive select enhancement. Native controls remain the form data source. */
(() => {
  'use strict';
  const start = () => {
    const controls = new Map();
    let serial = 0, opened = null, scheduled = false;
    const liquid = () => document.documentElement.dataset.skin === 'liquid';
    const eligible = select => !select.multiple && select.size <= 1;
    const disabled = option => option.disabled || option.parentElement?.disabled;
    function close() {
      if (!opened) return;
      const state = opened; opened = null;
      if (typeof state.menu.hidePopover === 'function' && state.menu.matches(':popover-open')) state.menu.hidePopover();
      state.menu.hidden = true;
      state.trigger.setAttribute('aria-expanded', 'false');
      state.trigger.removeAttribute('aria-activedescendant');
    }
    function place(state) {
      const rect = state.trigger.getBoundingClientRect();
      const height = Math.min(320, Math.max(100, innerHeight - 24));
      const below = innerHeight - rect.bottom - 12;
      state.menu.style.width = `${Math.min(Math.max(rect.width, 180), innerWidth - 24)}px`;
      state.menu.style.maxHeight = `${Math.min(height, Math.max(below, rect.top - 12))}px`;
      state.menu.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - state.menu.offsetWidth - 12))}px`;
      state.menu.style.top = `${below >= Math.min(height, state.menu.scrollHeight) ? rect.bottom + 6 : Math.max(12, rect.top - state.menu.offsetHeight - 6)}px`;
    }
    function highlight(state, index) {
      state.active = index;
      state.menu.querySelectorAll('[role="option"]').forEach(node => {
        node.classList.toggle('is-active', Number(node.dataset.index) === index);
      });
      const node = state.menu.querySelector(`[data-index="${index}"]`);
      if (node) {
        state.trigger.setAttribute('aria-activedescendant', node.id);
        node.scrollIntoView({ block: 'nearest' });
      }
    }
    function open(state) {
      sync(state);
      if (state.trigger.disabled) return;
      close(); opened = state;
      state.menu.hidden = false;
      if (typeof state.menu.showPopover === 'function') state.menu.showPopover();
      state.trigger.setAttribute('aria-expanded', 'true');
      place(state);
      highlight(state, state.select.selectedIndex);
    }
    function choose(state, index) {
      const option = state.select.options[index];
      if (!option || disabled(option) || option.hidden) return;
      const changed = state.select.selectedIndex !== index;
      state.select.selectedIndex = index;
      close(); state.trigger.focus();
      if (changed) {
        state.select.dispatchEvent(new Event('input', { bubbles: true }));
        state.select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      sync(state);
    }
    function sync(state) {
      const { select, trigger, menu } = state;
      trigger.disabled = select.matches(':disabled');
      trigger.hidden = select.hidden;
      trigger.setAttribute('aria-required', String(select.required));
      trigger.setAttribute('aria-invalid', select.getAttribute('aria-invalid') || String(!select.validity.valid));
      const label = select.getAttribute('aria-label') || [...select.labels || []].map(node => {
        const clone = node.cloneNode(true);
        clone.querySelectorAll('select,button,.liquid-select-menu').forEach(child => child.remove());
        return clone.textContent.trim();
      }).join(' ') || select.title || select.name || '选择选项';
      trigger.setAttribute('aria-label', label);
      for (const attr of ['aria-labelledby', 'aria-describedby']) {
        if (select.hasAttribute(attr)) trigger.setAttribute(attr, select.getAttribute(attr));
        else trigger.removeAttribute(attr);
      }
      const text = select.selectedOptions[0]?.label || '请选择';
      if (state.text.textContent !== text) state.text.textContent = text;
      const signature = JSON.stringify([...select.options].map(option => [option.label, option.value, option.selected, !!disabled(option), option.hidden, option.parentElement?.label]));
      if (state.signature !== signature) {
        state.signature = signature;
        menu.replaceChildren();
        let group = null;
        [...select.options].forEach((option, index) => {
          if (option.hidden) return;
          const groupName = option.parentElement.tagName === 'OPTGROUP' ? option.parentElement.label : null;
          if (groupName && groupName !== group) {
            const heading = document.createElement('div');
            heading.className = 'liquid-select-group'; heading.textContent = groupName;
            heading.setAttribute('role', 'presentation'); menu.append(heading);
          }
          group = groupName;
          const node = document.createElement('div');
          node.className = 'liquid-select-option'; node.id = `${menu.id}-${index}`;
          node.dataset.index = index; node.setAttribute('role', 'option');
          node.setAttribute('aria-selected', String(option.selected));
          node.setAttribute('aria-disabled', String(!!disabled(option)));
          node.textContent = option.label; menu.append(node);
        });
        if (opened === state) { place(state); highlight(state, select.selectedIndex); }
      }
      if (opened === state && (trigger.disabled || !trigger.getClientRects().length)) close();
    }
    function attach(select) {
      const trigger = document.createElement('button');
      trigger.type = 'button'; trigger.className = 'liquid-select-trigger';
      trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');
      const text = document.createElement('span'); text.className = 'liquid-select-value'; trigger.append(text);
      const menu = document.createElement('div');
      menu.className = 'liquid-select-menu'; menu.id = `liquid-select-${++serial}`;
      menu.setAttribute('role', 'listbox'); menu.hidden = true;
      if (typeof menu.showPopover === 'function') menu.setAttribute('popover', 'manual');
      // Inside the owning dialog keeps the list in its accessible modal subtree;
      // popover puts it in the top layer, beyond the dialog's scroll clipping.
      (select.closest('dialog') || document.body).append(menu);
      trigger.setAttribute('aria-controls', menu.id);
      const state = { select, trigger, text, menu, active: -1, signature: null, oldTab: select.getAttribute('tabindex'), oldAria: select.getAttribute('aria-hidden') };
      controls.set(select, state);
      select.classList.add('liquid-select-native');
      select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
      select.after(trigger);
      trigger.addEventListener('click', () => opened === state ? close() : open(state));
      menu.addEventListener('pointerdown', event => event.preventDefault());
      menu.addEventListener('click', event => {
        const node = event.target.closest('[role="option"]');
        if (node) choose(state, Number(node.dataset.index));
      });
      let query = '', typedAt = 0;
      trigger.addEventListener('keydown', event => {
        const options = [...select.options].map((option, index) => ({ option, index })).filter(({ option }) => !disabled(option) && !option.hidden);
        if (event.key === 'Tab' || event.key === 'Escape') { close(); if (event.key === 'Escape') event.preventDefault(); return; }
        if (event.key === 'Enter' || (event.key === ' ' && performance.now() - typedAt > 700)) {
          event.preventDefault(); if (opened === state) choose(state, state.active); else open(state); return;
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); if (opened !== state) open(state);
          let index = options.findIndex(item => item.index === state.active);
          if (event.key === 'Home') index = 0;
          else if (event.key === 'End') index = options.length - 1;
          else index = Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
          if (options[index]) highlight(state, options[index].index);
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          const now = performance.now(); query = now - typedAt > 700 ? event.key : query + event.key; typedAt = now;
          if (opened !== state) open(state);
          const search = [...query].every(char => char === query[0]) ? query[0] : query;
          const offset = options.findIndex(item => item.index === state.active) + (search.length === 1 ? 1 : 0);
          const ordered = options.slice(offset).concat(options.slice(0, offset));
          const found = ordered.find(({ option }) => option.label.toLocaleLowerCase().startsWith(search.toLocaleLowerCase()));
          if (found) highlight(state, found.index);
        }
      });
      state.invalid = event => { event.preventDefault(); trigger.focus(); trigger.setAttribute('aria-invalid', 'true'); };
      state.focus = () => trigger.focus();
      select.addEventListener('invalid', state.invalid);
      select.addEventListener('focus', state.focus);
      sync(state);
    }
    function detach(state) {
      if (opened === state) close();
      const focused = document.activeElement === state.trigger;
      state.trigger.remove(); state.menu.remove();
      state.select.classList.remove('liquid-select-native');
      for (const [attr, value] of [['tabindex', state.oldTab], ['aria-hidden', state.oldAria]]) {
        if (value === null) state.select.removeAttribute(attr); else state.select.setAttribute(attr, value);
      }
      state.select.removeEventListener('invalid', state.invalid);
      state.select.removeEventListener('focus', state.focus);
      controls.delete(state.select);
      if (focused && state.select.isConnected) state.select.focus();
    }
    function reconcile() {
      scheduled = false;
      controls.forEach(state => { if (!liquid() || !state.select.isConnected || !eligible(state.select)) detach(state); });
      if (!liquid()) return;
      document.querySelectorAll('select').forEach(select => { if (eligible(select) && !controls.has(select)) attach(select); });
      controls.forEach(sync);
    }
    const schedule = () => { if (!scheduled) { scheduled = true; queueMicrotask(reconcile); } };
    const containsSelect = node => node instanceof Element && (node.matches('select') || !!node.querySelector('select'));
    new MutationObserver(records => {
      if (records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (!target || target.closest('.liquid-select-trigger,.liquid-select-menu,.liquid-lens')) return false;
        if (target.closest('select')) return true;
        if (record.type === 'attributes') return (target === document.documentElement && record.attributeName === 'data-skin') || (['disabled', 'hidden', 'open'].includes(record.attributeName) && containsSelect(target));
        return record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(containsSelect);
      })) schedule();
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-skin', 'disabled', 'required', 'hidden', 'multiple', 'size', 'selected', 'value', 'label', 'open', 'aria-label', 'aria-labelledby', 'aria-describedby'] });
    document.addEventListener('change', event => { if (event.target instanceof HTMLSelectElement) schedule(); });
    document.addEventListener('input', event => { if (event.target instanceof HTMLSelectElement) schedule(); });
    document.addEventListener('reset', () => setTimeout(reconcile, 0));
    document.addEventListener('pointerdown', event => { if (opened && !opened.trigger.contains(event.target) && !opened.menu.contains(event.target)) close(); }, true);
    document.addEventListener('focusin', event => { if (opened && !opened.trigger.contains(event.target) && !opened.menu.contains(event.target)) close(); });
    document.addEventListener('scroll', event => { if (opened && !opened.menu.contains(event.target)) place(opened); }, true);
    window.addEventListener('resize', () => { if (opened) place(opened); });
    // Programmatic .value assignments emit no DOM event. Visible controls are
    // sampled without modifying browser prototypes or business code.
    setInterval(() => { if (liquid() && !document.hidden) controls.forEach(state => { if (state.trigger.getClientRects().length) sync(state); }); }, 150);
    reconcile();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
