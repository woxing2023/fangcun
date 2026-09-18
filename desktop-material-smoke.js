'use strict';
// Runs the production pointer adapter against a small DOM; no browser dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
const CLASSIC_BASELINE = Object.freeze({
  light: Object.freeze({
    bg:'#d1d1d2', ink:'#23313d', muted:'#55606a', accent:'#536575', 'accent-soft':'rgba(139,151,163,.18)',
    line:'rgba(112,121,130,.23)', surface:'rgba(242,241,239,.56)', card:'rgba(250,250,249,.40)',
    'action-fill':'rgba(153,164,176,.32)', 'action-ink':'var(--ink)', chrome:'rgba(247,248,249,.38)',
    'glass-rim':'rgba(255,255,255,.74)', 'material-blur':'blur(16px) saturate(.65)',
    'material-shadow':'inset 0 2px 3px rgba(255,255,255,.92),inset 2px 0 4px rgba(255,255,255,.38),inset 0 -3px 5px rgba(122,132,143,.16),0 2px 2px rgba(255,255,255,.28),0 8px 15px -6px rgba(45,48,50,.22)'
  }),
  dark: Object.freeze({
    bg:'#24282e', ink:'#e7e9eb', muted:'#b4bbc3', accent:'#b8c9d9', 'accent-soft':'rgba(157,179,203,.16)',
    line:'rgba(206,219,234,.17)', surface:'rgba(60,69,81,.66)', card:'rgba(96,110,128,.20)',
    'action-fill':'rgba(143,165,191,.27)', 'action-ink':'var(--ink)', chrome:'rgba(107,125,146,.18)',
    'glass-rim':'rgba(224,233,243,.19)', 'material-blur':'blur(16px) saturate(.65)',
    'material-shadow':'inset 0 1px 1px var(--glass-rim),inset 0 -1px 2px rgba(194,210,230,.04),0 5px 12px rgba(0,0,0,.12)'
  })
});
const SHARED_ROLES = ['bg','surface','card','ink','muted','accent','accent-soft','line','q1','q2','q3','q4','q1-soft','q2-soft','q3-soft','q4-soft','chrome','action-fill','action-ink','material-blur','material-shadow','paper-shadow','glass-rim','control-height','control-radius'];
const listeners = new Map(), windowListeners = new Map(), frames = new Map(), timers = new Map();
let nextFrame = 0;
class Element {
  constructor(kind = 'span', parent = null) {
    this.kind = kind; this.parentElement = parent; this.children = []; this.dataset = {}; this.disabled = false;
    this.style = { position:'', borderRadius:'', setProperty() {} }; this.className = '';
    this.classList = { contains:() => false, toggle() {} }; this.clientLeft = this.clientTop = 1;
    this.scrollLeft = 0; this.scrollTop = 30; this.animations = [];
  }
  addEventListener() {}
  setAttribute() {}
  querySelectorAll() { return []; }
  contains(node) { return Boolean(node && (node === this || this.children.some(child => child.contains(node)))); }
  get childElementCount() { return this.children.length; }
  append(node) { node.parentElement = this; this.children.push(node); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  closest(selector) {
    if (selector === 'dialog') return this.kind === 'dialog' ? this : this.parentElement?.closest(selector);
    if (selector.startsWith('[data-material="glass"]')) return this.kind === 'input' || this.kind === 'button' ? this : this.parentElement?.closest(selector);
    return null;
  }
  matches(selector) { return selector === 'input,textarea,select' && this.kind === 'input'; }
  getBoundingClientRect() { return this.kind === 'dialog' ? {left:100,top:70,width:500,height:600} : {left:130,top:120,width:180,height:44}; }
  animate() { const a = {cancel() {}}; this.animations.push(a); return a; }
}
const root = new Element(), body = new Element(), modal = new Element('dialog');
const elements = new Map([['appearanceModal',modal]]);
const doc = { documentElement:root, body, hidden:false,
  addEventListener(name, handler) { listeners.set(name, handler); },
  getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
  querySelector:() => new Element(), createElement:kind => new Element(kind) };
const context = { document:doc, Element, navigator:{}, console,
  localStorage:{getItem:key => key === 'fangcun-skin' ? 'liquid' : 'light'},
  matchMedia:() => ({matches:false, addEventListener() {}}), MutationObserver:class {observe() {}},
  getComputedStyle:() => ({position:'static',borderRadius:'14px',getPropertyValue:() => '176 190 201'}), performance:{now:() => 100},
  requestAnimationFrame:fn => { frames.set(++nextFrame, fn); return nextFrame; }, cancelAnimationFrame:id => frames.delete(id),
  setTimeout:fn => { timers.set(timers.size + 1,fn); return timers.size; }, clearTimeout:id => timers.delete(id),
  addEventListener:(name,fn) => windowListeners.set(name, fn) };
context.window = context;
vm.runInNewContext(fs.readFileSync('appearance.js','utf8'), context);
listeners.get('DOMContentLoaded')();
context.FangcunAppearance.registerRenderer(() => ({mount() {},unmount() {},dispose() {},move() {},pulse() {}}));
const input = new Element('input',modal), button = new Element('button',modal), child = new Element('span',button);
const move = target => {
  listeners.get('pointermove')({target,pointerType:'mouse',clientX:140,clientY:130});
  const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn());
};
move(input);
const lens = modal.children[0];
check(lens?.className === 'liquid-lens', 'Dialog must mount one lens');
check(lens.style.cssText.includes('pointer-events:none'), 'Proxy must never intercept input');
check(lens.style.cssText.includes('position:absolute') && lens.style.cssText.includes('left:29px;top:79px'), 'Proxy must use dialog padding-box coordinates, including scroll');
for (let i=0;i<20;i++) move(input);
check(modal.children.length === 1 && modal.children[0] === lens, 'Hover keeps the identical lens');
check(timers.size === 0, 'Idle hover must not schedule teardown');
listeners.get('pointerdown')({target:input,clientX:140,clientY:130});
check(modal.children[0] === lens && timers.size === 0, 'Pointer press keeps lens without timers');
check(input.style.position === '' && input.style.borderRadius === '', 'Dialog input geometry must remain untouched');
move(button); const buttonLens = modal.children[0]; move(child);
check(buttonLens !== lens && modal.children[0] === buttonLens && modal.children.length === 1, 'Rebuild only when the real control changes, not its descendants');
check(button.style.position === '', 'Dialog button must not become a new containing block');
listeners.get('close')({target:modal});
check(modal.children.length === 0, 'Dialog close must release lens');
move(button); windowListeners.get('blur')();
check(modal.children.length === 0, 'Window blur releases lens');
root.dataset.materialPerformance = 'touch'; move(input);
check(modal.children.length === 0, 'Touch retains its separate existing renderer');
root.dataset.materialPerformance = 'dynamic'; root.dataset.skin = 'classic'; move(input);
check(modal.children.length === 0, 'Classic must not mount liquid pointer lenses');
const css = fs.readFileSync('appearance.css','utf8'), liquid = fs.readFileSync('liquid.css','utf8');
const rendererSource = fs.readFileSync('liquid-renderer.js','utf8');
const materialDoc = fs.readFileSync('docs/touch-material.md','utf8');
const motionSources = ['appearance.css','styles.css','v22-layout.css','xuan.css','liquid.css','mobile-material.css','calendar-surface.css'].map(file => [file,fs.readFileSync(file,'utf8')]);
for (const [name,value] of Object.entries({'motion-instant':'100ms','motion-press':'120ms','motion-fast':'160ms','motion-popover':'200ms','motion-modal':'250ms','motion-drawer':'250ms','ease-fluid':'cubic-bezier(.22,1,.36,1)','ease-out':'cubic-bezier(.23,1,.32,1)','ease-in-out':'cubic-bezier(.77,0,.175,1)','ease-drawer':'cubic-bezier(.32,.72,0,1)'})) check(new RegExp(`--${name}\\s*:\\s*${value.replace(/[().]/g,'\\$&')}`).test(css), `Motion token missing: --${name}`);
for (const [file,source] of motionSources) check(!/animation:\s*reveal|coursePulse|(?:\.15s|\.18s|(?<!1)\.2s|\.22s|\.26s|(?<!1)\.3s|220ms|260ms|650ms|900ms|1100ms|14s)/.test(source), `Legacy motion value remains in ${file}`);
check(rendererSource.includes('export const LIQUID_MATERIAL_SPEC_VERSION = "2026-09-15-lab-align-v1";'), 'Renderer spec version must be frozen in source');
check(materialDoc.includes('2026-09-15-lab-align-v1'), 'Material document must carry the renderer spec version');
for (const [name, value] of Object.entries({ rippleStrength:'0.74', trailStrength:'0.10', trailDecay:'0.76', edgeStrength:'2', edgeSizeInfluence:'0.89', edgeSpread:'0.17', edgeSpeedResponse:'1.5' })) {
  check(new RegExp(`${name}:\\s*${value.replace('.', '\\.')}`).test(rendererSource), `Renderer motion constant missing: ${name}`);
  check(materialDoc.includes(`\`${value}\``), `Material document motion value missing: ${name}`);
}
check(!rendererSource.includes('176 / 255') && !rendererSource.includes('184 / 255'), 'Renderer must not hardcode two theme tint tables');
check(/export function rippleProfile\(width, height\)/.test(rendererSource), 'Renderer must export the size profile');
for (const role of SHARED_ROLES) check(new RegExp(`--${role}\\s*:`).test(css), `Shared role missing from appearance root: --${role}`);
const classic = fs.readFileSync('xuan.css','utf8');
for (const [mode, tokens] of Object.entries(CLASSIC_BASELINE)) for (const [name, value] of Object.entries(tokens)) {
  check(classic.includes(`--${name}:${value}`), `Classic ${mode} baseline missing --${name}`);
}
check(/\.liquid-lens\s*\{[^}]*pointer-events:none/.test(css) && /\.liquid-lens \*\s*\{[^}]*pointer-events:none/.test(css), 'Lens and all descendants must ignore pointer events');
check(/html\[data-material-performance="dynamic"\] body dialog :where\(\*, \*::before, \*::after\)\s*\{[^}]*backdrop-filter:none !important;[^}]*transition:none !important;/.test(css), 'Desktop descendants share the dialog blur plane without transitions');
check(/body dialog::backdrop\s*\{[^}]*backdrop-filter:none !important/.test(css), 'Desktop scrim must not introduce a second blur');
check((liquid.match(/backdrop-filter:blur\(24px\)/g) || []).length === 2, 'Single dialog recipe (standard + WebKit property), not duplicated sources');
check(/html body \.quick-add :is\(input,\.quick-input\)\s*\{[^}]*background:transparent !important; border:0 !important; box-shadow:none !important/.test(css), 'One quick-add frame in any view container');
check(!/\[data-active-view=schedule\] \.sidebar/.test(fs.readFileSync('calendar-surface.css','utf8')), 'Calendar must not override the sidebar material');
check(!/body:not\(\[data-active-view="schedule"\]\):not\(\.admin-mode\) \.(sidebar|brand|main-nav|nav-item)/.test(fs.readFileSync('xuan.css','utf8')), 'Desktop sidebar framing must be shared across views');
console.log(`Desktop material smoke passed: ${assertions} assertions (lens lifecycle, hit transparency, dialog coordinates, blur plane, quick-add and sidebar).`);
