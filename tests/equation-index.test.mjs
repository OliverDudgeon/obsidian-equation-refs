import process from 'node:process';
import { Buffer } from 'node:buffer';
import { setImmediate } from 'node:timers';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
 stdin: {contents: 'export { EquationIndex } from "./src/equation-index"; export { createReadingViewPostProcessor } from "./src/reading-view"; export { TFile, flushDebounces } from "obsidian";', resolveDir: process.cwd()}, bundle: true, write: false, platform: 'node', format: 'esm',
 plugins: [{ name: 'obsidian-test-double', setup(builder) {
  builder.onResolve({filter: /^obsidian$/}, () => ({path: 'obsidian', namespace: 'test'}));
  builder.onLoad({filter: /.*/, namespace: 'test'}, () => ({contents: `
   export class Component { registerEvent() {} }
   export class MarkdownRenderChild extends Component { constructor(el) {super(); this.containerEl = el;} }
   export const renderMath = (source) => ({childNodes: [source]});
   export const finishRenderMath = () => {};
   export const parseLinktext = () => ({});
   export class Events { callbacks = new Map(); on(name, cb) { this.callbacks.set(name, [...(this.callbacks.get(name) ?? []), cb]); } trigger(name, ...args) { for (const cb of this.callbacks.get(name) ?? []) cb(...args); } }
   export class TAbstractFile {}
   export class TFile extends TAbstractFile {}
   const pending = new Set();
   export const flushDebounces = () => {for (const run of [...pending]) run();};
   export const debounce = (fn) => {
    let args;
    const run = () => {pending.delete(run); fn(...args);};
    const debounced = (...next) => {args = next; pending.add(run);};
    debounced.cancel = () => pending.delete(run);
    return debounced;
   };
  `}));
 }}],
});
const { EquationIndex, createReadingViewPostProcessor, TFile, flushDebounces } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function metadata(content) {
 const sections = [];
 for (const match of content.matchAll(/\$\$[\s\S]*?\$\$/g)) {
  const offset = match.index;
  sections.push({type: 'math', position: {
   start: {offset, line: content.slice(0, offset).split('\n').length - 1},
   end: {offset: offset + match[0].length, line: content.slice(0, offset + match[0].length).split('\n').length - 1},
  }});
 }
 return {sections};
}
function fixture(content) {
 const listeners = {};
 const state = {content, cache: metadata(content)};
 const file = Object.assign(new TFile(), {path: 'note.md', extension: 'md', stat: {mtime: 1}});
 const plugin = {settings: {numberInit: 1, numberStyle: 'arabic', numberPrefix: '', numberSuffix: '', refPrefix: 'Eq. ', refSuffix: ''}, app: {
  metadataCache: {getFileCache: () => state.cache, on: (name, cb) => {listeners[name] = cb;}},
  vault: {cachedRead: async () => state.content, on() {}}, workspace: {onLayoutReady() {}},
 }};
 const index = new EquationIndex(plugin);
 index.onload();
 return {state, file, plugin, index, listeners};
}

test('metadata changed indexes its matching source even after another external write', async () => {
 const old = '$$a=1$$\n$$b=2$$';
 const f = fixture(old);
 // Obsidian delivers metadata for old while cachedRead already sees a newer write.
 f.state.content = '$$c=3$$\n$$d=4$$';
 f.listeners.changed(f.file, old, metadata(old));
 await new Promise(resolve => setImmediate(resolve));
 assert.deepEqual(f.index.getByPath(f.file.path).map(entry => entry.mathText), ['a=1', 'b=2']);
});

test('an older in-flight read cannot overwrite a newer metadata update', async () => {
 const f = fixture('$$a=1$$');
 let release;
 f.plugin.app.vault.cachedRead = () => new Promise(resolve => {release = resolve;});
 const pending = f.index.indexFile(f.file);
 f.state.content = '$$b=2$$';
 f.state.cache = metadata(f.state.content);
 f.plugin.app.vault.cachedRead = async () => f.state.content;
 f.listeners.changed(f.file, f.state.content, f.state.cache);
 await new Promise(resolve => setImmediate(resolve));
 release('$$a=1$$');
 await pending;
 assert.equal(f.index.getByPath(f.file.path)[0].mathText, 'b=2');
});

test('removing equations invalidates an older in-flight read', async () => {
 const f = fixture('$$a=1$$');
 let release;
 f.plugin.app.vault.cachedRead = () => new Promise(resolve => {release = resolve;});
 const pending = f.index.indexFile(f.file);
 f.listeners.changed(f.file, 'No math', metadata('No math'));
 release('$$a=1$$');
 await pending;
 assert.deepEqual(f.index.getByPath(f.file.path), []);
});

test('live source at a reused line must match before applying the indexed equation', async () => {
 const f = fixture('$$a=1$$');
 await f.index.indexFile(f.file);
 assert.equal(f.index.getByLine(f.file.path, 0, '$$b=2$$'), undefined);
 assert.equal(f.index.getByLine(f.file.path, 0, '$$a=1$$')?.mathText, 'a=1');
});

test('startup read is discarded if the file changes before it completes', async () => {
 const f = fixture('$$a=1$$');
 let release;
 f.plugin.app.vault.cachedRead = () => new Promise(resolve => {release = resolve;});
 const pending = f.index.indexFile(f.file);
 f.file.stat.mtime++;
 release('$$b=2$$');
 await pending;
 assert.deepEqual(f.index.getByPath(f.file.path), []);
});

test('source verification detects equations shifted onto another equation’s previous line', async () => {
 const f = fixture('$$a=1$$\n$$b=2$$');
 await f.index.indexFile(f.file);
 assert.equal(f.index.getByLine(f.file.path, 0, '$$b=2$$'), undefined);
 assert.equal(f.index.getByLine(f.file.path, 1, '$$a=1$$\n$$b=2$$')?.mathText, 'b=2');
});

test('metadata event numbers matching equations and block references without reading the vault', () => {
 const f = fixture('$$a=1$$');
 f.plugin.app.vault.cachedRead = () => {throw new Error('must use event source');};
 const content = '$$a=1$$\n$$b=2$$';
 const cache = metadata(content);
 cache.sections[1].id = 'second';
 f.listeners.changed(f.file, content, cache);
 assert.equal(f.index.getByBlockId(f.file.path, 'second')?.mathText, 'b=2');
 assert.equal(f.index.getByBlockId(f.file.path, 'second')?.numberLabel, '2');
});

test('reading view cannot replace an old rendered equation with a different equation at its line', () => {
 const oldSource = '$$a=1$$\n$$b=2$$';
 const f = fixture(oldSource);
 f.plugin.equationIndex = f.index;
 f.plugin.app.vault.getAbstractFileByPath = () => f.file;
 f.listeners.changed(f.file, oldSource, metadata(oldSource));
 const rendered = [];
 const container = {
  isConnected: true,
  replaceChildren: (...children) => rendered.push(...children),
  setAttribute() {}, removeAttribute() {},
 };
 const el = {querySelectorAll: selector => selector.startsWith('mjx-container') ? [container] : []};
 let contextText = oldSource;
 let contextLine = 0;
 const ctx = {sourcePath: f.file.path,
  getSectionInfo: () => ({text: contextText, lineStart: contextLine, lineEnd: contextLine}),
  addChild: child => child.onload(),
 };
 createReadingViewPostProcessor(f.plugin)(el, ctx);
 assert.equal(rendered.length, 1);
 assert.match(rendered[0], /a=1/);
 // The new index arrives while Obsidian still has the old section alive.
 const newSource = '$$b=2$$';
 contextText = newSource;
 f.listeners.changed(f.file, newSource, metadata(newSource));
 flushDebounces();
 assert.equal(rendered.length, 1, 'must not replace old a=1 DOM with indexed b=2');
 // An unchanged a=1 section may be retained and moved: its number can still update.
 contextText = '$$z=0$$\n$$a=1$$';
 contextLine = 1;
 f.listeners.changed(f.file, contextText, metadata(contextText));
 flushDebounces();
 assert.equal(rendered.length, 2);
 assert.match(rendered[1], /a=1/);
 assert.match(rendered[1], /tag\{2\}/);
});

test('updates to multiple files notify every affected rendered note', () => {
 flushDebounces();
 const f = fixture('$$a=1$$');
 const notifications = [];
 f.index.on('index-changed', path => notifications.push(path));
 f.listeners.changed(f.file, '$$a=1$$', metadata('$$a=1$$'));
 const second = Object.assign(new TFile(), {path: 'second.md', extension: 'md'});
 f.listeners.changed(second, '$$b=2$$', metadata('$$b=2$$'));
 flushDebounces();
 assert.deepEqual(notifications.sort(), ['note.md', 'second.md']);
});
