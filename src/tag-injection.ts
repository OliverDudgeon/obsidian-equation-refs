/**
 * Insert `\tag{...}` into a display-math source so MathJax renders the equation number.
 * Handles the `align` environment specially when line-by-line numbering is enabled.
 */
export function insertTagInMathText(
	text: string,
	tagContent: string,
	lineByLine: boolean,
): string {
	if (!lineByLine) return text + `\\tag{${tagContent}}`;

	const alignMatch = text.match(/^\s*\\begin\{align\}([\s\S]*)\\end\{align\}\s*$/);
	if (!alignMatch || alignMatch[1] === undefined) return text + `\\tag{${tagContent}}`;

	const envStack: string[] = [];

	const stripped = alignMatch[1]
		.split("\n")
		.map((line) => stripLatexComment(line))
		.join("\n");

	let index = 1;
	const taggedBody = stripped
		.split("\\\\")
		.map((alignLine) => {
			const pattern = /\\(begin|end)\{(.*?)\}/g;
			let result: RegExpExecArray | null;
			while ((result = pattern.exec(alignLine)) !== null) {
				const which = result[1];
				const env = result[2];
				if (!which || !env) continue;
				if (which === "begin") {
					envStack.push(env);
				} else if (envStack.at(-1) === env) {
					envStack.pop();
				}
			}
			if (envStack.length || !alignLine.trim() || alignLine.includes("\\nonumber")) {
				return alignLine;
			}
			return alignLine + `\\tag{${tagContent}-${index++}}`;
		})
		.join("\\\\");

	// If only one or zero lines actually received a tag, fall back to a single tag at the end.
	if (index <= 2) return text + `\\tag{${tagContent}}`;

	return `\\begin{align}${taggedBody}\\end{align}`;
}

/** Returns the line with any `% comment` removed, preserving escaped `\%`. */
function stripLatexComment(line: string): string {
	const match = line.match(/(?<!\\)%/);
	if (match?.index === undefined) return line;
	return line.substring(0, match.index);
}

/** True if the math source already contains an unescaped `\tag{...}` declaration. */
export function hasManualTag(mathText: string): boolean {
	return /(?<!\\)\\tag\s*\{/.test(mathText);
}
