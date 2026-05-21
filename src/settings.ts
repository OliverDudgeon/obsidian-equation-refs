import { App, PluginSettingTab, Setting } from "obsidian";
import type ObsidianEquationRefs from "./main";

export const NUMBER_STYLES = ["arabic", "alph", "Alph", "roman", "Roman"] as const;
export type NumberStyle = typeof NUMBER_STYLES[number];

export interface EquationRefsSettings {
	/** Prefix prepended to the rendered equation number, e.g. "1." in "1.3". */
	numberPrefix: string;
	/** Suffix appended to the rendered equation number. */
	numberSuffix: string;
	/** First equation in a note is numbered as this value. */
	numberInit: number;
	/** Style for the auto-generated number. */
	numberStyle: NumberStyle;
	/** Prefix used in cross-reference link labels, e.g. "Eq. " in "Eq. 1.3". */
	refPrefix: string;
	/** Suffix used in cross-reference link labels. */
	refSuffix: string;
	/** When true, each line of an `align` environment gets its own \tag{}. */
	lineByLine: boolean;
}

export const DEFAULT_SETTINGS: EquationRefsSettings = {
	numberPrefix: "",
	numberSuffix: "",
	numberInit: 1,
	numberStyle: "arabic",
	refPrefix: "Eq. ",
	refSuffix: "",
	lineByLine: true,
};

export class EquationRefsSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ObsidianEquationRefs) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Number prefix")
			.setDesc("Text placed before every auto-generated equation number.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.numberPrefix)
					.onChange(async (value) => {
						this.plugin.settings.numberPrefix = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Number suffix")
			.setDesc("Text placed after every auto-generated equation number.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.numberSuffix)
					.onChange(async (value) => {
						this.plugin.settings.numberSuffix = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("First equation number")
			.setDesc("Counter value used for the first numbered equation in a note.")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.numberInit))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						this.plugin.settings.numberInit = Number.isFinite(parsed) ? parsed : 1;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Number style")
			.setDesc("Numeral style for auto-generated equation numbers.")
			.addDropdown((dropdown) => {
				for (const style of NUMBER_STYLES) {
					dropdown.addOption(style, style);
				}
				dropdown
					.setValue(this.plugin.settings.numberStyle)
					.onChange(async (value) => {
						this.plugin.settings.numberStyle = value as NumberStyle;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Reference prefix")
			.setDesc("Prefix on link labels that resolve to equations.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.refPrefix)
					.onChange(async (value) => {
						this.plugin.settings.refPrefix = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Reference suffix")
			.setDesc("Suffix on link labels resolved to equations.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.refSuffix)
					.onChange(async (value) => {
						this.plugin.settings.refSuffix = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Number align environments line-by-line")
			.setDesc("When enabled, each line of an `align` environment receives its own \\tag{} number.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.lineByLine)
					.onChange(async (value) => {
						this.plugin.settings.lineByLine = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
