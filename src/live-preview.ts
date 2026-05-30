import { syntaxTree } from "@codemirror/language";
import { Extension, RangeSetBuilder, StateEffect } from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView,
	PluginValue,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import { MarkdownView, TFile, editorInfoField, finishRenderMath, renderMath } from "obsidian";
import type ObsidianEquationRefs from "./main";
import { insertTagInMathText } from "./tag-injection";
import { resolveEquationByLinktext } from "./reading-view";

const indexChangedEffect = StateEffect.define<null>();

/**
 * Live-preview support: a DOM-scanning plugin that numbers rendered display math, plus a
 * decoration plugin that swaps `[[note#^id]]` link text for the equation's reference label.
 * Both react to index updates via a dispatched effect, since the index lives outside the editor.
 */
export function createLivePreviewExtension(plugin: ObsidianEquationRefs): Extension {
	plugin.registerEvent(
		plugin.equationIndex.on("index-changed", () => {
			plugin.app.workspace.iterateAllLeaves((leaf) => {
				if (leaf.view instanceof MarkdownView && leaf.view.getMode() === "source") {
					const cm = (leaf.view.editor as unknown as { cm?: EditorView }).cm;
					cm?.dispatch({ effects: indexChangedEffect.of(null) });
				}
			});
		}),
	);

	return [equationNumberPlugin(plugin), linkLabelPlugin(plugin)];
}

/** DOM-scanning plugin that injects `\tag{...}` into rendered display math. */
function equationNumberPlugin(plugin: ObsidianEquationRefs) {
	return ViewPlugin.fromClass(
		class implements PluginValue {
			file: TFile | null;

			constructor(view: EditorView) {
				this.file = view.state.field(editorInfoField).file;
				queueMicrotask(() => this.apply(view));
			}

			update(update: ViewUpdate): void {
				const bumped = update.transactions.some((tr) =>
					tr.effects.some((effect) => effect.is(indexChangedEffect)),
				);
				if (bumped || update.docChanged || update.viewportChanged || update.geometryChanged) {
					this.file = update.state.field(editorInfoField).file;
					this.apply(update.view);
				}
			}

			destroy(): void {
				void finishRenderMath();
			}

			private apply(view: EditorView): void {
				if (!this.file) return;
				const file = this.file;
				try {
					const containers = view.contentDOM.querySelectorAll<HTMLElement>(
						':scope > .cm-embed-block.math > mjx-container.MathJax[display="true"]',
					);

					for (const container of Array.from(containers)) {
						if (isMathBlockBeingEdited(container)) continue;

						const lineNumber = lineNumberForElement(view, container);
						if (lineNumber === null) continue;

						const equation = plugin.equationIndex.getByLine(file.path, lineNumber);
						const label = equation?.numberLabel ?? null;
						if (label === null) {
							container.removeAttribute("data-equation-number");
							container.removeAttribute("data-eqr-rendered");
							continue;
						}

						const tagged = insertTagInMathText(equation!.mathText, label, plugin.settings.lineByLine);
						// Dedupe on the exact tagged source rather than the label alone, so a changed
						// equation body re-renders even when its number is unchanged.
						if (container.getAttribute("data-eqr-rendered") === tagged) continue;

						const rendered = renderMath(tagged, true);
						container.replaceChildren(...Array.from(rendered.childNodes));
						container.setAttribute("data-equation-number", label);
						container.setAttribute("data-eqr-rendered", tagged);
					}

					void finishRenderMath();
				} catch (err) {
					console.warn("[obsidian-equation-refs] live-preview equation numbering failed", err);
				}
			}
		},
	);
}

/** Widget rendering the resolved reference label (e.g. "Eq. 1.3") in place of a wiki link. */
class EquationLabelWidget extends WidgetType {
	constructor(private readonly label: string) {
		super();
	}

	override eq(other: EquationLabelWidget): boolean {
		return other.label === this.label;
	}

	override toDOM(): HTMLElement {
		const span = document.createElement("span");
		span.addClass("cm-underline");
		span.setText(this.label);
		return span;
	}

	override ignoreEvent(): boolean {
		return false;
	}
}

/** Decoration plugin that replaces equation links with their label, unless the cursor is inside. */
function linkLabelPlugin(plugin: ObsidianEquationRefs) {
	return ViewPlugin.fromClass(
		class implements PluginValue {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = this.build(view);
			}

			update(update: ViewUpdate): void {
				const bumped = update.transactions.some((tr) =>
					tr.effects.some((effect) => effect.is(indexChangedEffect)),
				);
				if (bumped || update.docChanged || update.viewportChanged || update.selectionSet) {
					this.decorations = this.build(update.view);
				}
			}

			private build(view: EditorView): DecorationSet {
				const builder = new RangeSetBuilder<Decoration>();
				const file = view.state.field(editorInfoField).file;
				if (!file) return builder.finish();

				try {
					for (const link of findInternalLinks(view)) {
						if (selectionTouches(view, link.from, link.to)) continue;

						const equation = resolveEquationByLinktext(plugin, link.text, file);
						if (!equation || equation.refLabel === null) continue;

						builder.add(
							link.from,
							link.to,
							Decoration.replace({ widget: new EquationLabelWidget(equation.refLabel) }),
						);
					}
				} catch (err) {
					console.warn("[obsidian-equation-refs] live-preview link labels failed", err);
					return builder.finish();
				}

				return builder.finish();
			}
		},
		{
			decorations: (value) => value.decorations,
			provide: (pluginInstance) =>
				EditorView.atomicRanges.of((view) => view.plugin(pluginInstance)?.decorations ?? Decoration.none),
		},
	);
}

interface InternalLink {
	from: number;
	to: number;
	text: string;
}

/** Walk the syntax tree over the visible ranges and collect complete `[[...]]` internal links. */
function findInternalLinks(view: EditorView): InternalLink[] {
	const links: InternalLink[] = [];
	let start = -1;

	for (const { from, to } of view.visibleRanges) {
		syntaxTree(view.state).iterate({
			from,
			to,
			enter: (node) => {
				const name = node.type.name;
				if (name.includes("formatting-link-start")) {
					start = node.from;
				} else if (name.includes("formatting-link-end") && start >= 0) {
					const linkFrom = start;
					const linkTo = node.to;
					start = -1;
					// Inner text excludes the surrounding `[[` and `]]`.
					const inner = view.state.sliceDoc(linkFrom + 2, linkTo - 2);
					const target = inner.split("|", 1)[0] ?? inner;
					links.push({ from: linkFrom, to: linkTo, text: target });
				}
			},
		});
	}

	return links;
}

/** True if any selection range overlaps [from, to]. */
function selectionTouches(view: EditorView, from: number, to: number): boolean {
	return view.state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/** Best-effort: map a DOM element back to a 0-based source line in the editor's document. */
function lineNumberForElement(view: EditorView, el: HTMLElement): number | null {
	try {
		const pos = view.posAtDOM(el);
		return view.state.doc.lineAt(pos).number - 1;
	} catch {
		return null;
	}
}

/** True if MathJax in the editor is currently mid-edit (closing `$$` formatting still visible). */
function isMathBlockBeingEdited(container: HTMLElement): boolean {
	const previous = container.parentElement?.previousElementSibling;
	if (!(previous instanceof HTMLElement)) return false;
	const last = previous.lastElementChild;
	if (!(last instanceof HTMLElement)) return false;
	return last.matches("span.cm-formatting-math-end");
}
