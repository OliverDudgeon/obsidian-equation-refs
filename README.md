# Obsidian Equation Refs

An [Obsidian](https://obsidian.md/) plugin that auto-numbers display-math equations and resolves block references to their equation labels.

Write maths as usual, and the plugin will:

- Render every `$$ ... $$` block with a sequential number (configurable style and prefix/suffix).
- Replace the text of any internal link of the form `[[note#^block-id]]` that points at a numbered equation with a label like `Eq. 1.3` — in both reading view and live preview.

## How it works

Display math blocks are detected via Obsidian's metadata cache; numbers are recomputed per file whenever the cache changes. The number is injected as `\tag{...}` into the math source before MathJax renders it, so the rendered output is genuinely numbered rather than overlaid.

## Settings

| Setting | Description |
| --- | --- |
| **Number prefix / suffix** | Wraps the auto-generated number (e.g. `(`, `)`). |
| **First equation number** | Starting value for the per-note counter. |
| **Number style** | `arabic`, `alph`, `Alph`, `roman`, or `Roman`. |
| **Reference prefix / suffix** | Wraps the label used when rewriting link text. |
| **Number `align` line-by-line** | When on, each line of an `align` environment gets its own number. |

## Manual tags

If a math block contains its own `\tag{...}`, the plugin leaves it alone — that block is excluded from auto-numbering and the counter skips it.

## Block links

Place an anchor on an equation by appending `^id` after the closing `$$`:

```
$$
E = mc^2
$$
^einstein
```

Then reference it from anywhere with `[[that-note#^einstein]]`. The link will render as `Eq. 1` (or whatever the resolved label is).

## Installation

Install via Obsidian's community plugin browser, or load the latest build from this repo's releases.

## Credits

This plugin is a focused fork of [obsidian-latex-theorem-equation-referencer](https://github.com/RyotaUshio/obsidian-latex-theorem-equation-referencer) by Ryota Ushio. All the theorem / callout / proof functionality has been removed; only the equation-reference feature remains, rebuilt for reliability.
