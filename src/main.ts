import { Editor, MarkdownFileInfo, MarkdownView, Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, EquationRefsSettingTab, EquationRefsSettings } from "./settings";
import { EquationIndex } from "./equation-index";
import { createReadingViewPostProcessor } from "./reading-view";
import { createLivePreviewExtension } from "./live-preview";
import { ensureBlockIdAtCursor } from "./block-id";

export default class ObsidianEquationRefs extends Plugin {
	settings!: EquationRefsSettings;
	equationIndex!: EquationIndex;

	override async onload(): Promise<void> {
		await this.loadSettings();

		this.equationIndex = new EquationIndex(this);
		this.addChild(this.equationIndex);

		this.addSettingTab(new EquationRefsSettingTab(this.app, this));

		this.registerMarkdownPostProcessor(createReadingViewPostProcessor(this));
		this.registerEditorExtension(createLivePreviewExtension(this));

		this.addCommand({
			id: "insert-display-math",
			name: "Insert display math",
			editorCallback: (editor: Editor) => {
				const cursor = editor.getCursor();
				editor.replaceRange("$$\n\n$$", cursor);
				editor.setCursor({ line: cursor.line + 1, ch: 0 });
			},
		});

		this.addCommand({
			id: "copy-block-id",
			name: "Copy block id at cursor (create if missing)",
			editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				const file = ctx.file;
				if (!file) return;

				const result = ensureBlockIdAtCursor(this.app, editor, file);
				if (!result) {
					new Notice("No block found at the cursor.");
					return;
				}

				void navigator.clipboard.writeText(result.id);
				new Notice(
					result.created
						? `Created and copied block id: ${result.id}`
						: `Copied block id: ${result.id}`,
				);
			},
		});
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<EquationRefsSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		await this.equationIndex.reindexAll();
	}
}
