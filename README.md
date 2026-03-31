# piranesi

AI-first filesystem-backed markdown reader/writer for published prose. No DBs.

<img width="1062" height="785" alt="image" src="https://github.com/user-attachments/assets/31869dfd-2c56-494c-839f-f30b26e3b5fa" />


## Usage

Single-file Deno server, zero dependencies.

```
deno run --allow-net --allow-read --allow-write --allow-env piranesi.ts [directory]
```

Defaults to `working_data/` on port 8888.

## Features

- Read / Annotation mode + Raw / Formatted(WYSIWYG) editing mode
- AI-first annotations
- Optimized for readability and AI-writing workflows
