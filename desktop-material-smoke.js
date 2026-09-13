'use strict';
// Runs the production pointer adapter against a small DOM; no browser dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
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
  getComputedStyle:() => ({position:'static',borderRadius:'14px'}), performance:{now:() => 100},
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
listeners.get('keydown')({target:input,key:'Enter'});
check(modal.children[0] === lens && timers.size === 0, 'Click and keyboard keep lens without timers');
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
check(/\.liquid-lens\s*\{[^}]*pointer-events:none/.test(css) && /\.liquid-lens \*\s*\{[^}]*pointer-events:none/.test(css), 'Lens and all descendants must ignore pointer events');
check(/html\[data-material-performance="dynamic"\] body dialog :where\(\*, \*::before, \*::after\)\s*\{[^}]*backdrop-filter:none !important;[^}]*transition:none !important;/.test(css), 'Desktop descendants share the dialog blur plane without transitions');
check(/body dialog::backdrop\s*\{[^}]*backdrop-filter:none !important/.test(css), 'Desktop scrim must not introduce a second blur');
check((liquid.match(/backdrop-filter:blur\(24px\)/g) || []).length === 2, 'Single dialog recipe (standard + WebKit property), not duplicated sources');
check(/html body \.quick-add :is\(input,\.quick-input\)\s*\{[^}]*background:transparent !important; border:0 !important; box-shadow:none !important/.test(css), 'One quick-add frame in any view container');
check(!/\[data-active-view=schedule\] \.sidebar/.test(fs.readFileSync('calendar-surface.css','utf8')), 'Calendar must not override the sidebar material');
check(!/body:not\(\[data-active-view="schedule"\]\):not\(\.admin-mode\) \.(sidebar|brand|main-nav|nav-item)/.test(fs.readFileSync('xuan.css','utf8')), 'Desktop sidebar framing must be shared across views');
console.log(`Desktop material smoke passed: ${assertions} assertions (lens lifecycle, hit transparency, dialog coordinates, blur plane, quick-add and sidebar).`);
