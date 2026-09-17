import {
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	TFile,
	finishRenderMath,
	parseLinktext,
	renderMath,
} from "obsidian";
import type ObsidianEquationRefs from "./main";
import type { IndexedEquation } from "./equation-index";
import { insertTagInMathText } from "./tag-injection";

/** Markdown post-processor: numbers display math and rewrites internal-link labels for equation refs. */
export function createReadingViewPostProcessor(plugin: ObsidianEquationRefs) {
	return (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
		const sourceFile = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
		if (!(sourceFile instanceof TFile)) return;

		// Display math: number every top-level rendered math container we find.
		const mathContainers = el.querySelectorAll<HTMLElement>('mjx-container.MathJax[display="true"]');
		for (const container of Array.from(mathContainers)) {
			ctx.addChild(new EquationNumberChild(container, plugin, sourceFile, ctx));
		}

		// Internal links: rewrite labels for any link that points at an indexed equation.
		const links = el.querySelectorAll<HTMLAnchorElement>("a.internal-link");
		for (const link of Array.from(links)) {
			ctx.addChild(new EquationLinkChild(link, plugin, sourceFile));
		}

		void finishRenderMath();
	};
}

/**
 * Lives for the lifetime of a single rendered math container. On index updates it re-injects
 * the latest `\tag{...}` into the math source and re-renders via MathJax.
 */
class EquationNumberChild extends MarkdownRenderChild {
	private lastApplied: string | null = null;
	private sourceMathText: string | null = null;

	constructor(
		containerEl: HTMLElement,
		private readonly plugin: ObsidianEquationRefs,
		private readonly file: TFile,
		private readonly ctx: MarkdownPostProcessorContext,
	) {
		super(containerEl);
	}

	override onload(): void {
		this.registerEvent(
			this.plugin.equationIndex.on("index-changed", (filePath) => {
				if (filePath === this.file.path || filePath === "<all>") this.update();
			}),
		);
		this.registerEvent(
			this.plugin.equationIndex.on("index-ready", () => this.update()),
		);
		this.update();
	}

	private update(): void {
		// Obsidian post-processes new sections before attaching them and detaches
		// offscreen sections for reuse. Their render children remain loaded, so
		// connectivity cannot determine whether a numbering update is needed.

		const equation = this.resolveEquation();
		if (!equation || equation.numberLabel === null) {
			this.clearTag();
			return;
		}

		const tagged = insertTagInMathText(equation.mathText, equation.numberLabel, this.plugin.settings.lineByLine);

		// Dedupe on the exact tagged source: this also re-renders when the equation body
		// changes while its number stays the same (e.g. an external edit to the file).
		if (this.lastApplied === tagged) return;

		try {
			const rendered = renderMath(tagged, true);
			this.containerEl.replaceChildren(...Array.from(rendered.childNodes));
			this.containerEl.setAttribute("data-equation-number", equation.numberLabel);
			void finishRenderMath();
			this.lastApplied = tagged;
		} catch (err) {
			console.warn("[obsidian-equation-refs] failed to render numbered equation", err);
		}
	}

	private clearTag(): void {
		if (this.lastApplied === null) return;
		this.lastApplied = null;
		this.containerEl.removeAttribute("data-equation-number");
	}

	private resolveEquation(): IndexedEquation | undefined {
		const section = this.ctx.getSectionInfo(this.containerEl);
		if (!section) return undefined;
		// Keep this rendered section's identity: the context's full text can advance
		// to a new revision before Obsidian retires the old math DOM.
		if (this.sourceMathText === null) {
			const source = section.text.split("\n").slice(section.lineStart, section.lineEnd + 1).join("\n");
			this.sourceMathText = source.match(/\$\$([\s\S]*?)\$\$/)?.[1]?.trim() ?? null;
		}
		const equation = this.plugin.equationIndex.getByLine(this.file.path, section.lineStart);
		return equation && equation.mathText === this.sourceMathText ? equation : undefined;
	}
}

/**
 * Replaces the text inside an internal wiki-link with the equation's reference label
 * (e.g. "Eq. 1.3") when the link points at an indexed display-math block.
 */
class EquationLinkChild extends MarkdownRenderChild {
	private originalText: string | null = null;
	private appliedLabel: string | null = null;

	constructor(
		private readonly linkEl: HTMLAnchorElement,
		private readonly plugin: ObsidianEquationRefs,
		private readonly sourceFile: TFile,
	) {
		super(linkEl);
	}

	override onload(): void {
		this.registerEvent(
			this.plugin.equationIndex.on("index-changed", () => this.update()),
		);
		this.registerEvent(
			this.plugin.equationIndex.on("index-ready", () => this.update()),
		);
		this.update();
	}

	override onunload(): void {
		this.restore();
	}

	private update(): void {
		const target = resolveEquationLink(this.plugin, this.linkEl, this.sourceFile);
		if (!target || target.refLabel === null) {
			this.restore();
			return;
		}

		if (this.appliedLabel === target.refLabel) return;
		if (this.originalText === null) this.originalText = this.linkEl.textContent ?? "";
		this.linkEl.textContent = target.refLabel;
		this.appliedLabel = target.refLabel;
	}

	private restore(): void {
		if (this.originalText !== null && this.appliedLabel !== null) {
			this.linkEl.textContent = this.originalText;
			this.appliedLabel = null;
		}
	}
}

/** Resolve an `<a class="internal-link">` to an indexed equation (or return undefined). */
export function resolveEquationLink(
	plugin: ObsidianEquationRefs,
	linkEl: HTMLElement,
	sourceFile: TFile,
): IndexedEquation | undefined {
	const linktext = linkEl.getAttribute("data-href") ?? linkEl.getAttribute("href");
	if (!linktext) return undefined;
	return resolveEquationByLinktext(plugin, linktext, sourceFile);
}

/** Resolve a raw link target (e.g. "note#^id") to an indexed equation (or return undefined). */
export function resolveEquationByLinktext(
	plugin: ObsidianEquationRefs,
	linktext: string,
	sourceFile: TFile,
): IndexedEquation | undefined {
	const { path, subpath } = parseLinktext(linktext);
	if (!subpath?.startsWith("#^")) return undefined;
	const blockId = subpath.slice(2);
	if (!blockId) return undefined;

	const targetFile = path
		? plugin.app.metadataCache.getFirstLinkpathDest(path, sourceFile.path)
		: sourceFile;
	if (!(targetFile instanceof TFile)) return undefined;

	return plugin.equationIndex.getByBlockId(targetFile.path, blockId);
}
