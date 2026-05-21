import type { EquationRefsSettings, NumberStyle } from "./settings";

/** Convert a 1-based ordinal to the requested numeral style. */
export function formatNumeral(value: number, style: NumberStyle): string {
	if (!Number.isFinite(value) || value < 1) return String(value);
	switch (style) {
		case "arabic":
			return String(value);
		case "alph":
			return toAlpha(value).toLowerCase();
		case "Alph":
			return toAlpha(value);
		case "roman":
			return toRoman(value).toLowerCase();
		case "Roman":
			return toRoman(value);
	}
}

/** Format a label like "1.3" with the user's prefix / suffix wrapped around the numeral. */
export function formatNumberLabel(ordinal: number, settings: EquationRefsSettings): string {
	const numeral = formatNumeral(ordinal, settings.numberStyle);
	return `${settings.numberPrefix}${numeral}${settings.numberSuffix}`;
}

/** Format the link-label form, e.g. "Eq. 1.3". */
export function formatRefLabel(numberLabel: string, settings: EquationRefsSettings): string {
	return `${settings.refPrefix}${numberLabel}${settings.refSuffix}`;
}

function toAlpha(value: number): string {
	// 1 -> A, 26 -> Z, 27 -> AA, ...
	let n = value;
	let out = "";
	while (n > 0) {
		const rem = (n - 1) % 26;
		out = String.fromCharCode(65 + rem) + out;
		n = Math.floor((n - 1) / 26);
	}
	return out;
}

function toRoman(value: number): string {
	if (value >= 4000) return String(value);
	const table: Array<[number, string]> = [
		[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
		[100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
		[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
	];
	let n = value;
	let out = "";
	for (const [num, sym] of table) {
		while (n >= num) {
			out += sym;
			n -= num;
		}
	}
	return out;
}
