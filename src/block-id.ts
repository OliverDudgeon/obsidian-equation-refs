import { App, Editor, TFile } from "obsidian";

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

export interface BlockIdResult {
	/** The block id without the leading `^`. */
	id: string;
	/** True when the id had to be created and inserted into the document. */
	created: boolean;
}

/**
 * Locate the block under the cursor and return its block id, creating and inserting one
 * if the block doesn't already have it. Returns null when the cursor isn't inside a block.
 */
export function ensureBlockIdAtCursor(app: App, editor: Editor, file: TFile): BlockIdResult | null {
	const cache = app.metadataCache.getFileCache(file);
	if (!cache?.sections) return null;

	const line = editor.getCursor().line;
	const section = cache.sections.find(
		(s) => line >= s.position.start.line && line <= s.position.end.line,
	);
	if (!section) return null;

	if (section.id) return { id: section.id, created: false };

	const id = generateBlockId(section.type, cache.blocks);
	insertBlockId(editor, section.position.end.line, id);
	return { id, created: true };
}

/** Pick an id that isn't already used in the file: `eq-N` for math blocks, otherwise random. */
function generateBlockId(type: string, blocks: Record<string, unknown> | undefined): string {
	const existing = new Set(Object.keys(blocks ?? {}));

	if (type === "math") {
		for (let n = 1; ; n++) {
			const id = `eq-${n}`;
			if (!existing.has(id)) return id;
		}
	}

	let id: string;
	do {
		id = randomId(6);
	} while (existing.has(id));
	return id;
}

/** Append `^id` on its own line after the block, keeping a blank line before any following content. */
function insertBlockId(editor: Editor, endLine: number, id: string): void {
	const endLineText = editor.getLine(endLine);
	const insertPos = { line: endLine, ch: endLineText.length };

	const lastLine = editor.lastLine();
	const nextLineText = endLine < lastLine ? editor.getLine(endLine + 1) : "";
	const needsBlank = nextLineText.trim().length > 0;

	editor.replaceRange(needsBlank ? `\n^${id}\n` : `\n^${id}`, insertPos);
}

function randomId(length: number): string {
	let out = "";
	for (let i = 0; i < length; i++) {
		out += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
	}
	return out;
}
