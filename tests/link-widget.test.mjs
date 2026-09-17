import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const result = await build({
 stdin: {
  contents: await readFile(new URL('../src/live-preview.ts', import.meta.url), 'utf8') + '\nexport { EquationLabelWidget };',
  resolveDir: fileURLToPath(new URL('../src', import.meta.url)), loader: 'ts',
 }, bundle: true, write: false, format: 'esm', platform: 'node',
 plugins: [{ name: 'obsidian-host', setup(build) {
  build.onResolve({filter: /^obsidian$/}, () => ({path: 'obsidian', namespace: 'host'}));
  build.onLoad({filter: /.*/, namespace: 'host'}, () => ({contents: `
   export class MarkdownRenderChild {}
   export class TFile {}
   export class MarkdownView {}
   export const editorInfoField = {};
   export function finishRenderMath() {}
   export function renderMath() {}
   export function parseLinktext() {}
   export const Keymap = { isModEvent: e => e.button === 1 ? 'tab' : (e.metaKey || e.ctrlKey) ? (e.altKey ? (e.shiftKey ? 'window' : 'split') : 'tab') : false };
  `}));
 } }],
});
const { EquationLabelWidget } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
class Element extends EventTarget {
 children = [];
 attributes = new Map();
 addClass() {}
 setText(text) { this.textContent = text; }
 appendChild(child) { this.children.push(child); }
 setAttribute(name, value) { this.attributes.set(name, value); }
}
globalThis.document = { createElement: () => new Element() };
function event(type, options = {}) {
 return Object.assign(new Event(type, {cancelable: true, bubbles: true}), {button: 0, ...options});
}
function harness(target = '#^equation', source = 'folder/note.md') {
 const calls = [];
 const plugin = { app: {workspace: {openLinkText: (...args) => {calls.push(args); return Promise.resolve();}}} };
 const widget = new EquationLabelWidget('Eq. (1)', plugin, target, source);
 return { calls, widget, dom: widget.toDOM(), plugin };
}
test('pressing an equation label does not move the editor selection into its source', () => {
 const {widget, dom} = harness();
 const press = event('mousedown');
 dom.dispatchEvent(press);
 assert.equal(press.defaultPrevented, true);
 assert.equal(widget.ignoreEvent(press), true);
});
test('equation labels open their original block target relative to the source note', () => {
 const {calls, dom} = harness('Other note#^equation');
 dom.dispatchEvent(event('click'));
 assert.deepEqual(calls, [['Other note#^equation', 'folder/note.md', false]]);
});
test('modified clicks and middle clicks retain Obsidian pane selection', () => {
 for (const [type, options, pane] of [
  ['click', {metaKey: true}, 'tab'], ['click', {ctrlKey: true}, 'tab'],
  ['click', {metaKey: true, altKey: true}, 'split'],
  ['click', {metaKey: true, altKey: true, shiftKey: true}, 'window'],
  ['auxclick', {button: 1}, 'tab'],
 ]) {
  const {calls, dom} = harness(); dom.dispatchEvent(event(type, options));
  assert.deepEqual(calls, [['#^equation', 'folder/note.md', pane]]);
 }
 const {calls, dom} = harness(); dom.dispatchEvent(event('auxclick', {button: 2}));
 assert.deepEqual(calls, []);
});
test('equal labels with different targets or source notes cannot reuse stale click handlers', () => {
 const {widget, plugin} = harness();
 assert.equal(widget.eq(new EquationLabelWidget('Eq. (1)', plugin, '#^different', 'folder/note.md')), false);
 assert.equal(widget.eq(new EquationLabelWidget('Eq. (1)', plugin, '#^equation', 'another.md')), false);
 assert.equal(widget.eq(new EquationLabelWidget('Eq. (1)', plugin, '#^equation', 'folder/note.md')), true);
});
