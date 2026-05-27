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
