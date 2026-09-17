import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";

// Exercise the production postprocessor with the host's relevant lifecycle: it loads
// render children before inserting newly rendered sections into the document.
const result = await build({
	stdin: {
		contents: 'export * from "./src/reading-view"; export { TFile as TestFile } from "obsidian";',
		resolveDir: fileURLToPath(new URL("..", import.meta.url)),
		loader: "ts",
	},
	bundle: true,
	write: false,
	format: "esm",
	platform: "node",
	plugins: [{
		name: "obsidian-test-host",
		setup(build) {
			build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "host" }));
			build.onLoad({ filter: /.*/, namespace: "host" }, () => ({ contents: `
				export class TFile { path = "equations.md"; }
				export class MarkdownRenderChild {
					constructor(containerEl) { this.containerEl = containerEl; }
					registerEvent() {}
				}
				export function renderMath(source) { return { childNodes: [{ textContent: source }] }; }
				export async function finishRenderMath() {}
				export function parseLinktext() { return {}; }
			` }));
		},
	}],
});
const source = result.outputFiles[0].text;
const { createReadingViewPostProcessor, TestFile } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

function createHarness() {
	const file = new TestFile();
	const events = new Map();
	const equations = new Map([
		[0, { mathText: "a = 1", numberLabel: "1" }],
		[4, { mathText: "b = 2", numberLabel: "2" }],
	]);
	const plugin = {
		app: { vault: { getAbstractFileByPath: () => file } },
		settings: { lineByLine: false },
		equationIndex: {
			getByLine: (_, line) => equations.get(line),
			on(name, callback) {
				if (!events.has(name)) events.set(name, []);
				events.get(name).push(callback);
			},
		},
	};
	return {
		equations,
		emit: (name) => events.get(name)?.forEach((callback) => callback(file.path)),
		render(line, connected, mathText) {
			const text = [...Array(line).fill(""), "$$", mathText, "$$"].join("\n");
			const attrs = new Map();
			const container = {
				isConnected: connected,
				childNodes: [],
				setAttribute: (name, value) => attrs.set(name, value),
				getAttribute: (name) => attrs.get(name),
				removeAttribute: (name) => attrs.delete(name),
				replaceChildren(...children) { this.childNodes = children; },
			};
			createReadingViewPostProcessor(plugin)(
				{ querySelectorAll: (selector) => selector.startsWith("mjx-") ? [container] : [] },
				{
					sourcePath: file.path,
					getSectionInfo: () => ({ text, lineStart: line, lineEnd: line + 2 }),
					addChild: (child) => child.onload(),
				},
			);
			return container;
		},
	};
}

test("replacement reading sections receive equation numbers before insertion", () => {
	const host = createHarness();
	const unchanged = host.render(0, true, "a = 1");
	host.equations.set(4, { mathText: "b = 3", numberLabel: "2" });
	const updated = host.render(4, false, "b = 3");
	updated.isConnected = true;
	assert.equal(unchanged.getAttribute("data-equation-number"), "1");
	assert.equal(updated.getAttribute("data-equation-number"), "2");
	assert.equal(updated.childNodes[0].textContent, "b = 3\\tag{2}");
});

test("offscreen sections receive index changes before they reenter the document", () => {
	const host = createHarness();
	const container = host.render(4, true, "b = 2");
	container.isConnected = false;
	host.equations.set(4, { mathText: "b = 2", numberLabel: "3" });
	host.emit("index-changed");
	container.isConnected = true;
	assert.equal(container.getAttribute("data-equation-number"), "3");
	assert.equal(container.childNodes[0].textContent, "b = 2\\tag{3}");
});

test("index readiness numbers a section that is still detached", () => {
	const host = createHarness();
	host.equations.delete(4);
	const container = host.render(4, false, "b = 2");
	host.equations.set(4, { mathText: "b = 2", numberLabel: "2" });
	host.emit("index-ready");
	assert.equal(container.getAttribute("data-equation-number"), "2");
	assert.equal(container.childNodes[0].textContent, "b = 2\\tag{2}");
});

test("detached sections keep their equation identity while replacements receive numbers", () => {
	const host = createHarness();
	const previous = host.render(4, false, "b = 2");
	assert.equal(previous.getAttribute("data-equation-number"), "2");
	host.equations.set(4, { mathText: "c = 3", numberLabel: "2" });
	host.emit("index-changed");
	assert.equal(previous.childNodes[0].textContent, "b = 2\\tag{2}");
	const replacement = host.render(4, false, "c = 3");
	assert.equal(replacement.getAttribute("data-equation-number"), "2");
	assert.equal(replacement.childNodes[0].textContent, "c = 3\\tag{2}");
});
