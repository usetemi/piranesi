# mdmaster

Markdown reader/writer. Single-file Deno server, zero deps.

```
deno run --allow-net --allow-read --allow-write --allow-env mdmaster.ts [directory]
```

Defaults to `working_data/narrative/`. Opens on port 8888.

## Features

- Read / Raw / Formatted editing modes
- CodeMirror source editor + WYSIWYG (Turndown round-trip)
- Annotations with color-coded highlights and comments
- Editorial typography (Lora + Inter, drop caps, oldstyle numerals)
- Dark mode, TOC sidebar, scroll progress, expandable tables, footnotes
