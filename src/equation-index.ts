import { Component, Events, TAbstractFile, TFile, debounce } from "obsidian";
import type ObsidianEquationRefs from "./main";
import { formatNumberLabel, formatRefLabel } from "./numbering";
import { hasManualTag } from "./tag-injection";

export interface IndexedEquation {
	/** Source file path. */
	filePath: string;
	/** Block id if present (the `^id` suffix), otherwise null. */
	blockId: string | null;
	/** 0-based inclusive start line of the `$$` opener in the source file. */
	startLine: number;
	/** 0-based inclusive end line of the `$$` closer in the source file. */
	endLine: number;
	/** Math source between the `$$` delimiters, with delimiters trimmed. */
	mathText: string;
	/** True if the math source already includes a manual `\tag{...}`. */
	manualTag: boolean;
	/** Numeric label e.g. "1.3", or null when the equation is excluded from numbering. */
	numberLabel: string | null;
	/** Cross-reference label e.g. "Eq. 1.3", or null when no auto-number was assigned. */
	refLabel: string | null;
}

/** Internal event payloads. */
interface EquationIndexEventMap {
	"index-changed": [filePath: string];
	"index-ready": [];
}

/**
 * Tracks every display math block in the vault and computes auto-assigned numbers.
 *
 * The index listens to Obsidian's metadata cache for incremental updates and falls back
 * to scanning every markdown file once at startup. There is no web worker — display
 * math blocks are cheap to parse synchronously.
 */
export class EquationIndex extends Component {
	private readonly perFile = new Map<string, IndexedEquation[]>();
	private readonly events = new Events();
	private readyResolver: (() => void) | null = null;
	private readyPromise: Promise<void> = new Promise((resolve) => {
		this.readyResolver = resolve;
	});

	private readonly emitChanged = debounce(
		(filePath: string) => {
			this.events.trigger("index-changed", filePath);
		},
		150,
		false,
	);

	constructor(private readonly plugin: ObsidianEquationRefs) {
		super();
	}

	override onload(): void {
		const { app } = this.plugin;

		this.registerEvent(
			app.metadataCache.on("changed", (file) => {
				this.indexFile(file).catch((err) => this.logFailure(file.path, err));
			}),
		);

		this.registerEvent(
			app.vault.on("delete", (file) => this.handleDelete(file)),
		);

		this.registerEvent(
			app.vault.on("rename", (file, oldPath) => {
				if (this.perFile.has(oldPath)) {
					const entries = this.perFile.get(oldPath);
					this.perFile.delete(oldPath);
					if (entries && file instanceof TFile) {
						const moved = entries.map((entry) => ({ ...entry, filePath: file.path }));
						this.perFile.set(file.path, moved);
					}
					this.emitChanged(oldPath);
				}
				if (file instanceof TFile) {
					this.indexFile(file).catch((err) => this.logFailure(file.path, err));
				}
			}),
		);

		// Initial scan once the layout is ready; metadata cache is reliable by then.
		app.workspace.onLayoutReady(() => {
			this.indexAll()
				.catch((err) => this.logFailure("<all>", err))
				.finally(() => {
					this.readyResolver?.();
					this.readyResolver = null;
					this.events.trigger("index-ready");
				});
		});
	}

	override onunload(): void {
		this.perFile.clear();
	}

	/** Resolves once the initial vault scan completes. */
	whenReady(): Promise<void> {
		return this.readyPromise;
	}

	/** Re-index a single markdown file. */
	async indexFile(file: TFile): Promise<void> {
		if (file.extension !== "md") return;

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const mathSections = cache?.sections?.filter((section) => section.type === "math") ?? [];

		if (mathSections.length === 0) {
			if (this.perFile.delete(file.path)) this.emitChanged(file.path);
			return;
		}

		let content: string;
		try {
			content = await this.plugin.app.vault.cachedRead(file);
		} catch (err) {
			this.logFailure(file.path, err);
			return;
		}

		const entries: IndexedEquation[] = [];
		let ordinal = this.plugin.settings.numberInit;

		for (const section of mathSections) {
			const startOffset = section.position.start.offset;
			const endOffset = section.position.end.offset;
			const raw = content.slice(startOffset, endOffset);
			const mathText = stripDollarDelimiters(raw);
			const manualTag = hasManualTag(mathText);
			const blockId = section.id ?? null;

			const entry: IndexedEquation = {
				filePath: file.path,
				blockId,
				startLine: section.position.start.line,
				endLine: section.position.end.line,
				mathText,
				manualTag,
				numberLabel: null,
				refLabel: null,
			};

			if (!manualTag) {
				const numberLabel = formatNumberLabel(ordinal++, this.plugin.settings);
				entry.numberLabel = numberLabel;
				entry.refLabel = formatRefLabel(numberLabel, this.plugin.settings);
			}

			entries.push(entry);
		}

		this.perFile.set(file.path, entries);
		this.emitChanged(file.path);
	}

	/** Re-index every markdown file in the vault. */
	async indexAll(): Promise<void> {
		const files = this.plugin.app.vault.getMarkdownFiles();
		await Promise.all(files.map((file) => this.indexFile(file).catch((err) => this.logFailure(file.path, err))));
	}

	/** Clear cached numbers and re-index everything; used when settings change. */
	async reindexAll(): Promise<void> {
		this.perFile.clear();
		await this.indexAll();
		this.emitChanged("<all>");
	}

	/** All indexed equations for a path. */
	getByPath(filePath: string): IndexedEquation[] {
		return this.perFile.get(filePath) ?? [];
	}

	/** Find an equation by its block id within a file. */
	getByBlockId(filePath: string, blockId: string): IndexedEquation | undefined {
		return this.perFile.get(filePath)?.find((entry) => entry.blockId === blockId);
	}

	/** Find an equation whose source spans the given 0-based line. */
	getByLine(filePath: string, line: number): IndexedEquation | undefined {
		return this.perFile
			.get(filePath)
			?.find((entry) => line >= entry.startLine && line <= entry.endLine);
	}

	on<K extends keyof EquationIndexEventMap>(
		name: K,
		callback: (...args: EquationIndexEventMap[K]) => void,
	) {
		return this.events.on(name, callback as (...data: unknown[]) => void);
	}

	private handleDelete(file: TAbstractFile): void {
		if (this.perFile.delete(file.path)) this.emitChanged(file.path);
	}

	private logFailure(scope: string, err: unknown): void {
		const message = err instanceof Error ? err.message : String(err);
		console.warn(`[obsidian-equation-refs] index update failed for ${scope}: ${message}`);
	}
}

/** Strip `$$` opening / closing fences and surrounding whitespace from a raw math section. */
function stripDollarDelimiters(raw: string): string {
	const match = raw.match(/^\s*\$\$([\s\S]*?)\$\$\s*$/);
	if (match && match[1] !== undefined) return match[1].trim();
	return raw.trim();
}
