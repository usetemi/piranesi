#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env
/**
 * piranesi — unified markdown reader/writer
 * Single-file Deno server. Preact+htm client via CDN. No build step.
 *
 * Usage: deno run --allow-net --allow-read --allow-write piranesi.ts [directory]
 *        Defaults to working_data/
 */

import { resolve, join, extname, basename, dirname } from "https://deno.land/std@0.224.0/path/mod.ts";
import { streamText } from "https://esm.sh/ai@4.3.16";
import { createOpenAI } from "https://esm.sh/@ai-sdk/openai@1.3.22";
import { createAnthropic } from "https://esm.sh/@ai-sdk/anthropic@1.2.12";

// ── Config ──────────────────────────────────────────────────────────────────────

const PREFERRED_PORT = parseInt(Deno.env.get("PORT") || "8888");
const BASE_DIR = resolve(Deno.args[0] || "working_data/");

// Load .env sitting next to this script (Deno doesn't auto-load it, and the
// server is often launched from a different cwd). Only sets vars not already set.
async function loadDotEnv() {
  try {
    const dir = import.meta.dirname || ".";
    const text = await Deno.readTextFile(join(dir, ".env"));
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (!Deno.env.get(key)) Deno.env.set(key, val);
    }
  } catch { /* no .env, fine */ }
}
await loadDotEnv();

// LLM provider — prefer Anthropic, fall back to OpenAI
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const chatModel = ANTHROPIC_API_KEY
  ? createAnthropic({ apiKey: ANTHROPIC_API_KEY })("claude-sonnet-4-20250514")
  : OPENAI_API_KEY
    ? createOpenAI({ apiKey: OPENAI_API_KEY })("gpt-4o-mini")
    : null;

// ── MIME types ───────────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

// ── CSS ─────────────────────────────────────────────────────────────────────────

const THEME_CSS = `
:root {
  --bg: #fafaf9; --fg: #1c1917; --fg2: #78716c; --fg3: #a8a29e;
  --border: #e7e5e4; --card-bg: #ffffff; --card-hover: #f5f5f4;
  --accent: #0071ce; --link: #004c99;
  --highlight: rgba(251, 191, 36, 0.25); --highlight-hover: rgba(251, 191, 36, 0.45);
  --blockquote-bg: #f9fafb; --blockquote-border: #0071ce;
  --code-bg: #f5f5f4; --code-border: #e7e5e4;
  --hr: #d6d3d1; --progress: #0071ce;
}
[data-theme="dark"] {
  --bg: #000000; --fg: #e7e5e4; --fg2: #a8a29e; --fg3: #57534e;
  --border: #1a1a1a; --card-bg: #000000; --card-hover: #111111;
  --accent: #00a3ff; --link: #00a3ff;
  --highlight: rgba(251, 191, 36, 0.3); --highlight-hover: rgba(251, 191, 36, 0.5);
  --blockquote-bg: #000000; --blockquote-border: #004c99;
  --code-bg: #0a0a0a; --code-border: #1a1a1a;
  --hr: #1a1a1a; --progress: #00a3ff;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; scroll-padding-top: 1.5rem; }
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  background: var(--bg); color: var(--fg);
  line-height: 1.5; font-size: 17px;
  transition: background 0.3s, color 0.3s;
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
}
::selection { background: rgba(251, 191, 36, 0.3); color: inherit; }
[data-theme="dark"] ::selection { background: rgba(251, 191, 36, 0.4); color: inherit; }
`;

const PROSE_CSS = `
.prose { font-feature-settings: 'kern' 1, 'liga' 1; font-variant-numeric: oldstyle-nums proportional-nums; word-break: break-word; overflow-wrap: break-word; hyphens: auto; }
.prose h1, .prose h2, .prose h3, .prose h4 { scroll-margin-top: 1.5rem; hyphens: none; font-variant-numeric: lining-nums; }
.prose h1 { font-family: 'Lora', Georgia, serif; font-size: 1.75rem; font-weight: 600; margin: 2.5rem 0 0.75rem; letter-spacing: -0.025em; line-height: 1.2; }
.prose h2 { font-family: 'Lora', Georgia, serif; font-size: 1.35rem; font-weight: 600; margin: 2.25rem 0 0.6rem; letter-spacing: -0.02em; line-height: 1.25; }
.prose h3 { font-size: 1.1rem; font-weight: 600; margin: 1.75rem 0 0.4rem; letter-spacing: -0.01em; }
.prose h4 { font-size: 0.8rem; font-weight: 600; margin: 1.25rem 0 0.35rem; color: var(--fg2); text-transform: uppercase; letter-spacing: 0.03em; }
.prose p { margin-bottom: 0.85rem; hanging-punctuation: first; orphans: 3; widows: 3; }
.prose a { color: var(--link); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; transition: text-decoration-color 0.15s; }
.prose a:hover { text-decoration-color: transparent; }
.prose a.broken-link { color: var(--red, #c33); text-decoration-color: var(--red, #c33); opacity: 0.85; }
.prose strong, .prose .print-strong { font-weight: 600; letter-spacing: -0.005em; }
.prose em, .prose .print-em { font-style: italic; }
.prose a.section-ref { color: inherit; text-decoration: none; cursor: pointer; }
.prose a.section-ref.print-section-ref { color: #000 !important; text-decoration: none !important; }
.prose a.section-ref:hover { color: var(--accent); text-decoration: underline; }
.prose .section-ref-sym { font-style: normal; color: var(--accent); font-size: 0.85em; vertical-align: baseline; position: relative; top: -0.05em; }
.prose ul, .prose ol { margin: 0.4rem 0 0.85rem 1.5rem; }
.prose li { margin-bottom: 0.3rem; }
.prose li > ul, .prose li > ol { margin-top: 0.25rem; margin-bottom: 0.2rem; }
.prose ul { list-style: none; padding-left: 0; }
.prose ul > li { position: relative; padding-left: 1.25rem; }
.prose ul > li::before {
  content: ''; position: absolute; left: 0; top: 0.4em;
  width: 0.55em; height: 0.55em;
  background: var(--fg);
  -webkit-mask-size: contain; mask-size: contain;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M7 4v16l13-8z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M7 4v16l13-8z'/%3E%3C/svg%3E");
}
.prose ul > li > ul > li::before {
  width: 0.5em; height: 0.5em; top: 0.42em;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M13.446 2.6l7.955 7.954a2.045 2.045 0 0 1 0 2.892l-7.955 7.955a2.045 2.045 0 0 1-2.892 0l-7.955-7.955a2.045 2.045 0 0 1 0-2.892l7.955-7.955a2.045 2.045 0 0 1 2.892 0z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M13.446 2.6l7.955 7.954a2.045 2.045 0 0 1 0 2.892l-7.955 7.955a2.045 2.045 0 0 1-2.892 0l-7.955-7.955a2.045 2.045 0 0 1 0-2.892l7.955-7.955a2.045 2.045 0 0 1 2.892 0z'/%3E%3C/svg%3E");
}
.prose ul > li > ul > li > ul > li::before {
  width: 0.5em; height: 0.5em; top: 0.42em;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M13.163 2.168l8.021 5.828c.694.504.984 1.397.719 2.212l-3.064 9.43a1.978 1.978 0 0 1-1.881 1.367h-9.916a1.978 1.978 0 0 1-1.881-1.367l-3.064-9.43a1.978 1.978 0 0 1 .719-2.212l8.021-5.828a1.978 1.978 0 0 1 2.326 0z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M13.163 2.168l8.021 5.828c.694.504.984 1.397.719 2.212l-3.064 9.43a1.978 1.978 0 0 1-1.881 1.367h-9.916a1.978 1.978 0 0 1-1.881-1.367l-3.064-9.43a1.978 1.978 0 0 1 .719-2.212l8.021-5.828a1.978 1.978 0 0 1 2.326 0z'/%3E%3C/svg%3E");
}
.prose ul > li > ul > li > ul > li > ul > li::before {
  width: 0.5em; height: 0.5em; top: 0.42em;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M19.875 6.27a2.225 2.225 0 0 1 1.125 1.948v7.284c0 .809-.443 1.555-1.158 1.948l-6.75 4.27a2.269 2.269 0 0 1-2.184 0l-6.75-4.27a2.225 2.225 0 0 1-1.158-1.948v-7.285c0-.809.443-1.554 1.158-1.947l6.75-3.98a2.33 2.33 0 0 1 2.25 0l6.75 3.98h-.033z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M19.875 6.27a2.225 2.225 0 0 1 1.125 1.948v7.284c0 .809-.443 1.555-1.158 1.948l-6.75 4.27a2.269 2.269 0 0 1-2.184 0l-6.75-4.27a2.225 2.225 0 0 1-1.158-1.948v-7.285c0-.809.443-1.554 1.158-1.947l6.75-3.98a2.33 2.33 0 0 1 2.25 0l6.75 3.98h-.033z'/%3E%3C/svg%3E");
}
.prose ul > li > ul > li > ul > li > ul > li > ul > li::before {
  width: 0.45em; height: 0.45em; top: 0.44em;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0'/%3E%3C/svg%3E");
}
.prose .bullet-filled > li::before {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'%3E%3Cpath d='M6 4v16a1 1 0 0 0 1.524.852l13-8a1 1 0 0 0 0-1.704l-13-8A1 1 0 0 0 6 4z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'%3E%3Cpath d='M6 4v16a1 1 0 0 0 1.524.852l13-8a1 1 0 0 0 0-1.704l-13-8A1 1 0 0 0 6 4z'/%3E%3C/svg%3E");
}
.prose .bullet-filled > li > ul > li::before {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'%3E%3Cpath d='M9.793 2.893l-6.9 6.9c-1.172 1.171-1.172 3.243 0 4.414l6.9 6.9c1.171 1.172 3.243 1.172 4.414 0l6.9-6.9c1.172-1.171 1.172-3.243 0-4.414l-6.9-6.9c-1.171-1.172-3.243-1.172-4.414 0z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'%3E%3Cpath d='M9.793 2.893l-6.9 6.9c-1.172 1.171-1.172 3.243 0 4.414l6.9 6.9c1.171 1.172 3.243 1.172 4.414 0l6.9-6.9c1.172-1.171 1.172-3.243 0-4.414l-6.9-6.9c-1.171-1.172-3.243-1.172-4.414 0z'/%3E%3C/svg%3E");
}
.prose .bullet-filled > li > ul > li > ul > li::before {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'%3E%3Cpath d='M10.205 2.6l-6.96 5.238a3 3 0 0 0-1.045 3.338l2.896 8.765a3 3 0 0 0 2.85 2.059h8.12a3 3 0 0 0 2.841-2.037l2.973-8.764a3 3 0 0 0-1.05-3.37l-7.033-5.237-.091-.061-.018-.01-.106-.07a3 3 0 0 0-3.377.148z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'%3E%3Cpath d='M10.205 2.6l-6.96 5.238a3 3 0 0 0-1.045 3.338l2.896 8.765a3 3 0 0 0 2.85 2.059h8.12a3 3 0 0 0 2.841-2.037l2.973-8.764a3 3 0 0 0-1.05-3.37l-7.033-5.237-.091-.061-.018-.01-.106-.07a3 3 0 0 0-3.377.148z'/%3E%3C/svg%3E");
}
.prose .bullet-filled > li > ul > li > ul > li > ul > li::before {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'%3E%3Cpath d='M10.425 1.414l-6.775 3.996a3.21 3.21 0 0 0-1.65 2.807v7.285a3.226 3.226 0 0 0 1.678 2.826l6.695 4.237c1.034.57 2.22.57 3.2.032l6.804-4.302c.98-.537 1.623-1.618 1.623-2.793v-7.284l-.005-.204a3.223 3.223 0 0 0-1.284-2.39l-.107-.075-.007-.007a1.074 1.074 0 0 0-.181-.133l-6.776-3.995a3.33 3.33 0 0 0-3.216 0z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'%3E%3Cpath d='M10.425 1.414l-6.775 3.996a3.21 3.21 0 0 0-1.65 2.807v7.285a3.226 3.226 0 0 0 1.678 2.826l6.695 4.237c1.034.57 2.22.57 3.2.032l6.804-4.302c.98-.537 1.623-1.618 1.623-2.793v-7.284l-.005-.204a3.223 3.223 0 0 0-1.284-2.39l-.107-.075-.007-.007a1.074 1.074 0 0 0-.181-.133l-6.776-3.995a3.33 3.33 0 0 0-3.216 0z'/%3E%3C/svg%3E");
}
.prose .bullet-filled > li > ul > li > ul > li > ul > li > ul > li::before {
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'%3E%3Cpath d='M7 3.34a10 10 0 1 1-4.995 8.984l-.005-.324.005-.324a10 10 0 0 1 4.995-8.336z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='currentColor'%3E%3Cpath d='M7 3.34a10 10 0 1 1-4.995 8.984l-.005-.324.005-.324a10 10 0 0 1 4.995-8.336z'/%3E%3C/svg%3E");
}
.prose ol li::marker { color: var(--fg); }
.prose blockquote {
  background: var(--blockquote-bg); border-left: 3px solid var(--blockquote-border);
  padding: 0.75rem 1.15rem; margin: 1rem 0; border-radius: 0 6px 6px 0;
  font-style: normal; font-size: 0.97em;
}
.prose blockquote p { margin-bottom: 0.4rem; }
.prose blockquote p:last-child { margin-bottom: 0; }
.prose code {
  font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace;
  font-size: 0.85em; background: var(--code-bg); padding: 0.15em 0.35em;
  border-radius: 3px; border: 1px solid var(--code-border);
  font-feature-settings: 'liga' 0;
}
.prose pre {
  background: var(--code-bg); border: 1px solid var(--code-border);
  border-radius: 6px; padding: 0.85rem 1rem; margin: 1rem 0;
  overflow-x: auto; line-height: 1.5; tab-size: 2;
}
.prose pre code { background: none; border: none; padding: 0; font-size: 0.82rem; }
.prose hr { border: none; height: 1px; background: var(--hr); margin: 2rem 0; }
.prose .eval-result {
  font-weight: 600; color: var(--accent); cursor: help;
  border-bottom: 1px dashed var(--accent); font-variant-numeric: tabular-nums lining-nums;
}
.prose .table-wrap { position: relative; margin: 1rem 0; overflow-x: auto; transition: width 0.2s, margin-left 0.2s; }
.prose .table-wrap table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin: 0; }
.prose .table-wrap.expanded {
  /* width and margin-left set by JS in wireTableExpand */
  position: relative; z-index: 60; background: var(--bg);
}
.prose .table-expand-btn {
  position: absolute; top: 0.25rem; right: 0.25rem;
  background: var(--card-bg); border: 1px solid var(--border); border-radius: 4px;
  padding: 0.2rem 0.4rem; cursor: pointer; font-size: 0.7rem; color: var(--fg3);
  opacity: 0; transition: opacity 0.15s; line-height: 1; z-index: 1;
}
.prose .table-wrap:hover .table-expand-btn { opacity: 1; }
.prose .table-expand-btn:hover { color: var(--fg); border-color: var(--fg2); }
.prose .table-wrap.expanded .table-expand-btn { opacity: 0; }
.prose .table-wrap.expanded:hover .table-expand-btn { opacity: 1; }
.prose th, .prose td { padding: 0.5rem 0.75rem; border: 1px solid var(--border); text-align: left; vertical-align: top; }
.prose th { background: var(--code-bg); font-weight: 600; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.04em; }
.prose h1 + p, .prose h2 + p, .prose h3 + p, .prose h4 + p { margin-top: 0; }
.prose li > p { margin-bottom: 0.3rem; }
.prose img { display: block; max-width: 100%; height: auto; border-radius: 0; margin: 1rem auto; }
.prose blockquote img { float: right; display: block; max-width: 160px; margin: 0 0 0.75rem 1.25rem; border-radius: 0; }
.prose .img-figure { margin: 1.5rem 0; text-align: center; }
.prose .img-figure img { margin: 0 auto; }
.prose .img-figure figcaption {
  margin-top: 0.5rem; font-style: italic; font-size: 0.82rem;
  line-height: 1.4; color: var(--fg); text-align: center;
}
.prose > p:first-child::first-letter {
  font-family: 'Lora', Georgia, serif; font-size: 3.2em; font-weight: 600;
  float: left; line-height: 0.8; margin: 0.1em 0.12em 0 0; color: var(--accent);
}
.prose strong em, .prose em strong,
.prose .print-strong .print-em, .prose .print-em .print-strong { color: var(--accent); }
/* Footnotes */
.prose .footnote-ref { font-size: 0.75em; text-decoration: none; color: var(--accent); font-weight: 600; }
.prose .footnote-ref:hover { text-decoration: underline; }
.footnote-tooltip {
  position: fixed; z-index: 200; pointer-events: none;
  background: #1c1917; color: #f5f5f4; padding: 0.5rem 0.75rem; border-radius: 8px;
  font-size: 0.78rem; line-height: 1.5; width: max-content; max-width: 320px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.2);
  font-weight: 400; text-align: left; white-space: normal;
}
.footnote-tooltip p { margin: 0; }
.footnote-tooltip::after {
  content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  border: 5px solid transparent; border-top-color: #1c1917;
}
[data-theme="dark"] .footnote-tooltip { background: #292524; color: #e7e5e4; }
[data-theme="dark"] .footnote-tooltip::after { border-top-color: #292524; }
.prose sup { line-height: 0; position: relative; }
.prose sup::after {
  content: ''; position: absolute; inset: -2px -4px;
  background: linear-gradient(-45deg, transparent 35%, rgba(255,255,255,0.1) 42%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0.1) 58%, transparent 65%);
  background-size: 300% 300%; background-position: 200% 200%;
  pointer-events: none; opacity: 0; border-radius: 2px; transition: opacity 0.3s;
}
.prose sup:hover::after { animation: fn-shine 3s 0.1s linear infinite; opacity: 1; }
.prose .footnote-back { text-decoration: none; color: var(--accent); }
.fn-flash-bg { background: var(--code-bg); border-radius: 6px; }
@keyframes fn-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.2; } }
.fn-flash-num { animation: fn-blink 0.5s ease-in-out 2; }
.prose .footnotes-section { font-size: 0.85rem; color: var(--fg2); }
.prose .footnotes-section h2 { margin-top: 0.75rem; }
.prose .footnotes-section ol { margin-top: 0.5rem; margin-left: 1.5rem; list-style: decimal; padding-left: 0.5rem; }
.prose .footnotes-section li { margin-bottom: 0.4rem; }
.prose .footnotes-section a { word-break: break-all; }
.fn-item { position: relative; padding: 0.35rem 0.5rem; border-radius: 4px; transition: background 0.2s; }
.fn-item::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(-45deg, transparent 40%, rgba(255,255,255,0.06) 45%, rgba(255,255,255,0.12) 48%, rgba(255,255,255,0.25) 50%, rgba(255,255,255,0.12) 52%, rgba(255,255,255,0.06) 55%, transparent 60%);
  background-size: 300% 300%; background-position: 200% 200%;
  pointer-events: none; opacity: 0; clip-path: inset(0 round 4px);
}
.fn-item:hover { background: var(--highlight); }
.fn-item:hover::after { animation: fn-shine 4s 0.15s linear infinite; opacity: 1; }
.fn-item::before {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(-45deg, transparent 42%, rgba(255,255,255,0.04) 46%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.04) 54%, transparent 58%);
  background-size: 300% 300%; background-position: 200% 200%;
  pointer-events: none; opacity: 0; clip-path: inset(0 round 4px);
}
.fn-item:hover::before { animation: fn-shine 4s 0.3s linear infinite; opacity: 0.6; }
@keyframes fn-shine { 0% { background-position: 200% 200%; } 100% { background-position: -200% -200%; } }
`;

const LAYOUT_CSS = `
/* Progress bar */
#progress { position: fixed; top: 0; left: 0; height: 2px; background: var(--progress); z-index: 100; transition: width 0.1s; width: 0%; }
/* Layout */
.layout { position: relative; width: 100%; }
.toc-sidebar {
  position: fixed; top: 3.5rem; left: max(1rem, calc((100vw - 1400px) / 2));
  width: 220px; padding: 0.5rem 1rem 2rem 1.5rem;
  max-height: calc(100vh - 5rem); overflow-y: auto;
  font-size: 0.75rem; line-height: 1.45; z-index: 10;
  mask-image: linear-gradient(to bottom, black calc(100% - 2rem), transparent);
  -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 2rem), transparent);
}
.toc-sidebar.minimized .toc-links { display: none; }
.toc-sidebar::-webkit-scrollbar { width: 2px; }
.toc-sidebar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.toc-header {
  display: flex; justify-content: space-between; align-items: center;
  cursor: pointer; user-select: none; margin-bottom: 0.5rem;
}
.toc-header .toc-title { font-weight: 600; color: var(--fg3); text-transform: uppercase; letter-spacing: 0.1em; font-size: 0.65rem; }
.toc-header .toc-minimize {
  background: none; border: 1px solid var(--border); border-radius: 6px; color: var(--fg2); cursor: pointer;
  font-size: 0.9rem; padding: 0.15rem 0.4rem; line-height: 1;
}
.toc-header .toc-minimize:hover { color: var(--fg); border-color: var(--fg2); }
.toc-links a {
  display: block; color: var(--fg2); text-decoration: none;
  padding: 0.2rem 0; border-left: 2px solid transparent;
  padding-left: 0.75rem; transition: color 0.15s, border-color 0.15s;
  white-space: normal;
}
.toc-links a:hover { color: var(--fg); }
.toc-links a.active { color: var(--accent); border-left-color: var(--accent); font-weight: 500; }
.toc-links a.depth-2 { padding-left: 0.75rem; }
.toc-links a.depth-3 { padding-left: 1.5rem; font-size: 0.7rem; }
.toc-links a.depth-4 { padding-left: 2.25rem; font-size: 0.68rem; }
/* Rename button above TOC */
.rename-btn {
  display: block; width: 100%; text-align: center; background: none; border: 1px solid var(--border);
  border-radius: 6px; padding: 0.35rem 0.6rem; margin-bottom: 0.75rem;
  font-size: 0.68rem; font-family: inherit; color: var(--fg2); cursor: pointer;
  transition: border-color 0.15s, color 0.15s; line-height: 1.4;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rename-btn:hover { border-color: var(--accent); color: var(--fg); }
.rename-btn:disabled { opacity: 0.4; cursor: default; border-color: var(--border); color: var(--fg3); }
.rename-btn .rename-label { display: block; font-size: 0.82rem; color: var(--fg); margin-bottom: 0.15rem; }
.rename-btn .rename-preview { display: block; overflow: hidden; text-overflow: ellipsis; font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace; font-size: 0.64rem; }
.rename-btn .rename-hint { display: block; font-size: 0.6rem; color: var(--fg3); margin-top: 0.15rem; font-style: italic; }

.main-col {
  width: 100%; max-width: 60ch; min-width: 0;
  margin: 0 auto; padding: 2rem 2.5rem 6rem;
  overflow: visible;
}
/* Top bar */
.top-bar {
  display: flex; justify-content: space-between; align-items: center;
  max-width: 1400px; margin: 0 auto; padding: 0.5rem 2.5rem;
  border-bottom: 1px solid var(--border);
  z-index: 50; background: var(--bg);
}
.top-bar.fixed {
  position: fixed; top: 0; left: 0; right: 0; max-width: none;
}
.top-bar.read-hover {
  position: fixed; top: 0; left: 0; right: 0; max-width: none;
  transform: translateY(-100%); transition: transform 0.25s ease;
  pointer-events: none;
}
.top-bar.read-hover.visible {
  transform: translateY(0); pointer-events: auto;
}
.top-bar-hover-zone {
  position: fixed; top: 0; left: 0; right: 0; height: 12px; z-index: 49;
}
.top-bar-spacer { height: 2.75rem; }
.top-bar a { color: var(--fg2); text-decoration: none; font-size: 0.85rem; }
.top-bar a:hover { color: var(--fg); }
.top-bar .word-count { color: var(--fg3); font-size: 0.75rem; margin-left: 0.75rem; }
.top-left { display: flex; align-items: center; }
.breadcrumbs { display: inline-flex; align-items: center; gap: 0.15rem; }
.breadcrumbs a { color: var(--fg3); font-size: 0.85rem; text-decoration: none; }
.breadcrumbs a:hover { color: var(--fg); }
.crumb-sep { color: var(--fg3); font-size: 0.75rem; margin: 0 0.1rem; }
.controls { display: flex; gap: 0.5rem; align-items: center; }
/* Toggle pills */
.pill { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.pill button {
  background: none; border: none; padding: 0.35rem 0.75rem; cursor: pointer;
  color: var(--fg2); font-size: 0.82rem; font-family: inherit; transition: all 0.15s;
}
.pill button:hover { color: var(--fg); }
.pill button.active { background: var(--accent); color: white; }
/* Save button */
.save-btn {
  background: none; border: 1px solid var(--border); border-radius: 8px;
  padding: 0.35rem 0.75rem; cursor: pointer; color: var(--fg); font-size: 0.85rem;
  font-family: inherit; transition: all 0.2s;
}
.save-btn:hover { border-color: var(--accent); color: var(--accent); }
.save-btn:disabled { opacity: 0.4; cursor: default; }
.save-btn.conflict { border-color: #dc2626; color: #dc2626; }
.save-btn.conflict:hover { border-color: #dc2626; color: #dc2626; opacity: 0.8; }
.save-btn:disabled:hover { border-color: var(--border); color: var(--fg); }
/* Save status */
.save-status { font-size: 0.75rem; color: var(--fg3); transition: color 0.2s; }
.save-status.dirty { color: var(--accent); font-weight: 500; }
.save-status.conflict { color: #dc2626; font-weight: 500; }
/* Theme toggle */
.theme-toggle {
  background: none; border: 1px solid var(--border); border-radius: 8px;
  padding: 0.35rem 0.65rem; cursor: pointer; color: var(--fg); font-size: 0.85rem;
  font-family: inherit; transition: border-color 0.2s;
  filter: grayscale(1); opacity: 0.7;
}
.theme-toggle:hover { border-color: var(--fg2); filter: grayscale(0); opacity: 1; }
/* Read time */
.meta { color: var(--fg3); font-size: 0.8rem; }
`;

const EDITOR_CSS = `
/* Email export panel (right pane, Raw mode only) */
.email-panel-title { font-weight: 600; color: var(--fg3); text-transform: uppercase; letter-spacing: 0.1em; font-size: 0.6rem; margin-bottom: 0.5rem; }
.email-btn {
  display: block; width: 100%; text-align: center;
  background: none; border: 1px solid var(--border); border-radius: 8px;
  padding: 0.45rem 0.7rem; cursor: pointer; color: var(--fg2); font-size: 0.78rem;
  font-family: inherit; transition: border-color 0.2s, color 0.2s;
}
.email-btn:hover { border-color: var(--fg2); color: var(--fg); }
.email-hint { font-size: 0.66rem; color: var(--fg3); line-height: 1.45; margin-top: 0.5rem; }
/* CodeMirror overrides */
#cm-wrap { margin-top: 1rem; }
#cm-wrap .cm-editor { background: var(--bg); min-height: calc(100vh - 8rem); }
#cm-wrap .cm-editor.cm-focused { outline: none; }
#cm-wrap .cm-scroller { font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace; font-size: 0.88rem; line-height: 1.7; }
#cm-wrap .cm-content { padding: 0.85rem 0; caret-color: var(--fg); }
#cm-wrap .cm-gutters { display: none; }
#cm-wrap .cm-editor .\\u0361\\u0335 { color: var(--accent); font-weight: 600; }
#cm-wrap .cm-editor .\\u0361\\u0335b { font-weight: 700; }
#cm-wrap .cm-editor .\\u0361\\u0335a { font-style: italic; }
/* Formatted / WYSIWYG editor */
#formatted-editor { margin-top: 1rem; outline: none; min-height: calc(100vh - 8rem); }
`;

const ANNOTATION_CSS = `
/* Annotation highlights — multi-color via data-color attribute */
.annotated { border-radius: 2px; cursor: pointer; transition: background 0.15s; background: var(--highlight); }
.annotated:hover { background: var(--highlight-hover); }
.annotated.active { outline: 2px solid var(--accent); outline-offset: 1px; }
.annotated.annotated-viewonly { cursor: text; }
.annotated.annotated-viewonly.active { outline: none; }
/* Per-color highlights (light) */
.annotated[data-color="yellow"] { background: rgba(251,191,36,0.25); }
.annotated[data-color="yellow"]:hover { background: rgba(251,191,36,0.45); }
.annotated.annotated-viewonly[data-color="yellow"]:hover { background: rgba(251,191,36,0.25); }
.annotated[data-color="blue"] { background: rgba(59,130,246,0.2); }
.annotated[data-color="blue"]:hover { background: rgba(59,130,246,0.4); }
.annotated.annotated-viewonly[data-color="blue"]:hover { background: rgba(59,130,246,0.2); }
.annotated[data-color="green"] { background: rgba(34,197,94,0.2); }
.annotated[data-color="green"]:hover { background: rgba(34,197,94,0.4); }
.annotated.annotated-viewonly[data-color="green"]:hover { background: rgba(34,197,94,0.2); }
.annotated[data-color="pink"] { background: rgba(244,114,182,0.2); }
.annotated[data-color="pink"]:hover { background: rgba(244,114,182,0.4); }
.annotated.annotated-viewonly[data-color="pink"]:hover { background: rgba(244,114,182,0.2); }
.annotated[data-color="purple"] { background: rgba(168,85,247,0.2); }
.annotated[data-color="purple"]:hover { background: rgba(168,85,247,0.4); }
.annotated.annotated-viewonly[data-color="purple"]:hover { background: rgba(168,85,247,0.2); }
.annotated[data-color="orange"] { background: rgba(251,146,60,0.2); }
.annotated[data-color="orange"]:hover { background: rgba(251,146,60,0.4); }
.annotated.annotated-viewonly[data-color="orange"]:hover { background: rgba(251,146,60,0.2); }
/* Per-color highlights (dark) */
[data-theme="dark"] .annotated[data-color="yellow"] { background: rgba(251,191,36,0.3); }
[data-theme="dark"] .annotated[data-color="yellow"]:hover { background: rgba(251,191,36,0.5); }
[data-theme="dark"] .annotated.annotated-viewonly[data-color="yellow"]:hover { background: rgba(251,191,36,0.3); }
[data-theme="dark"] .annotated[data-color="blue"] { background: rgba(59,130,246,0.25); }
[data-theme="dark"] .annotated[data-color="blue"]:hover { background: rgba(59,130,246,0.45); }
[data-theme="dark"] .annotated.annotated-viewonly[data-color="blue"]:hover { background: rgba(59,130,246,0.25); }
[data-theme="dark"] .annotated[data-color="green"] { background: rgba(34,197,94,0.25); }
[data-theme="dark"] .annotated[data-color="green"]:hover { background: rgba(34,197,94,0.45); }
[data-theme="dark"] .annotated.annotated-viewonly[data-color="green"]:hover { background: rgba(34,197,94,0.25); }
[data-theme="dark"] .annotated[data-color="pink"] { background: rgba(244,114,182,0.25); }
[data-theme="dark"] .annotated[data-color="pink"]:hover { background: rgba(244,114,182,0.45); }
[data-theme="dark"] .annotated.annotated-viewonly[data-color="pink"]:hover { background: rgba(244,114,182,0.25); }
[data-theme="dark"] .annotated[data-color="purple"] { background: rgba(168,85,247,0.25); }
[data-theme="dark"] .annotated[data-color="purple"]:hover { background: rgba(168,85,247,0.45); }
[data-theme="dark"] .annotated.annotated-viewonly[data-color="purple"]:hover { background: rgba(168,85,247,0.25); }
[data-theme="dark"] .annotated[data-color="orange"] { background: rgba(251,146,60,0.25); }
[data-theme="dark"] .annotated[data-color="orange"]:hover { background: rgba(251,146,60,0.45); }
[data-theme="dark"] .annotated.annotated-viewonly[data-color="orange"]:hover { background: rgba(251,146,60,0.25); }
/* Color picker */
.color-picker { display: flex; gap: 0.35rem; padding: 0.25rem 0 0.15rem; }
.color-dot {
  width: 16px; height: 16px; border-radius: 50%; border: 2px solid transparent;
  cursor: pointer; transition: border-color 0.15s, transform 0.1s;
  padding: 0; outline: none; flex-shrink: 0;
}
.color-dot:hover { transform: scale(1.15); }
.color-dot.active { border-color: var(--fg); }
/* Note item color dot */
.ni-color-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 0.3rem; vertical-align: middle; flex-shrink: 0; }
/* Notes sidebar */
.notes-sidebar {
  position: fixed; top: 3.5rem; right: max(1rem, calc((100vw - 1400px) / 2));
  width: 260px; display: flex; flex-direction: column;
  max-height: calc(100vh - 5rem); z-index: 10;
  font-size: 0.82rem; line-height: 1.45;
  background: var(--bg);
}
.notes-sidebar.minimized .notes-body { display: none; }
.notes-sidebar.minimized { transition: opacity 0.3s; }
.notes-sidebar.minimized.scrolled { opacity: 0; pointer-events: none; }
.notes-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0.5rem 0.75rem; cursor: pointer; user-select: none;
}
.notes-header .notes-title { font-weight: 600; color: var(--fg3); text-transform: uppercase; letter-spacing: 0.1em; font-size: 0.65rem; }
.notes-header .notes-minimize {
  background: none; border: 1px solid var(--border); border-radius: 6px; color: var(--fg2); cursor: pointer;
  font-size: 0.9rem; padding: 0.15rem 0.4rem; line-height: 1;
}
.notes-header .notes-minimize:hover { color: var(--fg); border-color: var(--fg2); }
.notes-body { display: flex; flex-direction: column; gap: 0.75rem; padding: 0 0.75rem 1rem; overflow-y: auto; flex: 1; }
.notes-body::-webkit-scrollbar { width: 2px; }
.notes-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
/* Note input */
.note-input-section { display: flex; flex-direction: column; gap: 0.35rem; }
.note-selection-preview {
  background: var(--code-bg); border-left: 2px solid var(--accent);
  padding: 0.4rem 0.6rem; border-radius: 0 4px 4px 0;
  font-size: 0.75rem; color: var(--fg2); font-style: italic;
  white-space: pre-wrap; word-break: break-word;
}
.note-input-section textarea {
  width: 100%; border: 1px solid var(--border); border-radius: 6px;
  padding: 0.45rem 0.55rem; font-size: 0.82rem; font-family: inherit;
  background: var(--bg); color: var(--fg); resize: none; min-height: 2.5rem;
  line-height: 1.45; overflow: hidden;
}
.note-input-section textarea:disabled { opacity: 0.4; cursor: default; }
.note-input-section textarea:focus { outline: none; border-color: var(--accent); }
.note-save-status { font-size: 0.68rem; color: var(--fg3); height: 1rem; line-height: 1rem; display: block; transition: opacity 1.5s ease; opacity: 1; overflow: hidden; }
.note-save-status.dirty { color: var(--accent); transition: none; }
/* Note list */
.note-list { display: flex; flex-direction: column; gap: 0.35rem; }
.note-list-title { font-weight: 600; color: var(--fg3); text-transform: uppercase; letter-spacing: 0.1em; font-size: 0.6rem; margin-bottom: 0.25rem; }
.note-item {
  display: flex; flex-direction: column; gap: 0.2rem;
  padding: 0.4rem 0.5rem; border-radius: 5px; cursor: pointer; transition: background 0.1s;
}
.note-item:hover { background: var(--code-bg); }
.note-item .ni-comment { font-size: 0.78rem; color: var(--fg); }
.note-item .ni-quote { font-size: 0.7rem; color: var(--fg3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-style: italic; }
.note-item .ni-meta { display: flex; justify-content: space-between; align-items: center; margin-top: 0.15rem; }
.note-item .ni-date { color: var(--fg3); font-size: 0.65rem; }
.note-item .ni-actions { display: flex; gap: 0.25rem; opacity: 0; transition: opacity 0.15s; }
.note-item:hover .ni-actions { opacity: 1; }
.note-item .ni-btn {
  background: none; border: none; color: var(--fg3); cursor: pointer;
  font-size: 0.68rem; padding: 0.1rem 0.25rem;
}
.note-item .ni-btn:hover { color: var(--fg); }
.note-item .ni-btn.delete:hover { color: #dc2626; }
.note-item .ni-btn.resolve:hover { color: #16a34a; }
.note-item.resolved { opacity: 0.4; }
.note-item.resolved .ni-comment { text-decoration: line-through; }
/* Active/selected state */
.note-item.editing { background: var(--code-bg); outline: 1px solid var(--accent); }
/* Print-only annotation markers + endnotes — hidden on screen, shown in @media print */
.print-ann-marker { display: none; }
.print-annotations { display: none; }
`;

const INDEX_CSS = `
.index-container { max-width: 720px; margin: 0 auto; padding: 3rem 1.5rem; }
.index-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2.5rem; }
.index-header h1 { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; }
.index-header h1 span { color: var(--fg2); font-weight: 400; }
.header-controls { display: flex; gap: 0.5rem; align-items: center; }
.new-btn {
  background: none; border: 1px solid var(--accent); border-radius: 8px;
  padding: 0.4rem 0.75rem; cursor: pointer; color: var(--accent); font-size: 0.85rem;
  text-decoration: none; transition: border-color 0.2s;
}
.new-btn:hover { border-color: var(--fg2); }
.file-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.file-table th {
  text-align: left; padding: 0.5rem 0.75rem; font-size: 0.72rem; font-weight: 600;
  color: var(--fg3); text-transform: uppercase; letter-spacing: 0.06em;
  border-bottom: 1px solid var(--border); cursor: pointer; user-select: none; white-space: nowrap;
}
.file-table th:hover { color: var(--fg2); }
.file-table th .sort-arrow { margin-left: 0.3rem; font-size: 0.65rem; }
.file-table td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border); }
.file-table tr:hover td { background: var(--card-hover); }
.file-table tr td:first-child { font-weight: 500; }
.file-table th:nth-child(2), .file-table th:nth-child(3) { width: 5.5rem; }
.file-table a { color: var(--fg); text-decoration: none; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-table a:hover { color: var(--accent); }
.file-meta-cell { color: var(--fg2); font-size: 0.82rem; white-space: nowrap; }
.tree-dir-row { cursor: pointer; }
.tree-dir-row td:first-child { font-weight: 500; }
.tree-dir-label { display: flex; align-items: center; gap: 0.25rem; min-width: 0; }
.tree-dir-label > :last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree-icon { display: inline-flex; align-items: center; color: var(--fg3); flex-shrink: 0; }
.tree-file-cell { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
.tree-file-cell a { display: block; flex: 1; }
.theme-toggle { display: inline-flex; align-items: center; justify-content: center; }
.sort-arrow { display: inline-flex; align-items: center; vertical-align: middle; }
`;

const CHAT_CSS = `
.chat-toggle {
  position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 90;
  width: 44px; height: 44px; border-radius: 50%;
  background: var(--accent); color: #fff; border: none; cursor: pointer;
  font-size: 1.2rem; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15); transition: transform 0.15s;
}
.chat-toggle:hover { transform: scale(1.08); }
.chat-panel {
  position: fixed; bottom: 4.5rem; right: 1.5rem; z-index: 90;
  width: 420px; max-height: 70vh; display: flex; flex-direction: column;
  background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.12); overflow: hidden;
}
.chat-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0.6rem 0.85rem; border-bottom: 1px solid var(--border);
}
.chat-header span { font-weight: 600; font-size: 0.8rem; color: var(--fg2); text-transform: uppercase; letter-spacing: 0.08em; }
.chat-header button {
  background: none; border: none; cursor: pointer; color: var(--fg3); font-size: 0.75rem;
}
.chat-header button:hover { color: var(--fg); }
.chat-messages {
  flex: 1; overflow-y: auto; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.6rem;
  min-height: 300px; max-height: calc(70vh - 7.5rem);
}
.chat-messages::-webkit-scrollbar { width: 3px; }
.chat-messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.chat-msg {
  font-size: 0.82rem; line-height: 1.5; padding: 0.5rem 0.7rem;
  border-radius: 10px; max-width: 88%; word-break: break-word;
}
.chat-msg.user {
  align-self: flex-end; background: var(--accent); color: #fff;
  border-bottom-right-radius: 3px; white-space: pre-wrap;
}
.chat-msg.assistant {
  align-self: flex-start; background: var(--code-bg); color: var(--fg);
  border-bottom-left-radius: 3px;
}
/* Markdown content inside assistant messages */
.chat-msg.assistant p { margin: 0 0 0.4rem; }
.chat-msg.assistant p:last-child { margin-bottom: 0; }
.chat-msg.assistant code { background: var(--border); padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.78rem; }
.chat-msg.assistant pre {
  background: var(--border); padding: 0.5rem 0.6rem; border-radius: 6px;
  overflow-x: auto; font-size: 0.76rem; margin: 0.4rem 0; line-height: 1.5;
}
.chat-msg.assistant pre code { background: none; padding: 0; font-size: inherit; }
.chat-msg.assistant h1, .chat-msg.assistant h2, .chat-msg.assistant h3, .chat-msg.assistant h4 {
  font-size: 0.88rem; font-weight: 600; margin: 0.6rem 0 0.2rem;
}
.chat-msg.assistant ul, .chat-msg.assistant ol {
  margin: 0.3rem 0 0.3rem 1.2rem; padding: 0;
}
.chat-msg.assistant li { margin-bottom: 0.15rem; }
.chat-msg.assistant blockquote {
  border-left: 2px solid var(--accent); margin: 0.4rem 0; padding: 0.2rem 0 0.2rem 0.6rem;
  color: var(--fg2); font-style: italic;
}
.chat-msg.assistant strong { font-weight: 600; }
.chat-msg.assistant a { color: var(--link); text-decoration: underline; }
.chat-msg.assistant hr { border: none; height: 1px; background: var(--border); margin: 0.5rem 0; }
.chat-msg.assistant table { border-collapse: collapse; font-size: 0.78rem; margin: 0.3rem 0; }
.chat-msg.assistant th, .chat-msg.assistant td { border: 1px solid var(--border); padding: 0.25rem 0.4rem; }
.chat-msg.assistant th { background: var(--code-bg); font-weight: 600; }
/* Streaming indicator */
.chat-cursor {
  display: inline-block; width: 2px; height: 0.9em; background: var(--accent);
  margin-left: 2px; vertical-align: text-bottom; border-radius: 1px;
  animation: chat-blink 0.8s steps(2) infinite;
}
@keyframes chat-blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
/* Input area */
.chat-input-area { border-top: 1px solid var(--border); padding: 0.5rem 0.75rem; }
.chat-input-row {
  display: flex; gap: 0.4rem; align-items: flex-end;
}
.chat-input-row textarea {
  flex: 1; border: 1px solid var(--border); border-radius: 8px;
  padding: 0.4rem 0.6rem; font-size: 0.82rem; font-family: inherit;
  background: var(--bg); color: var(--fg); outline: none;
  resize: none; overflow-y: auto; min-height: 1.6rem; max-height: 6rem;
  line-height: 1.5;
}
.chat-input-row textarea:focus { border-color: var(--accent); }
.chat-input-row button {
  background: var(--accent); color: #fff; border: none; border-radius: 8px;
  padding: 0.4rem 0.7rem; font-size: 0.78rem; cursor: pointer; font-weight: 500;
  white-space: nowrap; flex-shrink: 0;
}
.chat-input-row button:disabled { opacity: 0.4; cursor: default; }
.chat-input-hint { font-size: 0.62rem; color: var(--fg3); text-align: right; margin-top: 0.25rem; }
.chat-empty { color: var(--fg3); font-size: 0.78rem; text-align: center; padding: 2rem 1rem; line-height: 1.6; }
.chat-error { color: #dc2626; font-size: 0.75rem; padding: 0.3rem 0.7rem; }
`;

const RESPONSIVE_CSS = `
@media (max-width: 1100px) {
  .notes-sidebar {
    position: fixed; top: auto; bottom: 1.5rem; right: 1.5rem; z-index: 80;
    width: 280px; max-height: 50vh;
    background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  }
}
@media (max-width: 900px) {
  .toc-sidebar { display: none; }
  .main-col { padding: 1.5rem 1rem 4rem; }
  .top-bar { padding: 0.5rem 1rem; }
}
`;

const PRINT_CSS = `
@page {
  /* Slim top/bottom, generous left/right for reading measure */
  margin: 0.4in 1.5in;
  /* Page number lives in the slim bottom margin
     (uncheck "Headers and footers" in the print dialog to drop URL/title/date) */
  @bottom-center {
    content: counter(page);
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 9pt;
    color: #888;
  }
}

@media print {
  /* Hide all chrome */
  .top-bar, .top-bar-spacer, .toc-sidebar, .notes-sidebar,
  .chat-toggle, .chat-panel, #progress, .table-expand-btn,
  .footnote-tooltip { display: none !important; }

  /* Reset to plain document flow */
  body { background: white; color: black; font-size: 12pt; }
  .layout { position: static; }
  /* Generous reading measure, centered within the page margins */
  .main-col {
    max-width: 33em; width: 100%; margin: 0 auto; padding: 0;
    overflow: visible;
  }

  /* Clean typography for print (hyphens: auto already inherited from base .prose) */
  .prose h1, .prose h2, .prose h3, .prose h4 { page-break-after: avoid; }
  .prose p, .prose li, .prose blockquote { orphans: 3; widows: 3; }
  .prose pre, .prose blockquote, .prose table, .prose img { page-break-inside: avoid; }
  .prose .img-figure { page-break-inside: avoid; }
  .prose img { max-width: 100%; }
  .prose .img-figure figcaption { color: black; }

  /* Keep links as normal blue underlined links (force light-theme link color) */
  .prose a { color: #004c99; text-decoration: underline; }

  /* Keep annotation highlights in print, but force solid print-safe colors and
     ensure browsers actually paint the background (print drops backgrounds otherwise). */
  .annotated {
    outline: none !important;
    -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
  }
  .annotated[data-color="yellow"] { background: #fdf0c8 !important; }
  .annotated[data-color="blue"]   { background: #d6e4fb !important; }
  .annotated[data-color="green"]  { background: #d3f2de !important; }
  .annotated[data-color="pink"]   { background: #fcdcec !important; }
  .annotated[data-color="purple"] { background: #ece0fb !important; }
  .annotated[data-color="orange"] { background: #fce4cf !important; }

  /* Numbered superscript markers after each highlighted passage */
  .print-ann-marker {
    display: inline; font-size: 0.7em; line-height: 0; vertical-align: super;
    color: #555; font-weight: 600; margin-left: 1px;
  }

  /* Endnotes section collecting every comment */
  .print-annotations {
    display: block; margin-top: 2.5rem; padding-top: 1rem;
    border-top: 1px solid #ccc;
    -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
  }
  .print-annotations .print-ann-title {
    font-family: 'Inter', system-ui, sans-serif; font-size: 11pt; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.06em; color: #555; margin: 0 0 0.6rem;
  }
  .print-annotations ol { margin: 0 0 0 1.6rem; padding: 0; list-style: decimal; font-size: 10pt; color: #333; }
  .print-annotations li { margin-bottom: 0.4rem; line-height: 1.45; page-break-inside: avoid; }
  .print-ann-dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    margin-right: 0.4rem; vertical-align: middle;
  }
  .print-ann-dot[data-color="yellow"] { background: #f5b800; }
  .print-ann-dot[data-color="blue"]   { background: #3b82f6; }
  .print-ann-dot[data-color="green"]  { background: #22c55e; }
  .print-ann-dot[data-color="pink"]   { background: #f472b6; }
  .print-ann-dot[data-color="purple"] { background: #a855f7; }
  .print-ann-dot[data-color="orange"] { background: #fb923c; }

  /* Tables */
  .prose .table-wrap { overflow: visible; }
  .prose .table-wrap.expanded { width: auto !important; margin-left: 0 !important; }
  .prose th, .prose td { border: 1px solid #ccc; }
  .prose th { background: #f0f0f0; }

  /* Code blocks */
  .prose pre { border: 1px solid #ddd; background: #f8f8f8; white-space: pre-wrap; word-wrap: break-word; }
  .prose code { border: 1px solid #ddd; background: #f8f8f8; }

  /* Blockquotes */
  .prose blockquote { background: none; border-left: 3px solid #999; }

  /* Drop cap — keep it but in black */
  .prose > p:first-child::first-letter { color: black; }

  /* No transitions/animations */
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
`;

const ALL_CSS = THEME_CSS + PROSE_CSS + LAYOUT_CSS + EDITOR_CSS + ANNOTATION_CSS + INDEX_CSS + CHAT_CSS + RESPONSIVE_CSS + PRINT_CSS;

// ── Page builders ───────────────────────────────────────────────────────────────

function shell(title: string, css: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text x='4' y='26' font-family='serif' font-size='28' font-weight='bold' fill='%23333'>P</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function indexPage(files: { rel: string; name: string; mtime: number; mins: number }[], relDir = ""): string {
  const label = basename(BASE_DIR);
  const filesJson = JSON.stringify(files);
  const segments = relDir.split("/").filter(Boolean);
  const crumbs: { name: string; href: string }[] = [{ name: label, href: "/" }];
  let acc = "";
  for (const seg of segments) {
    acc = acc ? acc + "/" + seg : seg;
    crumbs.push({ name: seg, href: "/doc/" + acc + "/" });
  }
  const titleStr = relDir ? `${label} / ${relDir}` : label;
  return shell(`${titleStr} — piranesi`, ALL_CSS, `
<div id="app"></div>
<script type="module">
import { h, render } from 'https://esm.sh/preact@10';
import { useState, useEffect, useCallback, useMemo } from 'https://esm.sh/preact@10/hooks';
import htm from 'https://esm.sh/htm@3';
import { IconSun, IconMoon, IconChevronDown, IconChevronUp, IconFolder, IconFolderOpen, IconFile } from 'https://esm.sh/@tabler/icons-preact@3?exports=IconSun,IconMoon,IconChevronDown,IconChevronUp,IconFolder,IconFolderOpen,IconFile';
const html = htm.bind(h);
const ICON = { size: 16, stroke: 1.5 };

const FILES = ${filesJson};
const LABEL = ${JSON.stringify(label)};
const CRUMBS = ${JSON.stringify(crumbs)};
const REL_PREFIX = ${JSON.stringify(relDir ? relDir + "/" : "")};

function useTheme() {
  const [theme, setThemeState] = useState(() => {
    const s = localStorage.getItem('piranesi-theme');
    if (s) return s;
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('piranesi-theme', theme);
  }, [theme]);
  const toggle = useCallback(() => setThemeState(t => t === 'dark' ? 'light' : 'dark'), []);
  return { theme, toggle };
}

function ThemeToggle({ theme, onToggle }) {
  return html\`<button class="theme-toggle" onClick=\${onToggle}>\${theme === 'dark' ? html\`<\${IconSun} ...\${ICON} />\` : html\`<\${IconMoon} ...\${ICON} />\`}</button>\`;
}

function buildTree(files) {
  const root = { dirs: {}, files: [] };
  for (const f of files) {
    const parts = f.rel.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.dirs[parts[i]]) node.dirs[parts[i]] = { dirs: {}, files: [] };
      node = node.dirs[parts[i]];
    }
    node.files.push(f);
  }
  return root;
}

function newestMtime(node) {
  let max = 0;
  for (const f of node.files) if (f.mtime > max) max = f.mtime;
  for (const k of Object.keys(node.dirs)) {
    const m = newestMtime(node.dirs[k]);
    if (m > max) max = m;
  }
  return max;
}

function sortFiles(files, sortCol, sortDir) {
  return files.slice().sort((a, b) => {
    let v;
    if (sortCol === 'name') v = a.name.localeCompare(b.name);
    else if (sortCol === 'modified') v = a.mtime - b.mtime;
    else if (sortCol === 'read') v = a.mins - b.mins;
    return v * sortDir;
  });
}

function TreeDir({ name, node, depth, collapsed, onToggle, pathPrefix, sortCol, sortDir }) {
  const dirPath = pathPrefix ? pathPrefix + '/' + name : name;
  const isCollapsed = collapsed[dirPath];
  const subdirs = Object.keys(node.dirs).sort((a, b) => a.localeCompare(b));
  const sortedFiles = sortFiles(node.files, sortCol, sortDir);
  const dirMtime = newestMtime(node);
  const dirDate = dirMtime ? new Date(dirMtime * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  return html\`
    <tr class="tree-dir-row" key=\${'dir:' + dirPath} onClick=\${(e) => onToggle(dirPath, e.altKey)}>
      <td style=\${'padding-left: ' + (0.75 + depth * 1.25) + 'rem'}>
        <span class="tree-dir-label"><span class="tree-icon">\${isCollapsed ? html\`<\${IconFolder} ...\${ICON} />\` : html\`<\${IconFolderOpen} ...\${ICON} />\`}</span><span class="tree-dir-name" title=\${name}>\${name}</span></span>
      </td>
      <td class="file-meta-cell">\${dirDate}</td>
      <td class="file-meta-cell"></td>
    </tr>
    \${!isCollapsed && subdirs.map(sub => html\`
      <\${TreeDir} name=\${sub} node=\${node.dirs[sub]} depth=\${depth + 1}
        collapsed=\${collapsed} onToggle=\${onToggle} pathPrefix=\${dirPath}
        sortCol=\${sortCol} sortDir=\${sortDir} />
    \`)}
    \${!isCollapsed && sortedFiles.map(f => {
      const d = new Date(f.mtime * 1000);
      const ds = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return html\`
        <tr key=\${f.rel}>
          <td style=\${'padding-left: ' + (0.75 + (depth + 1) * 1.25) + 'rem'} class="tree-file-cell">
            <span class="tree-icon"><\${IconFile} ...\${ICON} /></span>
            <a href=\${'/doc/' + REL_PREFIX + f.rel} title=\${f.name}>\${f.name}</a>
          </td>
          <td class="file-meta-cell">\${ds}</td>
          <td class="file-meta-cell">\${f.mins} min</td>
        </tr>\`;
    })}
  \`;
}

function FileTable({ files, sortCol, sortDir, onSort }) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState({});
  const onToggle = useCallback((path, altKey) => {
    if (!altKey) {
      setCollapsed(prev => ({ ...prev, [path]: !prev[path] }));
      return;
    }
    // Alt-click: toggle all sibling dirs at the same level within the parent
    const lastSlash = path.lastIndexOf('/');
    const parentPrefix = lastSlash === -1 ? '' : path.substring(0, lastSlash);
    let parentNode = tree;
    if (parentPrefix) {
      for (const seg of parentPrefix.split('/')) {
        parentNode = parentNode.dirs[seg];
        if (!parentNode) return;
      }
    }
    const siblingNames = Object.keys(parentNode.dirs);
    const siblingPaths = siblingNames.map(n => parentPrefix ? parentPrefix + '/' + n : n);
    setCollapsed(prev => {
      const next = { ...prev };
      const newState = !prev[path];
      for (const sp of siblingPaths) next[sp] = newState;
      return next;
    });
  }, [tree]);

  const arrow = (col) => sortCol === col ? (sortDir === 1 ? html\`<\${IconChevronUp} size=\${14} stroke=\${1.5} />\` : html\`<\${IconChevronDown} size=\${14} stroke=\${1.5} />\`) : '';
  const subdirs = Object.keys(tree.dirs).sort((a, b) => a.localeCompare(b));
  const rootFiles = sortFiles(tree.files, sortCol, sortDir);

  return html\`
    <table class="file-table">
      <thead>
        <tr>
          <th onClick=\${() => onSort('name')}>Name <span class="sort-arrow">\${arrow('name')}</span></th>
          <th onClick=\${() => onSort('modified')}>Modified <span class="sort-arrow">\${arrow('modified')}</span></th>
          <th onClick=\${() => onSort('read')}>Read <span class="sort-arrow">\${arrow('read')}</span></th>
        </tr>
      </thead>
      <tbody>
        \${subdirs.map(name => html\`
          <\${TreeDir} name=\${name} node=\${tree.dirs[name]} depth=\${0}
            collapsed=\${collapsed} onToggle=\${onToggle} pathPrefix=\${''}
            sortCol=\${sortCol} sortDir=\${sortDir} />
        \`)}
        \${rootFiles.map(f => {
          const d = new Date(f.mtime * 1000);
          const ds = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          return html\`
            <tr key=\${f.rel}>
              <td class="tree-file-cell"><span class="tree-icon"><\${IconFile} ...\${ICON} /></span><a href=\${'/doc/' + REL_PREFIX + f.rel} title=\${f.name}>\${f.name}</a></td>
              <td class="file-meta-cell">\${ds}</td>
              <td class="file-meta-cell">\${f.mins} min</td>
            </tr>\`;
        })}
      </tbody>
    </table>\`;
}

function IndexApp() {
  const { theme, toggle } = useTheme();
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState(1);

  const handleSort = useCallback((col) => {
    setSortCol(prev => {
      if (prev === col) { setSortDir(d => d * -1); return col; }
      setSortDir(col === 'modified' ? -1 : 1);
      return col;
    });
  }, []);

  const title = CRUMBS.length <= 1
    ? html\`\${LABEL}\`
    : html\`\${CRUMBS.map((c, i) => {
        const isLast = i === CRUMBS.length - 1;
        return html\`<\${isLast ? 'span' : 'a'} href=\${c.href}>\${c.name}</\${isLast ? 'span' : 'a'}>\${isLast ? '' : ' / '}\`;
      })}\`;

  return html\`
    <div class="index-container">
      <header class="index-header">
        <h1>\${title}</h1>
        <div class="header-controls">
          <a class="new-btn" href="/new">+ New</a>
          <\${ThemeToggle} theme=\${theme} onToggle=\${toggle} />
        </div>
      </header>
      <\${FileTable} files=\${FILES} sortCol=\${sortCol} sortDir=\${sortDir} onSort=\${handleSort} />
    </div>\`;
}

render(html\`<\${IndexApp} />\`, document.getElementById('app'));
</script>`);
}

function docPage(title: string, filePath: string): string {
  return shell(`${esc(title)} \u2014 piranesi`, ALL_CSS, `
<div id="app"></div>
<script type="importmap">
{
  "imports": {
    "style-mod": "https://esm.sh/style-mod",
    "w3c-keyname": "https://esm.sh/w3c-keyname",
    "crelt": "https://esm.sh/crelt",
    "@marijn/find-cluster-break": "https://esm.sh/@marijn/find-cluster-break",
    "@lezer/": "https://esm.sh/*@lezer/",
    "@codemirror/": "https://esm.sh/*@codemirror/",
    "codemirror": "https://esm.sh/*codemirror"
  }
}
<\/script>
<script type="module">
import { h, render } from 'https://esm.sh/preact@10';
import { useState, useEffect, useRef, useCallback, useMemo } from 'https://esm.sh/preact@10/hooks';
import htm from 'https://esm.sh/htm@3';
import { marked } from 'https://esm.sh/marked@15';
import markedFootnote from 'https://esm.sh/marked-footnote@1';
import TurndownService from 'https://esm.sh/turndown@7';
import { gfm as turndownGfm } from 'https://esm.sh/@joplin/turndown-plugin-gfm@1';
import { IconSun, IconMoon, IconPlus, IconMinus, IconArrowsMaximize, IconArrowsMinimize, IconHome } from 'https://esm.sh/@tabler/icons-preact@3?exports=IconSun,IconMoon,IconPlus,IconMinus,IconArrowsMaximize,IconArrowsMinimize,IconHome';
import { basicSetup, EditorView } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { markdown as mdLang } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
const html = htm.bind(h);
const ICON = { size: 16, stroke: 1.5 };
const CM = { EditorView, EditorState, basicSetup, markdown: mdLang, oneDark, Compartment };
const CHAT_ENABLED = ${chatModel ? 'true' : 'false'};

const FILE_PATH = ${JSON.stringify(filePath)};

// ── marked setup (once) ──
marked.setOptions({ gfm: true, breaks: false });
marked.use(markedFootnote());

// Inline evaluated expressions: \`= expr\` → computed result
// Supports: +, -, *, /, ^, %, parens, pi, e,
//   sqrt, abs, ceil, floor, round, min, max, log, log2, log10, sin, cos, tan, pow
const MATH_NAMES = ['pi','e','sqrt','abs','ceil','floor','round','min','max','log','log2','log10','sin','cos','tan','pow'];
const MATH_VALS = [Math.PI,Math.E,Math.sqrt,Math.abs,Math.ceil,Math.floor,Math.round,Math.min,Math.max,Math.log,Math.log2,Math.log10,Math.sin,Math.cos,Math.tan,Math.pow];

function evalMathExpr(expr) {
  try {
    const s = expr.trim();
    if (!/^[\\d\\s+\\-*/().,%^a-z_]+$/i.test(s)) return null;
    if (/\\b(var|let|const|function|return|this|window|document|eval|import|require|fetch|new)\\b/.test(s)) return null;
    const fn = new Function(...MATH_NAMES, 'return (' + s.replace(/\\^/g, '**') + ')');
    const result = fn(...MATH_VALS);
    if (typeof result !== 'number' || !isFinite(result)) return null;
    return parseFloat(result.toPrecision(10)).toString();
  } catch { return null; }
}

marked.use({
  renderer: {
    list(token) {
      const tag = token.ordered ? 'ol' : 'ul';
      const startAttr = token.ordered && token.start !== 1 ? ' start="' + token.start + '"' : '';
      // Detect bullet marker from raw source: * = filled, - = outline (default)
      let filledClass = '';
      if (!token.ordered && token.items && token.items.length > 0) {
        const raw = token.items[0].raw;
        if (raw && raw.trimStart().startsWith('* ')) filledClass = ' class="bullet-filled"';
      }
      let body = '';
      for (let j = 0; j < token.items.length; j++) {
        body += this.listitem(token.items[j]);
      }
      return '<' + tag + startAttr + filledClass + '>\\n' + body + '</' + tag + '>\\n';
    },
    codespan(token) {
      const text = typeof token === 'object' ? token.text : token;
      if (text.startsWith('= ')) {
        const result = evalMathExpr(text.slice(2));
        if (result !== null) {
          const title = text.slice(2).replace(/"/g, '&quot;');
          return '<span class="eval-result" title="' + title + '">' + result + '</span>';
        }
      }
      return '<code>' + text + '</code>';
    }
  }
});

const DEFAULT_ANN_COLOR = 'yellow';

// ── Utility functions (imperative DOM helpers) ──

function getProseEl() {
  return document.getElementById('content') || document.getElementById('formatted-editor');
}

function clearActiveHighlights() {
  document.querySelectorAll('.annotated.active').forEach(el => el.classList.remove('active'));
}

function buildTextMap(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let fullText = '', node, prevBlock = null;
  while (node = walker.nextNode()) {
    const block = node.parentNode.closest('p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th,dt,dd,figcaption,pre,div');
    if (prevBlock && block !== prevBlock && fullText.length > 0 && !/\\s$/.test(fullText)) fullText += ' ';
    prevBlock = block;
    nodes.push({ node, start: fullText.length });
    fullText += node.textContent;
  }
  const normMap = [];
  let normText = '';
  for (let i = 0; i < fullText.length; i++) {
    const ch = fullText[i];
    if (/\\s/.test(ch)) { if (normText.length > 0 && normText[normText.length - 1] !== ' ') { normMap.push(i); normText += ' '; } }
    else { normMap.push(i); normText += ch; }
  }
  return { nodes, fullText, normText, normMap };
}

function applyOneAnnotation(container, ann, onClick) {
  const { nodes, normText, normMap } = buildTextMap(container);
  const searchText = ann.text.replace(/\\s+/g, ' ');
  const normIdx = normText.indexOf(searchText);
  if (normIdx === -1) return;
  const origStart = normMap[normIdx];
  const origEnd = normMap[normIdx + searchText.length - 1] + 1;
  const segments = [];
  for (let i = 0; i < nodes.length; i++) {
    const ns = nodes[i].start, ne = ns + nodes[i].node.textContent.length;
    if (ne <= origStart) continue;
    if (ns >= origEnd) break;
    segments.push({ node: nodes[i].node, sliceStart: Math.max(origStart, ns) - ns, sliceEnd: Math.min(origEnd, ne) - ns });
  }
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i], textNode = seg.node, len = textNode.textContent.length;
    if (seg.sliceStart >= len || seg.sliceEnd > len || seg.sliceStart >= seg.sliceEnd) continue;
    const span = document.createElement('span');
    span.className = onClick ? 'annotated' : 'annotated annotated-viewonly';
    span.dataset.annId = ann.id;
    span.dataset.color = ann.color || DEFAULT_ANN_COLOR;
    span.title = ann.comment || '';
    if (onClick) {
      span.addEventListener('click', e => {
        e.stopPropagation();
        clearActiveHighlights();
        span.classList.add('active');
        onClick(ann.id);
      });
    }
    if (seg.sliceEnd < len) textNode.splitText(seg.sliceEnd);
    let target = textNode;
    if (seg.sliceStart > 0) target = textNode.splitText(seg.sliceStart);
    target.parentNode.insertBefore(span, target);
    span.appendChild(target);
  }
}

function applyAnnotations(container, annotations, onClick) {
  annotations.forEach(ann => { if (!ann.resolved) applyOneAnnotation(container, ann, onClick); });
  buildPrintAnnotations(container, annotations);
}

function replacePrintEmphasis(container) {
  const replacements = [];
  container.querySelectorAll('strong, em').forEach(original => {
    const isStrong = original.tagName === 'STRONG';
    const replacement = document.createElement(isStrong ? 'b' : 'i');
    for (const attribute of original.attributes) {
      replacement.setAttribute(attribute.name, attribute.value);
    }
    replacement.classList.add(isStrong ? 'print-strong' : 'print-em');
    while (original.firstChild) replacement.appendChild(original.firstChild);
    const sectionLink = !isStrong ? original.closest('a.section-ref') : null;
    original.replaceWith(replacement);
    if (sectionLink) sectionLink.classList.add('print-section-ref');
    replacements.push({ original, replacement, sectionLink });
  });
  return replacements;
}

function restorePrintEmphasis(replacements) {
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { original, replacement, sectionLink } = replacements[i];
    while (replacement.firstChild) original.appendChild(replacement.firstChild);
    replacement.replaceWith(original);
    if (sectionLink) sectionLink.classList.remove('print-section-ref');
  }
}

// Build a print-only endnotes section listing each annotation's comment, and
// inject a numbered superscript marker after each highlighted passage. Both the
// markers and the section are hidden on screen and only revealed in @media print.
function buildPrintAnnotations(container, annotations) {
  // Never inject into a contenteditable surface (the WYSIWYG editor) — its DOM
  // is serialized back to markdown on save, and these print-only nodes must not
  // leak into the document. Read view (#content) is the only target.
  if (container.isContentEditable || container.getAttribute('contenteditable') === 'true') return;

  // Clear anything from a previous render pass.
  container.querySelectorAll('.print-ann-marker').forEach(el => el.remove());
  const prev = container.querySelector('.print-annotations');
  if (prev) prev.remove();

  const byId = {};
  annotations.forEach(ann => { if (ann && !ann.resolved) byId[ann.id] = ann; });

  // Walk highlight spans in document order. A single annotation can be split
  // across several spans (multiple text nodes / formatting boundaries). Number it
  // once — on first sighting, so numbers follow reading order — but remember the
  // LAST span so the marker lands at the end of the highlighted passage.
  const spans = container.querySelectorAll('.annotated[data-ann-id]');
  const seen = {};
  const ordered = [];
  const lastSpan = {};
  spans.forEach(span => {
    const id = span.dataset.annId;
    if (id === '_pending' || !byId[id]) return;
    if (!seen[id]) { seen[id] = true; ordered.push(byId[id]); }
    lastSpan[id] = span; // spans iterate in document order, so this ends up the last
  });
  ordered.forEach((ann, i) => {
    const span = lastSpan[ann.id];
    const marker = document.createElement('sup');
    marker.className = 'print-ann-marker';
    marker.textContent = String(i + 1);
    // Place the number right after the end of the highlighted passage.
    span.parentNode.insertBefore(marker, span.nextSibling);
  });

  if (!ordered.length) return;

  const aside = document.createElement('aside');
  aside.className = 'print-annotations';
  // Deliberately NOT an <h2>: the on-screen TOC builder scans #content for
  // h1–h4, and a real heading here would show up as a phantom TOC entry.
  const heading = document.createElement('div');
  heading.className = 'print-ann-title';
  heading.textContent = 'Annotations';
  aside.appendChild(heading);
  const ol = document.createElement('ol');
  ordered.forEach(ann => {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'print-ann-dot';
    dot.dataset.color = ann.color || DEFAULT_ANN_COLOR;
    li.appendChild(dot);
    const comment = document.createElement('span');
    comment.className = 'print-ann-comment';
    comment.textContent = ann.comment || '(no comment)';
    li.appendChild(comment);
    ol.appendChild(li);
  });
  aside.appendChild(ol);
  container.appendChild(aside);
}

function removePendingHighlights() {
  document.querySelectorAll('[data-ann-id="_pending"]').forEach(span => {
    const parent = span.parentNode;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  });
}

function wireFootnotes(container) {
  // Style the plugin-generated footnotes section
  const fnSection = container.querySelector('section[data-footnotes]');
  if (fnSection) {
    fnSection.classList.add('footnotes-section');
    fnSection.querySelectorAll('ol > li').forEach(li => li.classList.add('fn-item'));
  }

  // Forward refs: add class, hover tooltip (fixed-position, appended to body).
  // Known issue: if a re-render fires while a tooltip is showing, the mouseleave
  // handler on the destroyed <a> never fires and the tooltip orphans in <body>.
  // Negligible — only happens if hover coincides exactly with a re-render.
  container.querySelectorAll('a[data-footnote-ref]').forEach(a => {
    a.classList.add('footnote-ref');
    const href = a.getAttribute('href');
    if (!href) return;
    const fnEl = document.getElementById(href.slice(1));
    if (!fnEl) return;
    let tip = null;
    const show = () => {
      if (!tip) {
        tip = document.createElement('div');
        tip.className = 'footnote-tooltip';
        const clone = fnEl.cloneNode(true);
        clone.querySelectorAll('[data-footnote-backref]').forEach(b => b.remove());
        tip.innerHTML = clone.innerHTML;
      }
      document.body.appendChild(tip);
      const rect = a.getBoundingClientRect();
      tip.style.left = rect.left + rect.width / 2 - tip.offsetWidth / 2 + 'px';
      tip.style.top = rect.top - tip.offsetHeight - 8 + 'px';
    };
    const hide = () => { if (tip && tip.parentNode) tip.parentNode.removeChild(tip); };
    a.addEventListener('mouseenter', show);
    a.addEventListener('mouseleave', hide);
  });

  // Backrefs: add class
  container.querySelectorAll('a[data-footnote-backref]').forEach(a => {
    a.classList.add('footnote-back');
  });

  // Smooth-scroll click handlers (both directions)
  container.querySelectorAll('a[data-footnote-ref], a[data-footnote-backref]').forEach(a => {
    a.addEventListener('click', e => {
      const href = a.getAttribute('href');
      if (!href) return;
      const target = document.getElementById(href.slice(1));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (target.tagName === 'LI') {
        container.querySelectorAll('.fn-flash-bg').forEach(el => el.classList.remove('fn-flash-bg'));
        target.classList.add('fn-flash-bg');
      } else {
        target.classList.add('fn-flash-num');
        setTimeout(() => target.classList.remove('fn-flash-num'), 1000);
      }
    });
  });
}

function wireInlineSectionLinks(container) {
  const headings = container.querySelectorAll('h1, h2, h3, h4');
  const map = {};
  headings.forEach(h => { if (h.id) map[h.textContent.trim().toLowerCase()] = h; });
  container.querySelectorAll('em').forEach(em => {
    if (em.closest('h1, h2, h3, h4')) return;
    const key = em.textContent.trim().toLowerCase();
    const target = map[key];
    if (!target) return;
    const a = document.createElement('a');
    a.href = '#' + target.id;
    a.className = 'section-ref';
    const sym = document.createElement('span');
    sym.className = 'section-ref-sym';
    sym.textContent = '\\u00A7';
    em.insertBefore(sym, em.firstChild);
    em.parentNode.insertBefore(a, em);
    a.appendChild(em);
    a.addEventListener('click', e => { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  });
}

function wireTableExpand(container) {
  container.querySelectorAll('table').forEach(table => {
    if (table.closest('.table-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
    const expandSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4l4 0l0 4" /><path d="M14 10l6 -6" /><path d="M8 20l-4 0l0 -4" /><path d="M4 20l6 -6" /></svg>';
    const shrinkSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l4 0l0 -4" /><path d="M3 3l6 6" /><path d="M5 15l4 0l0 4" /><path d="M3 21l6 -6" /><path d="M19 9l-4 0l0 -4" /><path d="M15 9l6 -6" /><path d="M19 15l-4 0l0 4" /><path d="M15 15l6 6" /></svg>';
    const btn = document.createElement('button');
    btn.className = 'table-expand-btn';
    btn.innerHTML = expandSvg;
    btn.title = 'Expand table';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = wrap.classList.toggle('expanded');
      btn.innerHTML = expanded ? shrinkSvg : expandSvg;
      btn.title = expanded ? 'Collapse table' : 'Expand table';
      if (expanded) {
        const pad = 24;
        const availW = window.innerWidth - pad * 2;
        const wrapRect = wrap.getBoundingClientRect();
        const offset = pad - wrapRect.left;
        wrap.style.width = availW + 'px';
        wrap.style.marginLeft = offset + 'px';
      } else {
        wrap.style.width = '';
        wrap.style.marginLeft = '';
      }
    });
    wrap.appendChild(btn);
  });
}

function rewriteImageSrcs(container) {
  const fileDir = FILE_PATH.substring(0, FILE_PATH.lastIndexOf('/') + 1);
  container.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src');
    if (src && !src.startsWith('http') && !src.startsWith('/')) img.src = '/static/' + fileDir + src;
  });
}

// Read-mode only: turn alt text into a centered <figcaption>. NOT used in the
// Formatted editor — keeping bare <img> there makes the contenteditable→markdown
// round-trip simple and lossless (a <figure> wrapper otherwise corrupts it).
function wrapImageCaptions(container) {
  container.querySelectorAll('img').forEach(img => {
    const alt = (img.getAttribute('alt') || '').trim();
    const p = img.parentElement;
    const isStandalone = p && p.tagName === 'P' &&
      p.childElementCount === 1 && p.textContent.trim() === '';
    const inBlockquote = !!img.closest('blockquote');
    if (alt && isStandalone && !inBlockquote && !img.closest('figure')) {
      const figure = document.createElement('figure');
      figure.className = 'img-figure';
      const caption = document.createElement('figcaption');
      caption.textContent = alt;
      p.replaceWith(figure);
      figure.appendChild(img);
      figure.appendChild(caption);
    }
  });
}

function checkBrokenLinks(container) {
  const links = container.querySelectorAll('a[href]');
  for (const a of links) {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) continue;
    // Check both internal and external links
    const url = href.startsWith('http') ? href : new URL(href, location.origin).href;
    fetch(url, { method: 'HEAD', mode: href.startsWith('http') ? 'no-cors' : 'same-origin' })
      .then(res => {
        // no-cors returns opaque response (status 0) — can't determine broken, skip
        if (res.type === 'opaque') return;
        if (!res.ok) a.classList.add('broken-link');
      })
      .catch(() => { a.classList.add('broken-link'); });
  }
}

// ── HTML comment stashing for WYSIWYG ──
let stashedComments = [];
function stashComments(md) {
  stashedComments = [];
  const lines = md.split('\\n'), clean = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(<!--[\\s\\S]*?-->)\\s*$/);
    if (m) {
      let next = '';
      for (let j = i + 1; j < lines.length; j++) { if (lines[j].trim()) { next = lines[j].trim(); break; } }
      stashedComments.push({ comment: m[1], nextLine: next });
    } else { clean.push(lines[i]); }
  }
  return clean.join('\\n');
}
function restoreComments(md) {
  if (!stashedComments.length) return md;
  const lines = md.split('\\n'), result = [];
  let remaining = stashedComments.slice();
  for (let i = 0; i < lines.length; i++) {
    const toInsert = [];
    remaining = remaining.filter(s => {
      if (s.nextLine && lines[i].trim() === s.nextLine) { toInsert.push(s); return false; }
      return true;
    });
    toInsert.forEach(s => result.push(s.comment));
    result.push(lines[i]);
  }
  remaining.forEach(s => result.push(s.comment));
  return result.join('\\n');
}

let tdInstance = null;
function htmlToMarkdown(el) {
  if (!tdInstance) {
    tdInstance = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', emDelimiter: '*', strongDelimiter: '**', bulletListMarker: '-' });
    tdInstance.use(turndownGfm);
    tdInstance.addRule('bulletFilledListItem', {
      filter: node => {
        if (node.nodeName !== 'LI') return false;
        const parent = node.parentElement;
        return parent && parent.nodeName === 'UL' && parent.classList.contains('bullet-filled');
      },
      replacement: (content, node) => {
        content = content.replace(/^\\n+/, '').replace(/\\n+$/, '\\n');
        // Indent continuation lines
        content = content.replace(/\\n(?!$)/g, '\\n    ');
        return '* ' + content.trimStart() + (node.nextElementSibling ? '\\n' : '');
      }
    });
    tdInstance.addRule('annotations', {
      filter: node => node.nodeName === 'SPAN' && node.classList.contains('annotated'),
      replacement: content => content
    });
    tdInstance.addRule('evalResult', {
      filter: node => node.nodeName === 'SPAN' && node.classList.contains('eval-result'),
      replacement: (content, node) => '\x60= ' + (node.getAttribute('title') || content) + '\x60'
    });
    tdInstance.addRule('imgFigure', {
      // Caption figures are a display-only wrapper around an <img> whose alt
      // text IS the caption. Serialize from the inner <img> and drop the
      // <figcaption> so the caption text isn't duplicated into the markdown.
      filter: node => node.nodeName === 'FIGURE' && node.classList.contains('img-figure'),
      replacement: (content, node) => {
        const img = node.querySelector('img');
        if (!img) return content;
        const src = img.getAttribute('src') || '';
        const fileDir = '/static/' + FILE_PATH.substring(0, FILE_PATH.lastIndexOf('/') + 1);
        const relSrc = src.startsWith(fileDir) ? src.substring(fileDir.length) : src;
        return '\\n\\n![' + (img.getAttribute('alt') || '') + '](' + relSrc + ')\\n\\n';
      }
    });
    tdInstance.addRule('relativeImages', {
      filter: node => node.nodeName === 'IMG' && node.getAttribute('src') && node.getAttribute('src').startsWith('/static/'),
      replacement: (content, node) => {
        const src = node.getAttribute('src');
        const fileDir = '/static/' + FILE_PATH.substring(0, FILE_PATH.lastIndexOf('/') + 1);
        const relSrc = src.startsWith(fileDir) ? src.substring(fileDir.length) : src;
        return '![' + (node.getAttribute('alt') || '') + '](' + relSrc + ')';
      }
    });
    tdInstance.addRule('tableWrap', {
      filter: node => node.nodeName === 'DIV' && node.classList.contains('table-wrap'),
      replacement: content => content
    });
    tdInstance.addRule('tableExpandBtn', {
      filter: node => node.nodeName === 'BUTTON' && node.classList.contains('table-expand-btn'),
      replacement: () => ''
    });
    tdInstance.addRule('superscript', { filter: 'sup', replacement: content => '<sup>' + content + '</sup>' });
    tdInstance.addRule('subscript', { filter: 'sub', replacement: content => '<sub>' + content + '</sub>' });
    // Footnote round-trip: reconstruct [^label] / [^label]: from marked-footnote HTML.
    // These rules are added AFTER superscript so they take priority (Turndown checks last-added first).
    tdInstance.addRule('footnoteRef', {
      filter: node => {
        if (node.nodeName !== 'SUP') return false;
        return !!node.querySelector('a[data-footnote-ref]');
      },
      replacement: (content, node) => {
        const a = node.querySelector('a[data-footnote-ref]');
        if (!a) return '<sup>' + content + '</sup>';
        const id = a.getAttribute('id') || '';
        const label = id.replace(/^footnote-ref-/, '');
        return label ? '[^' + label + ']' : '<sup>' + content + '</sup>';
      }
    });
    tdInstance.addRule('footnotesSection', {
      filter: node => node.nodeName === 'SECTION' && node.hasAttribute('data-footnotes'),
      replacement: (content, node) => {
        const items = node.querySelectorAll('ol > li');
        if (!items.length) return '';
        const defs = [];
        items.forEach(li => {
          const id = li.getAttribute('id') || '';
          const label = id.replace(/^footnote-/, '');
          if (!label) return;
          // Clone, strip backrefs, then convert inner HTML to markdown.
          // Known issue: if contenteditable mutations strip the data-footnote-backref
          // attribute, the backref "↩" char leaks into the reconstructed definition text.
          const clone = li.cloneNode(true);
          clone.querySelectorAll('[data-footnote-backref]').forEach(b => b.remove());
          // Use Turndown on the inner content of this single <li>
          const inner = tdInstance.turndown(clone.innerHTML).trim();
          defs.push('[^' + label + ']: ' + inner);
        });
        return '\\n' + defs.join('\\n\\n') + '\\n';
      }
    });
  }
  return restoreComments(tdInstance.turndown(el.innerHTML));
}

function syncAnnotationTexts(container, annotations) {
  annotations.forEach(ann => {
    const spans = container.querySelectorAll('[data-ann-id="' + ann.id + '"]');
    if (!spans.length) return;
    let newText = '';
    spans.forEach(s => { newText += s.textContent; });
    if (newText && newText !== ann.text) { ann.text = newText; ann.updated = new Date().toISOString(); }
  });
}

// ── Hooks ──

function useLatest(value) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function useTheme() {
  const [theme, setThemeState] = useState(() => {
    const s = localStorage.getItem('piranesi-theme');
    if (s) return s;
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('piranesi-theme', theme);
  }, [theme]);
  const toggle = useCallback(() => setThemeState(t => t === 'dark' ? 'light' : 'dark'), []);
  return { theme, toggle };
}

function useConflictDetection(filePath, mtimeRef, onConflict) {
  const onConflictRef = useLatest(onConflict);
  useEffect(() => {
    const id = setInterval(async () => {
      const mtime = mtimeRef.current;
      if (!mtime || !filePath) return;
      try {
        const res = await fetch('/api/mtime/' + filePath);
        if (!res.ok) return;
        const data = await res.json();
        if (Math.abs(data.mtime - mtime) > 0.01) {
          onConflictRef.current(data.mtime);
        }
      } catch (e) {}
    }, 3000);
    return () => clearInterval(id);
  }, []);
}

function useNotes(filePath) {
  const [notes, setNotes] = useState([]);
  // notesRef mirrors latest committed mutation result (synchronously updated)
  // so that all writers see the latest list and don't race using stale closures.
  const notesRef = useRef([]);
  // Serialize PUTs so concurrent mutations don't reorder on the network and
  // a stale write can't clobber a newer one.
  const writeChainRef = useRef(Promise.resolve());

  const applyNotes = useCallback((updated) => {
    notesRef.current = updated;
    setNotes(updated);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/annotations/' + filePath);
      const data = await res.json();
      applyNotes(data.annotations || []);
    } catch (e) { applyNotes([]); }
  }, [filePath, applyNotes]);

  const persist = useCallback((updated) => {
    if (!filePath) return Promise.resolve();
    // Snapshot the payload and chain on the existing write queue so PUTs run
    // strictly in order — last enqueued is the last to land on disk.
    const payload = JSON.stringify({ annotations: updated });
    const next = writeChainRef.current.then(() =>
      fetch('/api/annotations/' + filePath, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: payload,
      }).catch(() => {})
    );
    writeChainRef.current = next;
    return next;
  }, [filePath]);

  const addNote = useCallback(async (text, comment) => {
    const ann = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text, comment,
      created: new Date().toISOString(), updated: new Date().toISOString()
    };
    const updated = [...notesRef.current, ann];
    applyNotes(updated);
    await persist(updated);
    return ann;
  }, [persist, applyNotes]);

  const updateNote = useCallback(async (id, comment) => {
    const updated = notesRef.current.map(a => a.id === id ? { ...a, comment, updated: new Date().toISOString() } : a);
    applyNotes(updated);
    await persist(updated);
  }, [persist, applyNotes]);

  const resolveNote = useCallback(async (id) => {
    const updated = notesRef.current.map(a => a.id === id ? { ...a, resolved: a.resolved ? null : new Date().toISOString(), updated: new Date().toISOString() } : a);
    applyNotes(updated);
    await persist(updated);
  }, [persist, applyNotes]);

  const deleteNote = useCallback(async (id) => {
    const updated = notesRef.current.filter(a => a.id !== id);
    applyNotes(updated);
    await persist(updated);
  }, [persist, applyNotes]);

  return { notes, notesRef, setNotes: applyNotes, load, persist, addNote, updateNote, resolveNote, deleteNote };
}

// ── Components ──

function ThemeToggle({ theme, onToggle }) {
  return html\`<button class="theme-toggle" onClick=\${onToggle}>\${theme === 'dark' ? html\`<\${IconSun} ...\${ICON} />\` : html\`<\${IconMoon} ...\${ICON} />\`}</button>\`;
}

function ProgressBar() {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      setWidth(h > 0 ? (window.scrollY / h) * 100 : 0);
    };
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return html\`<div id="progress" style=\${{ width: width + '%' }}></div>\`;
}

function ModePill({ mode, onSetMode }) {
  return html\`
    <div class="pill" id="mode-pill">
      <button class=\${mode === 'read' ? 'active' : ''} onClick=\${() => onSetMode('read')}>Read</button>
      <button class=\${mode === 'raw' ? 'active' : ''} onClick=\${() => onSetMode('raw')}>Raw</button>
      <button class=\${mode === 'formatted' ? 'active' : ''} onClick=\${() => onSetMode('formatted')}>Formatted</button>
    </div>\`;
}

function SaveControls({ mode, isDirty, autoSave, onSetAutoSave, onSave, conflictState }) {
  const isEdit = mode === 'raw' || mode === 'formatted';
  if (!isEdit) return null;
  return html\`
    <button class=\${'save-btn' + (conflictState ? ' conflict' : '')}
      onClick=\${onSave}
      disabled=\${!isDirty && !conflictState}
      style=\${{ display: autoSave && !conflictState ? 'none' : '' }}>
      \${conflictState ? 'Overwrite' : isDirty ? 'Save' : 'Saved'}
    </button>
    <span class=\${'save-status' + (isDirty ? ' dirty' : '') + (conflictState ? ' conflict' : '')}
      style=\${{ display: autoSave || conflictState ? '' : 'none' }}>
      \${conflictState ? 'File changed on disk' : isDirty ? 'Unsaved' : 'Saved'}
    </span>
    <div class="pill" id="save-pill">
      <button class=\${!autoSave ? 'active' : ''} onClick=\${() => onSetAutoSave(false)}>Manual</button>
      <button class=\${autoSave ? 'active' : ''} onClick=\${() => onSetAutoSave(true)}>Auto</button>
    </div>\`;
}

function Breadcrumbs() {
  const parts = FILE_PATH.split('/');
  const dirs = parts.slice(0, -1);
  let acc = '';
  const folderCrumbs = dirs.map(seg => {
    acc = acc ? acc + '/' + seg : seg;
    return { name: seg, href: '/doc/' + acc + '/' };
  });
  return html\`<span class="breadcrumbs">
    <a href="/"><\${IconHome} size=\${14} stroke=\${1.5} /></a>
    \${folderCrumbs.map(c => html\`
      <span class="crumb-sep">/</span><a href=\${c.href}>\${c.name}</a>
    \`)}
  </span>\`;
}

function TopBar({ mode, onSetMode, isDirty, autoSave, onSetAutoSave, onSave, conflictState, wordCount, readTime, theme, onToggleTheme }) {
  const isFixed = mode === 'raw' || mode === 'formatted';
  const isRead = mode === 'read';

  // In read mode: show hover bar when navbar has scrolled off and mouse is near top
  const [hoverVisible, setHoverVisible] = useState(false);
  const [scrolledPast, setScrolledPast] = useState(false);

  useEffect(() => {
    if (!isRead) { setScrolledPast(false); setHoverVisible(false); return; }
    const onScroll = () => {
      setScrolledPast(window.scrollY > 50);
      if (window.scrollY <= 50) setHoverVisible(false);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [isRead]);

  const showHover = isRead && scrolledPast;

  const barClass = isFixed ? 'top-bar fixed'
    : showHover ? 'top-bar read-hover' + (hoverVisible ? ' visible' : '')
    : 'top-bar';

  return html\`
    \${showHover ? html\`<div class="top-bar-hover-zone"
      onMouseEnter=\${() => setHoverVisible(true)} />\` : null}
    <div class=\${barClass}
      onMouseLeave=\${showHover ? () => setHoverVisible(false) : null}>
      <div class="top-left">
        <\${Breadcrumbs} />
        <span class="word-count">\${wordCount > 0 ? wordCount.toLocaleString() + ' words' : ''}</span>
      </div>
      <div class="controls">
        <span class="meta">\${readTime > 0 ? readTime + ' min read' : ''}</span>
        <\${SaveControls} mode=\${mode} isDirty=\${isDirty} autoSave=\${autoSave}
          onSetAutoSave=\${onSetAutoSave} onSave=\${onSave} conflictState=\${conflictState} />
        <\${ModePill} mode=\${mode} onSetMode=\${onSetMode} />
        <\${ThemeToggle} theme=\${theme} onToggle=\${onToggleTheme} />
      </div>
    </div>\`;
}

// Normalize a title string into a safe filename (without extension)
function normalizeFilename(title) {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/\\p{M}/gu, '')  // strip diacritics
    .replace(/[^a-z0-9]+/g, '_')                       // non-alnum → underscore
    .replace(/^_+|_+$/g, '')                           // trim leading/trailing
    .replace(/_+/g, '_')                               // collapse runs
    .slice(0, 80);                                     // reasonable length cap
}

// Extract first heading from markdown
function extractTitle(md) {
  const lines = (md || '').split('\\n');
  for (const line of lines) {
    const m = line.match(/^#+\\s+(.+)/);
    if (m) return m[1].replace(/[*_\\\`#\\[\\]]/g, '').trim();
  }
  // Fallback: first non-empty line
  for (const line of lines) {
    const t = line.trim();
    if (t) return t.slice(0, 60);
  }
  return '';
}

// ── Email export ─────────────────────────────────────────────────────────────
// Gmail strips <style>/<head>/class/id on paste — only inline style="" survives —
// and rejects data: image src. So we render the markdown, INLINE a Gmail-safe
// style subset onto every element, give images real (loaded) <img> tags pointing
// at the same-origin /static URL, and copy the RENDERED DOM (not a string) so the
// browser hands Gmail actual image bytes, which it re-uploads as inline (CID)
// attachments on paste. Captions are visible <div>s (alt-only would stay hidden
// because Gmail auto-displays images). Light-theme palette (email bg is white).
// Spacing copied as closely as possible from a polished Substack newsletter email
// (see SAMPLE.email). Body: rgb(54,55,55), 16px/26px, 20px paragraph gap. Column
// 550px centered, 32px top pad. No background colors.
const EMAIL_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const EMAIL_STYLES = {
  // h1 verbatim from sample: 32px/36px, bold, no top margin.
  H1: 'font-size:32px;line-height:36px;font-weight:bold;margin:0 0 16px;color:rgb(54,55,55);',
  // h2/h3 derived on the same baseline (sample body had no in-line h2; keep legible & bold).
  H2: 'font-size:24px;line-height:30px;font-weight:bold;margin:32px 0 12px;color:rgb(54,55,55);',
  H3: 'font-size:19px;line-height:26px;font-weight:bold;margin:28px 0 10px;color:rgb(54,55,55);',
  H4: 'font-size:13px;line-height:20px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin:24px 0 8px;color:rgb(119,119,119);',
  // p verbatim from sample.
  P:  'font-size:16px;line-height:26px;margin:0 0 20px 0;color:rgb(54,55,55);',
  LI: 'font-size:16px;line-height:26px;margin:0 0 8px 0;color:rgb(54,55,55);',
  UL: 'margin:0 0 20px 0;padding-left:24px;',
  OL: 'margin:0 0 20px 0;padding-left:24px;',
  BLOCKQUOTE: 'margin:20px 0;padding:2px 0 2px 18px;border-left:3px solid #d9d9d9;color:rgb(90,90,90);font-style:italic;',
  A:  'color:#0071ce;text-decoration:underline;',
  // hr: sample uses margin:32px 0 (invisible); we keep a faint visible rule, same rhythm.
  HR: 'border:none;border-top:1px solid #e2e2e2;margin:32px 0;padding:0;',
  STRONG: 'font-weight:bold;',
  EM: 'font-style:italic;',
  CODE: "font-family:Menlo,Consolas,monospace;font-size:14px;background:#f4f4f4;border-radius:3px;padding:1px 5px;",
  PRE: "font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.5;background:#f7f7f7;border:1px solid #e2e2e2;border-radius:4px;padding:14px;overflow:auto;margin:0 0 20px 0;",
  TABLE: 'border-collapse:collapse;width:100%;margin:0 0 20px 0;font-size:15px;',
  TH: 'border:1px solid #e2e2e2;padding:7px 11px;text-align:left;background:#f7f7f7;font-weight:600;',
  TD: 'border:1px solid #e2e2e2;padding:7px 11px;text-align:left;vertical-align:top;',
};

// Resolve a markdown image src to a same-origin /static URL the browser can load.
function resolveStaticUrl(src) {
  if (!src) return null;
  // Absolute localhost → strip origin so it's same-origin.
  src = src.replace(/^https?:\\/\\/localhost(:\\d+)?/, '');
  if (src.startsWith('/static/')) return src;
  if (src.startsWith('http')) return src;            // external — load as-is
  const fileDir = FILE_PATH.substring(0, FILE_PATH.lastIndexOf('/') + 1);
  return '/static/' + fileDir + src;
}

// Build the inline-styled email DOM (real loaded <img>s + visible captions).
// opts.cidImages: when provided (an array), images get src="cid:imgN" and each
// image's {cid, url} is pushed to it (for server-side CID attachment on send).
function buildEmailDom(markdown, opts) {
  opts = opts || {};
  const wrap = document.createElement('div');
  wrap.innerHTML = marked.parse(markdown || '');

  // Each image → centered figure with a real <img> (same-origin) + italic caption.
  Array.from(wrap.querySelectorAll('img')).forEach((img, i) => {
    const alt = (img.getAttribute('alt') || '').trim();
    // Sample: image block margin ≈ 1em 0 1.6em (16px top / 26px bottom), centered.
    const fig = document.createElement('div');
    fig.style.cssText = 'margin:16px auto 26px;text-align:center;';

    const el = document.createElement('img');
    const url = resolveStaticUrl(img.getAttribute('src'));
    if (opts.cidImages) {
      const cid = 'img' + i;
      el.setAttribute('src', 'cid:' + cid);
      opts.cidImages.push({ cid, url });
    } else {
      el.setAttribute('src', url);
    }
    if (alt) el.setAttribute('alt', alt);
    el.setAttribute('style', 'max-width:100%;height:auto;display:block;margin:0 auto;border:none;');
    fig.appendChild(el);

    if (alt) {
      // Caption: 14px/20px italic, inset 15% each side. Black text (no gray).
      const cap = document.createElement('div');
      cap.style.cssText = 'margin-top:8px;font-style:italic;color:rgb(54,55,55);font-size:14px;line-height:20px;font-weight:400;padding-left:15%;padding-right:15%;';
      cap.textContent = alt;
      fig.appendChild(cap);
    }

    const target = img.closest('figure') || img.parentElement;
    if (target && (target.tagName === 'FIGURE' || (target.tagName === 'P' && target.childElementCount === 1 && !target.textContent.trim()))) {
      target.replaceWith(fig);
    } else {
      img.replaceWith(fig);
    }
  });

  // Strip app-only chrome: buttons, annotation spans.
  wrap.querySelectorAll('button, .table-expand-btn').forEach(el => el.remove());
  wrap.querySelectorAll('span.annotated').forEach(s => { s.replaceWith(document.createTextNode(s.textContent)); });

  // Inline styles onto every element; strip class/id (Gmail discards them anyway).
  // Translate align="center" → inline text-align (the attr alone is unreliable
  // through markdown parsing AND in received Gmail). Also force-center lone
  // dingbat/ornament paragraphs (e.g. ❧) as a belt-and-suspenders fallback.
  const DINGBAT_RE = /^[\\u2042\\u2766\\u2767\\u2722-\\u2727\\u273B-\\u2740\\u2756\\u204A\\u00B7\\u2022\\u2014\\u2015\\u2026*~\\-\\s]+$/;
  wrap.querySelectorAll('*').forEach(el => {
    const base = EMAIL_STYLES[el.tagName] || '';
    let extra = el.getAttribute('style') || '';
    const align = el.getAttribute('align');
    if (align && !/text-align/.test(base + extra)) extra += 'text-align:' + align + ';';
    // Lone ornament paragraph → center regardless of how it was authored.
    if (el.tagName === 'P' && el.childElementCount === 0) {
      const t = (el.textContent || '').trim();
      if (t && t.length <= 8 && DINGBAT_RE.test(t) && !/text-align/.test(base + extra)) {
        extra += 'text-align:center;';
      }
    }
    if (base || extra) el.setAttribute('style', base + extra);
    el.removeAttribute('class');
    el.removeAttribute('id');
    el.removeAttribute('align');
  });

  // Centered reading column matching the sample: 550px, 32px top padding, no bg.
  wrap.setAttribute('style',
    'max-width:550px;margin:0 auto;padding:32px 0 0 0;' +
    'font-family:' + EMAIL_FONT + ';color:rgb(54,55,55);' +
    'font-size:16px;line-height:26px;');
  return wrap;
}

// Fetch a same-origin image and return base64 + content type (for CID attachment).
async function fetchImageBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('image fetch failed: ' + url);
  const blob = await res.blob();
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return { base64: btoa(bin), contentType: blob.type || 'application/octet-stream' };
}

// Build the full sendable HTML email (table-centered 600px column for fidelity in
// received Gmail) plus the CID image attachments. Returns { html, attachments }.
async function buildEmailForSend(markdown) {
  const cidImages = [];
  const dom = buildEmailDom(markdown, { cidImages });
  // Inner column: the 550px content. Wrap in a centered table for bulletproof centering.
  dom.setAttribute('style',
    'font-family:' + EMAIL_FONT + ';color:rgb(54,55,55);font-size:16px;line-height:26px;');
  const inner = dom.outerHTML;
  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#ffffff;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">' +
    '<tr><td align="center" style="padding:24px 16px;">' +
    '<table role="presentation" width="550" cellpadding="0" cellspacing="0" border="0" style="width:550px;max-width:550px;">' +
    '<tr><td align="left">' + inner + '</td></tr></table>' +
    '</td></tr></table></body></html>';

  // Gather attachments.
  const attachments = [];
  for (const im of cidImages) {
    const { base64, contentType } = await fetchImageBase64(im.url);
    const filename = (im.url.split('/').pop() || (im.cid + '.png')).split('?')[0];
    attachments.push({ filename, content_id: im.cid, content: base64, content_type: contentType });
  }
  return { html, attachments };
}

async function sendEmailViaResend(markdown, to, subject) {
  const { html, attachments } = await buildEmailForSend(markdown);
  const res = await fetch('/api/send-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, html, attachments }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('send failed (' + res.status + ')'));
  return data;
}

// Right pane shown in Raw mode only: send the document as a real HTML email.
function EmailPanel({ markdown }) {
  const [sendState, setSendState] = useState('idle'); // idle | sending | sent | error
  const [sendMsg, setSendMsg] = useState('');
  const onSend = useCallback(async () => {
    setSendState('sending'); setSendMsg('');
    try {
      const subject = extractTitle(markdown) || 'Document';
      await sendEmailViaResend(markdown, 'josh@usetemi.com', subject);
      setSendState('sent');
      setTimeout(() => setSendState('idle'), 4000);
    } catch (e) {
      setSendState('error'); setSendMsg(e.message || 'send failed');
      setTimeout(() => setSendState('idle'), 6000);
    }
  }, [markdown]);
  const sendLabel = sendState === 'sending' ? 'Sending…'
    : sendState === 'sent' ? 'Sent ✓'
    : sendState === 'error' ? 'Send failed'
    : 'Send test → josh@usetemi.com';

  return html\`
    <aside class="notes-sidebar">
      <div class="notes-body">
        <div class="email-panel-title">Export</div>
        <button class="email-btn" onClick=\${onSend} disabled=\${sendState === 'sending'}
          title="Send this document as a real HTML email via Resend (test)">
          \${sendLabel}
        </button>
        \${sendState === 'error' ? html\`<div class="email-hint" style="color:var(--red,#c33);">\${sendMsg}</div>\` : null}
        <div class="email-hint">Delivers a real HTML email via Resend.</div>
      </div>
    </aside>\`;
}

function RenameButton({ markdown, isDirty, filePath }) {
  const [renaming, setRenaming] = useState(false);

  const title = useMemo(() => extractTitle(markdown), [markdown]);
  const canonicalName = useMemo(() => {
    const n = normalizeFilename(title);
    return n ? n + '.md' : '';
  }, [title]);

  // Determine current basename (without directory)
  const currentName = useMemo(() => {
    if (!filePath) return '';
    const parts = filePath.split('/');
    return parts[parts.length - 1];
  }, [filePath]);

  // Check if current name already matches canonical (prefix match — allows trailing random suffix)
  const alreadyCanonical = useMemo(() => {
    if (!canonicalName || !currentName) return true;
    const base = canonicalName.replace(/\\.md$/, '');
    const cur = currentName.replace(/\\.md$/, '');
    return cur === base || cur.startsWith(base + '_');
  }, [canonicalName, currentName]);

  // Hide if: new file, no title, or already matching
  if (!canonicalName || alreadyCanonical) return null;

  const handleRename = async () => {
    if (isDirty || renaming) return;
    setRenaming(true);
    try {
      const res = await fetch('/api/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: filePath, toName: canonicalName }),
      });
      const data = await res.json();
      if (res.ok && data.newPath) {
        window.location.href = '/doc/' + data.newPath;
      } else {
        alert('Rename failed: ' + (data.error || 'unknown error'));
      }
    } catch (e) {
      alert('Rename failed: ' + e.message);
    }
    setRenaming(false);
  };

  return html\`
    <button class="rename-btn" onClick=\${handleRename} disabled=\${isDirty || renaming}
      title=\${isDirty ? 'Save edits before renaming' : 'Rename ' + currentName + ' → ' + canonicalName}>
      <span class="rename-label">Rename file</span>
      <span class="rename-preview">\${canonicalName}</span>
      \${isDirty ? html\`<span class="rename-hint">save first</span>\` : null}
    </button>\`;
}

function TocSidebar({ mode, cmEditorRef, tocVersion, markdown, isDirty }) {
  const linksRef = useRef(null);
  const observerRef = useRef(null);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    const container = linksRef.current;
    if (!container) return;
    // Defer so ReadView/FormattedEditor effects populate DOM first
    const raf = requestAnimationFrame(() => {
      container.innerHTML = '';

      if (mode === 'raw') {
        const editor = cmEditorRef.current;
        if (!editor) return;
        const lines = editor.state.doc.toString().split('\\n');
        lines.forEach((line, i) => {
          const m = line.match(/^(#{1,4})\\s+(.+)/);
          if (!m) return;
          const a = document.createElement('a');
          a.href = '#';
          a.textContent = m[2].replace(/[*_\\\`#]/g, '').trim();
          a.className = 'depth-' + m[1].length;
          a.addEventListener('click', e => {
            e.preventDefault();
            if (editor) {
              const ln = editor.state.doc.line(i + 1);
              editor.dispatch({ selection: {anchor: ln.from}, scrollIntoView: true });
              editor.focus();
            }
          });
          container.appendChild(a);
        });
        return;
      }

      const prose = getProseEl();
      if (!prose) return;
      const headings = prose.querySelectorAll('h1, h2, h3, h4');
      if (!headings.length) return;
      headings.forEach((h, i) => {
        const id = 'heading-' + i;
        h.id = id;
        const depth = parseInt(h.tagName[1]);
        const a = document.createElement('a');
        a.href = '#' + id;
        a.textContent = h.textContent;
        a.className = 'depth-' + depth;
        a.addEventListener('click', e => {
          e.preventDefault();
          h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        container.appendChild(a);
      });

      // Observe headings for active state
      const links = container.querySelectorAll('a');
      const obs = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            links.forEach(l => l.classList.remove('active'));
            const active = container.querySelector('a[href="#' + entry.target.id + '"]');
            if (active) active.classList.add('active');
          }
        });
      }, { rootMargin: '-80px 0px -70% 0px' });
      headings.forEach(h => obs.observe(h));
      observerRef.current = obs;
    });
    return () => {
      cancelAnimationFrame(raf);
      if (observerRef.current) { observerRef.current.disconnect(); observerRef.current = null; }
    };
  }, [mode, tocVersion]);

  return html\`
    <nav class=\${'toc-sidebar' + (minimized ? ' minimized' : '')}>
      <\${RenameButton} markdown=\${markdown} isDirty=\${isDirty} filePath=\${FILE_PATH} />
      <div class="toc-header" onClick=\${() => setMinimized(!minimized)}>
        <span class="toc-title">Contents</span>
        <button class="toc-minimize">\${minimized ? html\`<\${IconPlus} size=\${14} stroke=\${1.5} />\` : html\`<\${IconMinus} size=\${14} stroke=\${1.5} />\`}</button>
      </div>
      <div class="toc-links" ref=\${linksRef}></div>
    </nav>\`;
}

function ReadView({ markdown, notes, onHighlightClick, renderVersion }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = marked.parse(markdown);
    rewriteImageSrcs(ref.current);
    wrapImageCaptions(ref.current);
    wireFootnotes(ref.current);
    wireInlineSectionLinks(ref.current);
    wireTableExpand(ref.current);
    checkBrokenLinks(ref.current);
    applyAnnotations(ref.current, notes, onHighlightClick);
  }, [markdown, notes, renderVersion]);
  useEffect(() => {
    let replacements = null;
    const beforePrint = () => {
      const container = ref.current;
      if (replacements !== null || !container || container.isContentEditable) return;
      replacements = replacePrintEmphasis(container);
    };
    const afterPrint = () => {
      if (replacements === null) return;
      restorePrintEmphasis(replacements);
      replacements = null;
    };
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    return () => {
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
      afterPrint();
    };
  }, []);
  return html\`<article class="prose" id="content" ref=\${ref}></article>\`;
}

function RawEditor({ markdown, onDirty, cmEditorRef, cmThemeCompRef, theme }) {
  const wrapRef = useRef(null);
  const onDirtyRef = useLatest(onDirty);
  useEffect(() => {
    if (!wrapRef.current) return;
    if (cmEditorRef.current) {
      // If the old editor's parent was destroyed (e.g. mode switched away and back),
      // the editor is orphaned — destroy it and create a fresh one below.
      if (!wrapRef.current.contains(cmEditorRef.current.dom)) {
        cmEditorRef.current.destroy();
        cmEditorRef.current = null;
      } else {
        // Update content
        const editor = cmEditorRef.current;
        const current = editor.state.doc.toString();
        if (current !== markdown) {
          editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: markdown } });
        }
        wrapRef.current.style.display = 'block';
        editor.focus();
        return;
      }
    }
    const { EditorView, EditorState, basicSetup, markdown: mdLang, oneDark, Compartment } = CM;
    const themeComp = new Compartment();
    cmThemeCompRef.current = themeComp;
    const dark = theme === 'dark';
    const updateListener = EditorView.updateListener.of(v => { if (v.docChanged) onDirtyRef.current(); });
    const editor = new EditorView({
      state: EditorState.create({
        doc: markdown,
        extensions: [basicSetup, mdLang(), themeComp.of(dark ? oneDark : []), updateListener, EditorView.lineWrapping]
      }),
      parent: wrapRef.current
    });
    cmEditorRef.current = editor;
    editor.focus();
  }, []);

  // Theme sync
  useEffect(() => {
    const editor = cmEditorRef.current;
    const themeComp = cmThemeCompRef.current;
    if (!editor || !themeComp) return;
    editor.dispatch({ effects: themeComp.reconfigure(theme === 'dark' ? CM.oneDark : []) });
  }, [theme]);

  return html\`<div id="cm-wrap" ref=\${wrapRef} style="display:block"></div>\`;
}

// ── List indent/outdent helpers for contenteditable ──

function closestLi(node, root) {
  let n = node;
  while (n && n !== root) {
    if (n.nodeName === 'LI') return n;
    n = n.parentElement;
  }
  return null;
}

function indentLi(li) {
  const prev = li.previousElementSibling;
  if (!prev || prev.nodeName !== 'LI') return false;
  const parentList = li.parentElement;
  if (!parentList || (parentList.nodeName !== 'UL' && parentList.nodeName !== 'OL')) return false;
  const listTag = parentList.nodeName.toLowerCase();

  // Save cursor position relative to li's text content
  const sel = window.getSelection();
  let cursorOffset = null;
  if (sel.rangeCount) {
    const r = sel.getRangeAt(0);
    try { cursorOffset = { node: r.startContainer, offset: r.startOffset }; } catch (_) {}
  }

  // Find existing sub-list at end of prev, or create one
  const lastChild = prev.lastElementChild;
  let subList = (lastChild && (lastChild.nodeName === 'UL' || lastChild.nodeName === 'OL')) ? lastChild : null;
  if (!subList) {
    subList = document.createElement(listTag);
    if (parentList.classList.contains('bullet-filled')) subList.classList.add('bullet-filled');
    prev.appendChild(subList);
  }
  subList.appendChild(li);

  // Restore cursor
  if (cursorOffset) {
    try {
      const r = document.createRange();
      r.setStart(cursorOffset.node, cursorOffset.offset);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (_) {}
  }
  return true;
}

function outdentLi(li) {
  const parentList = li.parentElement;
  if (!parentList || (parentList.nodeName !== 'UL' && parentList.nodeName !== 'OL')) return false;
  const grandLi = parentList.parentElement;
  if (!grandLi || grandLi.nodeName !== 'LI') return false;
  const grandList = grandLi.parentElement;
  if (!grandList) return false;

  // Save cursor
  const sel = window.getSelection();
  let cursorOffset = null;
  if (sel.rangeCount) {
    const r = sel.getRangeAt(0);
    try { cursorOffset = { node: r.startContainer, offset: r.startOffset }; } catch (_) {}
  }

  // Collect siblings that come after this li — they need to stay nested
  const siblingsAfter = [];
  let sib = li.nextElementSibling;
  while (sib) {
    const next = sib.nextElementSibling; // grab before DOM mutation
    siblingsAfter.push(sib);
    sib = next;
  }
  if (siblingsAfter.length > 0) {
    // If li already has a child sub-list, append to it; otherwise create one
    const existingSub = li.lastElementChild;
    let target;
    if (existingSub && (existingSub.nodeName === 'UL' || existingSub.nodeName === 'OL')) {
      target = existingSub;
    } else {
      target = document.createElement(parentList.nodeName.toLowerCase());
      if (parentList.classList.contains('bullet-filled')) target.classList.add('bullet-filled');
      li.appendChild(target);
    }
    siblingsAfter.forEach(s => target.appendChild(s));
  }

  // Move li up one level, after grandLi
  grandList.insertBefore(li, grandLi.nextSibling);

  // Clean up empty parent list
  if (parentList.children.length === 0) parentList.remove();

  // Restore cursor
  if (cursorOffset) {
    try {
      const r = document.createRange();
      r.setStart(cursorOffset.node, cursorOffset.offset);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (_) {}
  }
  return true;
}

function FormattedEditor({ markdown, notes, onDirty, renderVersion }) {
  const ref = useRef(null);
  // Only re-render the contenteditable's innerHTML when explicitly asked
  // (renderVersion bumps on mount, mode switch, conflict reload, note actions).
  // We deliberately do NOT include markdown in deps: when a save fires,
  // setMarkdown(content) updates the parent's state with the post-save value,
  // and re-rendering innerHTML would destroy the user's cursor/selection and
  // steal focus mid-edit. The DOM is the source of truth while editing.
  const markdownRef = useLatest(markdown);
  const notesRef = useLatest(notes);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = marked.parse(stashComments(markdownRef.current));
    rewriteImageSrcs(ref.current);
    wireTableExpand(ref.current);
    applyAnnotations(ref.current, notesRef.current, null); // view-only highlights in edit mode
    ref.current.focus();
  }, [renderVersion]);

  const handleKeyDown = useCallback((e) => {
    if (e.key !== 'Tab') return;
    const sel = window.getSelection();
    if (!sel.anchorNode || !ref.current) return;
    const li = closestLi(sel.anchorNode, ref.current);
    if (!li) return; // not inside a list item — let browser handle
    e.preventDefault();
    const changed = e.shiftKey ? outdentLi(li) : indentLi(li);
    if (changed) onDirty();
  }, [onDirty]);

  return html\`<article class="prose" id="formatted-editor" contenteditable="true" ref=\${ref}
    style="display:block" onInput=\${onDirty} onKeyDown=\${handleKeyDown}></article>\`;
}

function NoteInput({ onAdd, onUpdate, onSelectionActive, editingNote, onClearEditing, onSelTextChange, onNoteCreated }) {
  const [comment, setComment] = useState('');
  const [selText, setSelText] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const textareaRef = useRef(null);
  const textareaHeightRef = useRef(null);
  const saveTimerRef = useRef(null);
  const flashTimerRef = useRef(null);
  const selTextRef = useLatest(selText);
  const editingRef = useLatest(editingNote);
  const onClearEditingRef = useLatest(onClearEditing);
  const onSelectionActiveRef = useLatest(onSelectionActive);

  useEffect(() => { if (onSelTextChange) onSelTextChange(selText); }, [selText]);

  const autoResize = useCallback((el) => {
    if (!el) return;
    el.style.height = 'auto';
    const h = el.scrollHeight + 'px';
    el.style.height = h;
    textareaHeightRef.current = h;
  }, []);

  // When editingNote changes, populate the textarea
  useEffect(() => {
    if (editingNote) {
      setComment(editingNote.comment || '');
      setSelText(editingNote.text);
      setSaveStatus('');
      removePendingHighlights();
      const proseEl = getProseEl();
      if (proseEl) {
        clearActiveHighlights();
        const span = proseEl.querySelector('[data-ann-id="' + editingNote.id + '"]');
        if (span) { span.classList.add('active'); span.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      }
      setTimeout(() => autoResize(textareaRef.current), 0);
    } else if (!selTextRef.current) {
      setComment('');
      setSelText('');
    }
  }, [editingNote]);

  // Track selection
  useEffect(() => {
    const onMouseUp = (e) => {
      setTimeout(() => {
        if (e.target.closest && (e.target.closest('.note-input-section') || e.target.closest('.notes-sidebar'))) return;
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
          const proseEl = getProseEl();
          if (proseEl && proseEl.contains(sel.anchorNode)) {
            const text = sel.toString();
            if (editingRef.current) onClearEditingRef.current();
            removePendingHighlights();
            applyOneAnnotation(proseEl, { id: '_pending', text: text.replace(/\\s+/g, ' ').trim() });
            setSelText(text);
            setComment('');
            setSaveStatus('');
            if (onSelectionActiveRef.current) onSelectionActiveRef.current();
            return;
          }
        }
        if (editingRef.current) onClearEditingRef.current();
        removePendingHighlights();
        setSelText('');
        setComment('');
      }, 50);
    };
    // Touch devices fire no mouseup for a text selection, so surface the settled
    // selection via selectionchange (debounced). Create-only: never clears, so an
    // incidental collapse can't wipe an in-progress comment; the guard skips
    // re-firing for the selection already pending.
    let selTimer = null;
    const onSelectionChange = () => {
      clearTimeout(selTimer);
      selTimer = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        const text = sel.toString();
        if (!text.trim() || selTextRef.current === text) return;
        const proseEl = getProseEl();
        if (!proseEl || !proseEl.contains(sel.anchorNode)) return;
        if (editingRef.current) onClearEditingRef.current();
        removePendingHighlights();
        applyOneAnnotation(proseEl, { id: '_pending', text: text.replace(/\\s+/g, ' ').trim() });
        setSelText(text);
        setComment('');
        setSaveStatus('');
        if (onSelectionActiveRef.current) onSelectionActiveRef.current();
      }, 350);
    };
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('selectionchange', onSelectionChange);
      clearTimeout(selTimer);
    };
  }, []);

  const flashStatus = useCallback((msg) => {
    setSaveStatus(msg);
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setSaveStatus(''), 2000);
  }, []);

  const handleInput = useCallback((e) => {
    const val = e.target.value;
    setComment(val);
    autoResize(e.target);
    clearTimeout(saveTimerRef.current);
    clearTimeout(flashTimerRef.current);
    if (!val.trim()) { setSaveStatus(''); return; }
    setSaveStatus('Unsaved');

    saveTimerRef.current = setTimeout(async () => {
      const editing = editingRef.current;
      if (editing) {
        onUpdate(editing.id, val);
        flashStatus('Saved');
      } else {
        const text = selTextRef.current;
        if (!text || !text.trim()) return;
        removePendingHighlights();
        const newNote = await onAdd(text.replace(/\\s+/g, ' ').trim(), val);
        flashStatus('Note created');
        if (newNote && onNoteCreated) onNoteCreated(newNote.id);
      }
    }, 800);
  }, [onAdd, onUpdate, autoResize, flashStatus]);

  useEffect(() => () => { clearTimeout(saveTimerRef.current); clearTimeout(flashTimerRef.current); }, []);

  const quoteText = editingNote ? editingNote.text : selText;
  const hasContext = quoteText && quoteText.trim().length > 0;

  return html\`
    <div class="note-input-section">
      \${quoteText ? html\`<div class="note-selection-preview">\${quoteText}</div>\` : null}
      <textarea ref=\${textareaRef}
        placeholder=\${hasContext ? (editingNote ? 'Edit note\\u2026' : 'Type a note\\u2026') : 'Select text first\\u2026'}
        value=\${comment}
        disabled=\${!hasContext}
        onInput=\${handleInput}
        style=\${textareaHeightRef.current ? 'height:' + textareaHeightRef.current : ''}
      ></textarea>
      <span class=\${'note-save-status' + (saveStatus === 'Unsaved' ? ' dirty' : '')}>\${saveStatus || '\\u00A0'}</span>
    </div>\`;
}

function NoteItem({ note, onResolve, onDelete, onClick, isActive }) {
  return html\`
    <div class=\${'note-item' + (note.resolved ? ' resolved' : '') + (isActive ? ' editing' : '')}
      data-note-item=\${note.id} onClick=\${() => onClick && onClick(note.id)}
      style=\${onClick ? '' : 'cursor: default'}>
      <div class="ni-comment">\${note.comment || '(no note)'}</div>
      <div class="ni-quote">\${note.text.length > 60 ? note.text.slice(0, 60) + '\\u2026' : note.text}</div>
      <div class="ni-meta">
        <span class="ni-date">\${formatNoteDate(note.created)}</span>
        \${onResolve || onDelete ? html\`<div class="ni-actions">
          \${onResolve ? html\`<button class="ni-btn resolve" onClick=\${e => { e.stopPropagation(); onResolve(note.id); }}>\${note.resolved ? 'Reopen' : 'Resolve'}</button>\` : null}
          \${onDelete ? html\`<button class="ni-btn delete" onClick=\${e => { e.stopPropagation(); onDelete(note.id); }}>Delete</button>\` : null}
        </div>\` : null}
      </div>
    </div>\`;
}

function formatNoteDate(isoStr) {
  const d = new Date(isoStr);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function NotesSidebar({ notes, onAdd, onUpdate, onResolve, onDelete, mode, onNoteClick }) {
  const isViewOnly = mode === 'formatted';
  const [minimized, setMinimized] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);

  // Fade away when minimized + scrolled — only in read mode
  useEffect(() => {
    if (!minimized || isViewOnly) { setScrolled(false); return; }
    const onScroll = () => setScrolled(window.scrollY > 100);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [minimized, isViewOnly]);

  const minimizedRef = useLatest(minimized);

  const handleSelTextChange = useCallback((selText) => {
    if (selText && selText.trim().length > 0 && minimizedRef.current) setMinimized(false);
  }, []);

  const handleSelectionActive = useCallback(() => {
    setEditingNoteId(null);
  }, []);

  const handleNoteItemClick = useCallback((noteId) => {
    // Toggle: click same note again to deselect
    setEditingNoteId(prev => prev === noteId ? null : noteId);
    // Also scroll to highlight in prose
    onNoteClick(noteId);
  }, [onNoteClick]);

  const handleClearEditing = useCallback(() => {
    setEditingNoteId(null);
    clearActiveHighlights();
  }, []);

  const handleNoteCreated = useCallback((noteId) => {
    setEditingNoteId(noteId);
  }, []);

  if (mode !== 'read' && mode !== 'formatted') return null;
  const editingNote = !isViewOnly && editingNoteId ? notes.find(n => n.id === editingNoteId) : null;
  const openNotes = notes.filter(n => !n.resolved);
  const resolvedNotes = notes.filter(n => n.resolved);
  const count = openNotes.length + (resolvedNotes.length ? ' + ' + resolvedNotes.length + ' resolved' : '');
  return html\`
    <aside class=\${'notes-sidebar' + (minimized ? ' minimized' : '') + (scrolled ? ' scrolled' : '')}>
      <div class="notes-header" onClick=\${() => setMinimized(!minimized)}>
        <span class="notes-title">Notes\${notes.length ? ' (' + count + ')' : ''}</span>
        <button class="notes-minimize">\${minimized ? html\`<\${IconPlus} size=\${14} stroke=\${1.5} />\` : html\`<\${IconMinus} size=\${14} stroke=\${1.5} />\`}</button>
      </div>
      <div class="notes-body">
        \${!isViewOnly ? html\`<\${NoteInput} onAdd=\${onAdd} onUpdate=\${onUpdate} onSelectionActive=\${handleSelectionActive}
          editingNote=\${editingNote} onClearEditing=\${handleClearEditing}
          onSelTextChange=\${handleSelTextChange} onNoteCreated=\${handleNoteCreated} />\` : null}
        \${openNotes.length || resolvedNotes.length ? html\`
          <div class="note-list">
            \${openNotes.length ? html\`<div class="note-list-title">Open (\${openNotes.length})</div>\` : null}
            \${openNotes.map(n => html\`<\${NoteItem} key=\${n.id} note=\${n}
              onResolve=\${isViewOnly ? null : onResolve} onDelete=\${isViewOnly ? null : onDelete} onClick=\${isViewOnly ? null : handleNoteItemClick}
              isActive=\${!isViewOnly && editingNoteId === n.id} />\`)}
            \${resolvedNotes.length ? html\`<div class="note-list-title" style="margin-top: 0.5rem">Resolved (\${resolvedNotes.length})</div>\` : null}
            \${resolvedNotes.map(n => html\`<\${NoteItem} key=\${n.id} note=\${n}
              onResolve=\${isViewOnly ? null : onResolve} onDelete=\${isViewOnly ? null : onDelete} onClick=\${isViewOnly ? null : handleNoteItemClick}
              isActive=\${false} />\`)}
          </div>\` : null}
      </div>
    </aside>\`;
}

// ── Chat ──

function ChatPanel({ getArticleText, notes }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const streamingRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages]);
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 96) + 'px';
  }, []);

  const handleInput = useCallback((e) => {
    setInput(e.target.value);
    autoResize();
  }, [autoResize]);

  // Render a single assistant message to HTML via marked, with optional streaming cursor
  const renderAssistant = useCallback((content, isStreaming) => {
    let html = marked.parse(content || '');
    if (isStreaming) html += '<span class="chat-cursor"></span>';
    return html;
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streamingRef.current) return;
    const userMsg = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);
    streamingRef.current = true;
    // Reset textarea height
    if (inputRef.current) inputRef.current.style.height = '';

    try {
      const articleText = getArticleText ? getArticleText() : '';
      const activeNotes = notes && notes.length
        ? notes.filter(n => !n.resolved).map(n => ({ text: n.text, comment: n.comment }))
        : undefined;
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, articleContext: articleText, notesContext: activeNotes }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'request failed' }));
        setMessages(m => [...m, { role: 'error', content: err.error || 'request failed' }]);
        setStreaming(false);
        streamingRef.current = false;
        return;
      }
      // Stream SSE
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      setMessages(m => [...m, { role: 'assistant', content: '' }]);
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                assistantText += parsed.text;
                setMessages(m => {
                  const copy = m.slice();
                  copy[copy.length - 1] = { role: 'assistant', content: assistantText };
                  return copy;
                });
              }
              if (parsed.error) {
                setMessages(m => [...m.slice(0, -1), { role: 'error', content: parsed.error }]);
              }
            } catch {}
          }
        }
      }
    } catch (e) {
      setMessages(m => [...m, { role: 'error', content: 'Connection failed' }]);
    }
    setStreaming(false);
    streamingRef.current = false;
  }, [input, messages, getArticleText, notes]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }, [send]);

  const clearChat = useCallback(() => { setMessages([]); }, []);

  if (!open) {
    return html\`<button class="chat-toggle" onClick=\${() => setOpen(true)} title="Chat with AI">\u{1F4AC}</button>\`;
  }

  return html\`
    <div class="chat-panel">
      <div class="chat-header">
        <span>Chat</span>
        <div style="display:flex;gap:0.5rem">
          <button onClick=\${clearChat}>Clear</button>
          <button onClick=\${() => setOpen(false)}>✕</button>
        </div>
      </div>
      <div class="chat-messages">
        \${messages.length === 0 ? html\`<div class="chat-empty">Ask questions, request edits, or discuss this article</div>\` : null}
        \${messages.map((m, i) => m.role === 'error'
          ? html\`<div key=\${i} class="chat-error">\u{26A0} \${m.content}</div>\`
          : m.role === 'assistant'
            ? html\`<div key=\${i} class="chat-msg assistant"
                ref=\${el => { if (el) el.innerHTML = renderAssistant(m.content, streaming && i === messages.length - 1); }} />\`
            : html\`<div key=\${i} class="chat-msg user">\${m.content}</div>\`
        )}
        <div ref=\${messagesEndRef} />
      </div>
      <div class="chat-input-area">
        <div class="chat-input-row">
          <textarea ref=\${inputRef} value=\${input} onInput=\${handleInput}
            onKeyDown=\${handleKeyDown} placeholder="Ask about this article\u{2026}"
            disabled=\${streaming} rows="1" />
          <button onClick=\${send} disabled=\${streaming || !input.trim()}>Send</button>
        </div>
        <div class="chat-input-hint">Enter to send \u{00B7} Shift+Enter for newline</div>
      </div>
    </div>\`;
}

// ── DocApp ──

function DocApp() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [mode, setModeState] = useState('read');
  const [markdown, setMarkdown] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [autoSave, setAutoSave] = useState(true);
  const [conflictState, setConflictState] = useState(false);
  const [renderVersion, setRenderVersion] = useState(0);
  const [tocVersion, setTocVersion] = useState(0);

  const fileMtimeRef = useRef(null);
  const wasAutoSaveRef = useRef(false);
  const autoSaveTimerRef = useRef(null);
  const tocTimerRef = useRef(null);
  const cmEditorRef = useRef(null);
  const cmThemeCompRef = useRef(null);
  const notesHook = useNotes(FILE_PATH);
  const { notes, notesRef, load: loadNotes, addNote, updateNote, resolveNote, deleteNote } = notesHook;

  const markdownRef = useLatest(markdown);

  // Word count
  const wordCount = useMemo(() => {
    const t = markdown.trim();
    return t ? t.split(/\\s+/).length : 0;
  }, [markdown]);
  const readTime = useMemo(() => wordCount > 0 ? Math.max(1, Math.ceil(wordCount / 238)) : 0, [wordCount]);

  // Get current content from active editor
  const getContent = useCallback(() => {
    if (mode === 'raw' && cmEditorRef.current) return cmEditorRef.current.state.doc.toString();
    const fe = document.getElementById('formatted-editor');
    if (mode === 'formatted' && fe) return htmlToMarkdown(fe);
    return markdownRef.current;
  }, [mode]);

  const getArticleText = useCallback(() => markdownRef.current, []);

  // Save function
  const save = useCallback(async () => {
    const fe = document.getElementById('formatted-editor');
    // syncAnnotationTexts mutates note objects in-place when the underlying
    // text changed in the formatted editor. Track whether anything actually
    // changed so we only re-persist annotations when needed (avoids racing
    // with annotation mutations that already persisted themselves).
    let notesNeedSave = false;
    if (mode === 'formatted' && fe) {
      const before = JSON.stringify(notesRef.current);
      syncAnnotationTexts(fe, notesRef.current);
      if (JSON.stringify(notesRef.current) !== before) notesNeedSave = true;
    }
    const content = getContent();

    const path = FILE_PATH;
    const putMtime = conflictState ? null : fileMtimeRef.current;
    const res = await fetch('/api/file/' + path, {
      method: 'PUT', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ content, mtime: putMtime })
    });
    if (res.ok) {
      const d = await res.json();
      setIsDirty(false);
      setMarkdown(content);
      fileMtimeRef.current = d.mtime || null;
      if (conflictState) {
        setConflictState(false);
        if (wasAutoSaveRef.current) setAutoSave(true);
        wasAutoSaveRef.current = false;
      }
      // Only re-persist annotations if syncAnnotationTexts actually mutated
      // them. The annotation hook persists its own mutations, so re-PUTing
      // a stale closure of notes here was racing with in-flight writes
      // and clobbering them — that is the "saving in parts" bug.
      if (notesNeedSave) await notesHook.persist(notesRef.current);
    } else if (res.status === 409) {
      if (!isDirty) {
        // Silent reload
        const reload = await fetch('/api/file/' + path);
        if (reload.ok) {
          const rd = await reload.json();
          setMarkdown(rd.content);
          fileMtimeRef.current = rd.mtime || null;
          setIsDirty(false);
          setRenderVersion(v => v + 1);
        }
      } else {
        // Enter conflict
        setConflictState(true);
        wasAutoSaveRef.current = autoSave;
        if (autoSave) setAutoSave(false);
      }
    } else {
      const d = await res.json();
      alert('Error: ' + (d.error || 'save failed'));
    }
  }, [mode, conflictState, isDirty, autoSave, getContent]);

  const saveRef = useLatest(save);
  const autoSaveRef = useLatest(autoSave);
  const modeRef = useLatest(mode);

  // Mark dirty
  const markDirty = useCallback(() => {
    setIsDirty(true);
    clearTimeout(autoSaveTimerRef.current);
    if (autoSaveRef.current) {
      autoSaveTimerRef.current = setTimeout(() => saveRef.current(), 1500);
    }
    clearTimeout(tocTimerRef.current);
    tocTimerRef.current = setTimeout(() => {
      setTocVersion(v => v + 1);
      if (modeRef.current === 'raw' && cmEditorRef.current) {
        setMarkdown(cmEditorRef.current.state.doc.toString());
      }
    }, 800);
  }, []);

  // Conflict detection
  useConflictDetection(FILE_PATH, fileMtimeRef, async () => {
    if (isDirty) {
      setConflictState(true);
      wasAutoSaveRef.current = autoSave;
      if (autoSave) setAutoSave(false);
    } else {
      const fileRes = await fetch('/api/file/' + FILE_PATH);
      if (fileRes.ok) {
        const fd = await fileRes.json();
        setMarkdown(fd.content);
        fileMtimeRef.current = fd.mtime || null;
        setIsDirty(false);
        rerender();
      }
    }
  });

  // Mode switching
  const pendingScrollRef = useRef(null);
  const setMode = useCallback((newMode) => {
    pendingScrollRef.current = window.scrollY;
    // Extract content from previous mode
    if (mode === 'formatted' && newMode !== 'formatted') {
      setMarkdown(htmlToMarkdown(document.getElementById('formatted-editor')));
    } else if (mode === 'raw' && cmEditorRef.current) {
      setMarkdown(cmEditorRef.current.state.doc.toString());
    }
    setModeState(newMode);
    setRenderVersion(v => v + 1);
    setTocVersion(v => v + 1);
  }, [mode]);

  // Restore scroll position after mode switch
  useEffect(() => {
    if (pendingScrollRef.current != null) {
      const y = pendingScrollRef.current;
      pendingScrollRef.current = null;
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, y);
      document.documentElement.style.scrollBehavior = '';
    }
  }, [mode]);

  // Note actions — bump renderVersion to re-apply highlights
  const rerender = useCallback(() => setRenderVersion(v => v + 1), []);
  const handleAddNote = useCallback(async (text, comment) => { const n = await addNote(text, comment); rerender(); return n; }, [addNote]);
  const handleResolve = useCallback(async (id) => { await resolveNote(id); rerender(); }, [resolveNote]);
  const handleDelete = useCallback(async (id) => { await deleteNote(id); rerender(); }, [deleteNote]);
  const handleUpdate = useCallback(async (id, comment) => { await updateNote(id, comment); }, [updateNote]);

  // Click highlight → scroll to note in sidebar
  const handleHighlightClick = useCallback((annId) => {
    const item = document.querySelector('[data-note-item="' + annId + '"]');
    if (item) {
      item.style.outline = '2px solid var(--accent)';
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => { item.style.outline = ''; }, 2000);
    }
  }, []);

  // Click note in sidebar → scroll to highlight
  const handleNoteClick = useCallback((annId) => {
    const span = document.querySelector('[data-ann-id="' + annId + '"]');
    if (span) {
      span.scrollIntoView({ behavior: 'smooth', block: 'center' });
      clearActiveHighlights();
      span.classList.add('active');
      setTimeout(() => span.classList.remove('active'), 3000);
    }
  }, []);

  // Init: load file + annotations
  useEffect(() => {
    (async () => {
      const [mdRes] = await Promise.all([
        fetch('/api/file/' + FILE_PATH),
        loadNotes()
      ]);
      if (!mdRes.ok) return;
      const data = await mdRes.json();
      setMarkdown(data.content);
      fileMtimeRef.current = data.mtime || null;
      if (!data.content) setModeState('raw');
      // Trigger TOC rebuild after content arrives
      setTocVersion(v => v + 1);
    })();
  }, []);

  // Beforeunload
  useEffect(() => {
    const handler = e => { if (isDirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  return html\`
    <\${ProgressBar} />
    <\${TopBar} mode=\${mode} onSetMode=\${setMode} isDirty=\${isDirty} autoSave=\${autoSave}
      onSetAutoSave=\${setAutoSave} onSave=\${save} conflictState=\${conflictState}
      wordCount=\${wordCount} readTime=\${readTime} theme=\${theme} onToggleTheme=\${toggleTheme} />
    \${mode !== 'read' ? html\`<div class="top-bar-spacer"></div>\` : null}
    <\${TocSidebar} mode=\${mode} cmEditorRef=\${cmEditorRef} tocVersion=\${tocVersion} markdown=\${markdown} isDirty=\${isDirty} />
    <div class="layout">
      <main class="main-col">
        \${mode === 'read' ? html\`<\${ReadView} markdown=\${markdown} notes=\${notes}
          onHighlightClick=\${handleHighlightClick} renderVersion=\${renderVersion} />\` : null}
        \${mode === 'raw' ? html\`<\${RawEditor} markdown=\${markdown} onDirty=\${markDirty}
          cmEditorRef=\${cmEditorRef} cmThemeCompRef=\${cmThemeCompRef} theme=\${theme} />\` : null}
        \${mode === 'formatted' ? html\`<\${FormattedEditor} markdown=\${markdown} notes=\${notes}
          onDirty=\${markDirty} renderVersion=\${renderVersion} />\` : null}
      </main>
    </div>
    <\${NotesSidebar} notes=\${notes} onAdd=\${handleAddNote} onUpdate=\${handleUpdate}
      onResolve=\${handleResolve} onDelete=\${handleDelete} mode=\${mode}
      onNoteClick=\${handleNoteClick} />
    \${mode === 'raw' ? html\`<\${EmailPanel} markdown=\${markdown} />\` : null}
    \${CHAT_ENABLED ? html\`<\${ChatPanel} getArticleText=\${getArticleText} notes=\${notes} />\` : null}\`;
}

render(html\`<\${DocApp} />\`, document.getElementById('app'));
</script>`);
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function safePath(rel: string): string | null {
  const fp = resolve(BASE_DIR, rel);
  if (fp !== BASE_DIR && !fp.startsWith(BASE_DIR + "/")) return null;
  return fp;
}

// Thrown by route helpers; converted to a JSON error response at the top of handler().
class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Resolve a route-relative path within BASE_DIR, or throw 403.
function mustResolve(rel: string): string {
  const fp = safePath(rel);
  if (!fp) throw new HttpError(403, "path not allowed");
  return fp;
}

// Stat a file, or throw 404 if it doesn't exist / isn't readable.
async function statOr404(fp: string): Promise<Deno.FileInfo> {
  try {
    return await Deno.stat(fp);
  } catch {
    throw new HttpError(404, "not found");
  }
}

function getMtime(stat: Deno.FileInfo): number | null {
  return stat.mtime ? stat.mtime.getTime() / 1000 : null;
}

// ── Route handler ───────────────────────────────────────────────────────────────

async function handler(req: Request, info: Deno.ServeHandlerInfo): Promise<Response> {
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname);
  const method = req.method;

  try {
    return await route(req, method, path, info);
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse({ error: e.message }, e.status);
    throw e;
  }
}

async function route(
  req: Request,
  method: string,
  path: string,
  info: Deno.ServeHandlerInfo,
): Promise<Response> {
  // Log page visits (HTML pages, not API/asset requests)
  if (method === "GET" && (path === "/" || path.startsWith("/doc/"))) {
    const ua = req.headers.get("user-agent") || "unknown";
    const ip = info.remoteAddr.transport === "tcp" ? info.remoteAddr.hostname : "?";
    const now = new Date().toISOString();
    console.log(`[${now}] ${ip} GET ${path} — ${ua}`);
  }

  // GET /
  if (method === "GET" && path === "/") {
    const files: { rel: string; name: string; mtime: number; mins: number }[] = [];
    await collectFiles(BASE_DIR, "", files);
    files.sort((a, b) => a.name.localeCompare(b.name));
    return htmlResponse(indexPage(files));
  }

  // GET /doc/:path
  if (method === "GET" && path.startsWith("/doc/")) {
    const rawRel = path.slice(5);
    // Normalize trailing slash for directory lookups (keep a flag for redirect)
    const trailingSlash = rawRel.endsWith("/");
    const rel = trailingSlash ? rawRel.slice(0, -1) : rawRel;
    const fp = safePath(rel);
    if (!fp) return htmlResponse("<h1>Not found</h1>", 404);
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(fp);
    } catch {
      return htmlResponse("<h1>Not found</h1>", 404);
    }
    // (kept as html-404 rather than HttpError JSON — this is a page route)
    if (stat.isDirectory) {
      // Canonicalize directory URLs to end with "/" so relative links work
      if (!trailingSlash) {
        return new Response(null, {
          status: 301,
          headers: { Location: "/doc/" + rel + "/" },
        });
      }
      const files: { rel: string; name: string; mtime: number; mins: number }[] = [];
      await collectFiles(fp, "", files);
      return htmlResponse(indexPage(files, rel));
    }
    const name = basename(fp, ".md");
    const title = name.replace(/[_-]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    return htmlResponse(docPage(title, rel));
  }

  // GET /new — create new_document.md (with counter if needed) and redirect
  if (method === "GET" && path === "/new") {
    let name = "new_document.md";
    let fp = join(BASE_DIR, name);
    let i = 2;
    while (true) {
      try { await Deno.stat(fp); } catch { break; }
      name = `new_document_${i}.md`;
      fp = join(BASE_DIR, name);
      i++;
    }
    await Deno.writeTextFile(fp, "");
    return new Response(null, { status: 302, headers: { Location: "/doc/" + name } });
  }

  // GET /static/*
  if (method === "GET" && path.startsWith("/static/")) {
    const fp = mustResolve(path.slice(8));
    try {
      const data = await Deno.readFile(fp);
      const mime = MIME[extname(fp).toLowerCase()] || "application/octet-stream";
      return new Response(data, { headers: { "Content-Type": mime } });
    } catch {
      throw new HttpError(404, "not found");
    }
  }

  // GET /api/file/:path
  if (method === "GET" && path.startsWith("/api/file/")) {
    const fp = mustResolve(path.slice(10));
    const stat = await statOr404(fp);
    return jsonResponse({ content: await Deno.readTextFile(fp), mtime: getMtime(stat) });
  }

  // GET /api/mtime/:path
  if (method === "GET" && path.startsWith("/api/mtime/")) {
    const fp = mustResolve(path.slice(11));
    const stat = await statOr404(fp);
    return jsonResponse({ mtime: getMtime(stat) });
  }

  // GET /api/annotations/:path
  if (method === "GET" && path.startsWith("/api/annotations/")) {
    const fp = mustResolve(path.slice(17) + ".annotations.json");
    try {
      return jsonResponse(JSON.parse(await Deno.readTextFile(fp)));
    } catch {
      // No annotations file yet (or unreadable) — return an empty set, not an error.
      return jsonResponse({ annotations: [] });
    }
  }

  // PUT /api/file/:path
  if (method === "PUT" && path.startsWith("/api/file/")) {
    const fp = mustResolve(path.slice(10));
    if (!fp.endsWith(".md")) throw new HttpError(400, "only .md files");
    await statOr404(fp);
    const body = await req.json();
    const expectedMtime = body.mtime;
    if (expectedMtime != null) {
      const stat = await Deno.stat(fp);
      const currentMtime = getMtime(stat) || 0;
      if (Math.abs(currentMtime - expectedMtime) > 0.01) {
        return jsonResponse({ error: "conflict", disk_mtime: currentMtime }, 409);
      }
    }
    await Deno.writeTextFile(fp, body.content || "");
    const newStat = await Deno.stat(fp);
    return jsonResponse({ ok: true, mtime: getMtime(newStat) });
  }

  // PUT /api/annotations/:path
  if (method === "PUT" && path.startsWith("/api/annotations/")) {
    const fp = mustResolve(path.slice(17) + ".annotations.json");
    const body = await req.json();
    await Deno.writeTextFile(fp, JSON.stringify(body, null, 2));
    return jsonResponse({ ok: true });
  }

  // POST /api/rename
  if (method === "POST" && path === "/api/rename") {
    const body = await req.json();
    const fromRel: string = body.from || "";
    const toName: string = body.toName || "";
    if (!fromRel || !toName || !toName.endsWith(".md")) {
      return jsonResponse({ error: "invalid parameters" }, 400);
    }
    const fromFp = mustResolve(fromRel);
    // Preserve directory structure, only change the filename
    const fromDir = dirname(fromRel);
    let newRel = fromDir === "." ? toName : fromDir + "/" + toName;
    let newFp = mustResolve(newRel);
    // If target already exists, append a short random suffix
    try {
      await Deno.stat(newFp);
      const suffix = '_' + Math.random().toString(36).slice(2, 6);
      const suffixed = toName.replace(/\.md$/, '') + suffix + '.md';
      newRel = fromDir === "." ? suffixed : fromDir + "/" + suffixed;
      newFp = mustResolve(newRel);
    } catch {
      // Good — target doesn't exist
    }
    try {
      await Deno.rename(fromFp, newFp);
      // Rename annotations sidecar if it exists
      const annFrom = fromFp + ".annotations.json";
      const annTo = newFp + ".annotations.json";
      try {
        await Deno.stat(annFrom);
        await Deno.rename(annFrom, annTo);
      } catch {
        // No annotations file — that's fine
      }
      return jsonResponse({ ok: true, newPath: newRel });
    } catch (e) {
      return jsonResponse({ error: "rename failed: " + (e as Error).message }, 500);
    }
  }

  // POST /api/chat
  if (method === "POST" && path === "/api/chat") {
    if (!chatModel) {
      return jsonResponse({ error: "No LLM API key set (ANTHROPIC_API_KEY or OPENAI_API_KEY)" }, 500);
    }
    const body = await req.json();
    const userMessages = (body.messages || []).map((m: { role: string; content: string }) => ({
      role: m.role === 'user' ? 'user' as const : 'assistant' as const,
      content: m.content,
    }));
    if (!userMessages.length) return jsonResponse({ error: "no messages" }, 400);

    const notesBlock = body.notesContext && body.notesContext.length
      ? `\n\nThe user has highlighted and annotated these passages:\n${body.notesContext.map((n: {text: string; comment?: string}, i: number) => `${i + 1}. Highlighted: "${n.text}"${n.comment ? ` — Note: "${n.comment}"` : ''}`).join('\n')}`
      : '';

    const systemPrompt = body.articleContext
      ? `You are a reading, writing, and editing assistant for a markdown article. The user is actively working with this article — they may ask questions about its content, request edits or rewrites of specific sections, ask for summaries, fact-checking, style improvements, or structural help. Be concise but thorough. Use markdown formatting in your responses when helpful. When suggesting edits, quote the original passage and provide the replacement.\n\n<article>\n${body.articleContext}\n</article>${notesBlock}`
      : 'You are a reading, writing, and editing assistant. Be concise but thorough. Use markdown formatting in your responses when helpful.';

    try {
      const result = streamText({
        model: chatModel,
        system: systemPrompt,
        messages: userMessages,
        maxTokens: 4096,
      });

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of result.textStream) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          } catch (e) {
            console.error("chat stream error:", e);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'stream error' })}\n\n`));
          }
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } catch (e) {
      console.error("chat request error:", e);
      return jsonResponse({ error: 'Failed to reach LLM API' }, 502);
    }
  }

  // POST /api/send-email — send a rendered HTML email via Resend.
  if (method === "POST" && path === "/api/send-email") {
    if (!RESEND_API_KEY) return jsonResponse({ error: "RESEND_API_KEY not set" }, 500);
    try {
      const body = await req.json();
      const { to, subject, html, attachments } = body;
      if (!to || !html) return jsonResponse({ error: "missing to/html" }, 400);
      const payload: Record<string, unknown> = {
        from: "Piranesi <onboarding@resend.dev>",
        to: Array.isArray(to) ? to : [to],
        subject: subject || "Document",
        html,
      };
      if (Array.isArray(attachments) && attachments.length) payload.attachments = attachments;

      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + RESEND_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return jsonResponse({ error: (data && (data.message || data.name)) || ("Resend error " + r.status), detail: data }, r.status);
      }
      return jsonResponse({ ok: true, id: data.id });
    } catch (e) {
      return jsonResponse({ error: "send failed: " + (e instanceof Error ? e.message : String(e)) }, 500);
    }
  }

  return jsonResponse({ error: "not found" }, 404);
}

// ── File collection ─────────────────────────────────────────────────────────────

async function collectFiles(
  baseDir: string,
  relDir: string,
  out: { rel: string; name: string; mtime: number; mins: number }[]
): Promise<void> {
  const dir = relDir ? join(baseDir, relDir) : baseDir;
  for await (const entry of Deno.readDir(dir)) {
    const rel = relDir ? relDir + "/" + entry.name : entry.name;
    if (entry.isDirectory) {
      await collectFiles(baseDir, rel, out);
    } else if (entry.isFile && entry.name.endsWith(".md") && !entry.name.endsWith(".annotations.json")) {
      const fp = join(dir, entry.name);
      const stat = await Deno.stat(fp);
      const content = await Deno.readTextFile(fp);
      const words = content.split(/\s+/).filter(w => w).length;
      out.push({
        rel,
        name: entry.name.replace(/\.md$/, ""),
        mtime: getMtime(stat) || 0,
        mins: Math.max(1, Math.ceil(words / 238)),
      });
    }
  }
}

// ── Server ──────────────────────────────────────────────────────────────────────

// Verify base dir exists
try {
  const stat = await Deno.stat(BASE_DIR);
  if (!stat.isDirectory) {
    console.error(`Error: ${BASE_DIR} is not a directory`);
    Deno.exit(1);
  }
} catch {
  console.error(`Error: ${BASE_DIR} does not exist`);
  Deno.exit(1);
}

function tryPort(port: number): boolean {
  try {
    const listener = Deno.listen({ port, hostname: "127.0.0.1" });
    listener.close();
    return true;
  } catch {
    return false;
  }
}

let port = PREFERRED_PORT;
while (!tryPort(port) && port < PREFERRED_PORT + 100) port++;

console.log(`piranesi \u2192 http://localhost:${port}`);
console.log(`  serving from ${BASE_DIR}`);
console.log(`  chat: ${ANTHROPIC_API_KEY ? 'Anthropic' : OPENAI_API_KEY ? 'OpenAI' : 'disabled (no API key)'}`);

Deno.serve({ port, hostname: "127.0.0.1" }, handler);
