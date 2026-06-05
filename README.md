# piranesi

AI-first filesystem-backed markdown reader/writer for published prose. No DBs.

<img alt="piranesi banner" src="docs/banner.png" />


## Usage

Single-file Deno server. There are only static network dependencies on load.

```
deno run -A piranesi.ts [directory]
```

Defaults to `working_data/` on port 8888.

If you invoke the script directly (`./piranesi.ts` or `deno piranesi.ts`), the shebang's flags are not always honored — always prefer the explicit `deno run` form above so writes don't trigger interactive permission prompts.

## Features

- Read / Annotation mode + Raw / Formatted(WYSIWYG) editing mode
- AI-first annotations
- Optimized for readability and AI-writing workflows

## Footnotes

Footnotes keep your claims clean and your evidence close. Mark a claim with
`[^label]`, then define the note with `[^label]:` — that's the whole syntax:

```
$50 is a working midpoint[^drugcost], not a fixed price.

[^drugcost]: From `vendors/glp1_all_vendors.csv` — Hallandale $55 all-in,
Red Rock $55, Drug Crafters $48. Refine per dose tier and partner mix.
```

Name labels for what they hold (`[^drugcost]`, `[^retention]`, `[^kff]`), not by
number — easier to match as a draft grows. A note can hold a link, a line of
reasoning, a path to another file, even the same label reused on several claims.
Write definitions anywhere; standard markdown footnotes, so they stay portable.

When rendered, piranesi makes them readable: markers become small superscript
links, hovering one previews the note in place, and clicking jumps to it (and
back). The definitions collect into a footnotes block at the foot of the page,
styled small and dimmed so it recedes behind your prose.

## Computed numbers

You can drop a live calculation straight into the prose — same `` `= ...` ``
backtick-equals syntax as Obsidian Dataview's inline expressions, but it does the
arithmetic for you and shows the result in place:

```
260M adults × 12% on GLP-1 × 30% cash-pay = `= round(260000000 * 0.12 * 0.30 / 1000000)`M users.

6-month LTV: $`= round(80 * 0.9 * (1 - pow(0.9, 5)) / (1 - 0.9))`
```

The expression stays in the file as plain text; only the reader shows the computed
number, and hovering it reveals the formula. So a model in a table stays honest —
change an input and every figure that depends on it recomputes.

Available: `+ - * / ^ %`, parentheses, `pi`, `e`, and `sqrt abs ceil floor round
min max log log2 log10 sin cos tan pow`. Only arithmetic — no variables or code.

## Annotations

Annotation mode lets you (or the AI) attach a margin comment to any passage —
"need a link", "this is the AI's claim, not mine, revisit with comps". The
highlighted text and its comment are saved in a separate `*.annotations.json`
file next to the document, so the prose itself stays untouched and portable.
