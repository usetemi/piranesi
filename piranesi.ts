#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env
/**
 * mdmaster — unified markdown reader/writer
 * Single-file Deno server. Preact+htm client via CDN. Zero deps.
 *
 * Usage: deno run --allow-net --allow-read --allow-write mdmaster.ts [directory]
 *        Defaults to working_data/
 */

import { resolve, join, extname, basename, dirname } from "https://deno.land/std@0.224.0/path/mod.ts";

// ── Config ──────────────────────────────────────────────────────────────────────

const PREFERRED_PORT = parseInt(Deno.env.get("PORT") || "8888");
const BASE_DIR = resolve(Deno.args[0] || "working_data/");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

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
  --bg: #0a0a0a; --fg: #e7e5e4; --fg2: #a8a29e; --fg3: #57534e;
  --border: #1c1917; --card-bg: #0c0a09; --card-hover: #1c1917;
  --accent: #00a3ff; --link: #00a3ff;
  --highlight: rgba(251, 191, 36, 0.3); --highlight-hover: rgba(251, 191, 36, 0.5);
  --blockquote-bg: #0c0a09; --blockquote-border: #004c99;
  --code-bg: #0c0a09; --code-border: #1c1917;
  --hr: #1c1917; --progress: #00a3ff;
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
.prose strong { font-weight: 600; letter-spacing: -0.005em; }
.prose em { font-style: italic; }
.prose a.section-ref { color: inherit; text-decoration: none; cursor: pointer; }
.prose a.section-ref:hover { color: var(--accent); text-decoration: underline; }
.prose .section-ref-sym { font-style: normal; color: var(--accent); font-size: 0.85em; vertical-align: baseline; position: relative; top: -0.05em; }
.prose ul, .prose ol { margin: 0.4rem 0 0.85rem 1.25rem; }
.prose li { margin-bottom: 0.25rem; }
.prose li > ul, .prose li > ol { margin-top: 0.2rem; margin-bottom: 0.2rem; }
.prose li::marker { color: var(--fg3); }
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
.prose img { max-width: 100%; height: auto; border-radius: 0; margin: 1rem 0; }
.prose blockquote img { float: right; max-width: 160px; margin: 0 0 0.75rem 1.25rem; border-radius: 0; }
.prose > p:first-child::first-letter {
  font-family: 'Lora', Georgia, serif; font-size: 3.2em; font-weight: 600;
  float: left; line-height: 0.8; margin: 0.1em 0.12em 0 0; color: var(--accent);
}
.prose strong em, .prose em strong { color: var(--accent); }
/* Footnotes */
.prose .footnote-ref { font-size: 0.75em; text-decoration: none; color: var(--accent); font-weight: 600; }
.prose .footnote-ref:hover { text-decoration: underline; }
.prose .footnote-tooltip {
  display: none; position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
  background: #1c1917; color: #f5f5f4; padding: 0.5rem 0.75rem; border-radius: 8px;
  font-size: 0.78rem; line-height: 1.5; width: max-content; max-width: 320px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.2); z-index: 50; pointer-events: none;
  margin-bottom: 6px; font-weight: 400; text-align: left; white-space: normal;
}
.prose .footnote-tooltip p { margin: 0; }
.prose .footnote-tooltip::after {
  content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  border: 5px solid transparent; border-top-color: #1c1917;
}
.prose sup:hover .footnote-tooltip { display: block; }
[data-theme="dark"] .prose .footnote-tooltip { background: #292524; color: #e7e5e4; }
[data-theme="dark"] .prose .footnote-tooltip::after { border-top-color: #292524; }
.prose sup { line-height: 0; position: relative; }
.prose sup::after {
  content: ''; position: absolute; inset: -2px -4px;
  background: linear-gradient(-45deg, transparent 35%, rgba(255,255,255,0.1) 42%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0.1) 58%, transparent 65%);
  background-size: 300% 300%; background-position: 200% 200%;
  pointer-events: none; opacity: 0; border-radius: 2px; transition: opacity 0.3s;
}
.prose sup:hover::after { animation: fn-shine 3s 0.1s linear infinite; opacity: 1; }
.prose .footnote-back { text-decoration: none; color: var(--accent); }
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
.top-bar-spacer { height: 2.75rem; }
.top-bar a { color: var(--fg2); text-decoration: none; font-size: 0.85rem; }
.top-bar a:hover { color: var(--fg); }
.top-bar .word-count { color: var(--fg3); font-size: 0.75rem; margin-left: 0.75rem; }
.top-left { display: flex; align-items: center; }
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
/* New file bar */
.new-file-bar {
  display: flex; gap: 0.5rem; align-items: center; margin-top: 1rem;
  padding: 0.75rem; background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px;
}
.new-file-bar input {
  flex: 1; border: 1px solid var(--border); border-radius: 6px;
  padding: 0.4rem 0.6rem; font-size: 0.85rem; font-family: inherit;
  background: var(--bg); color: var(--fg);
}
.new-file-bar input:focus { outline: none; border-color: var(--accent); }
.new-file-bar span { color: var(--fg2); font-size: 0.82rem; }
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
.note-save-status.fading { opacity: 0; }
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
.file-table { width: 100%; border-collapse: collapse; }
.file-table th {
  text-align: left; padding: 0.5rem 0.75rem; font-size: 0.72rem; font-weight: 600;
  color: var(--fg3); text-transform: uppercase; letter-spacing: 0.06em;
  border-bottom: 1px solid var(--border); cursor: pointer; user-select: none; white-space: nowrap;
}
.file-table th:hover { color: var(--fg2); }
.file-table th .sort-arrow { margin-left: 0.3rem; font-size: 0.65rem; }
.file-table td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border); }
.file-table tr:hover td { background: var(--card-hover); }
.file-table tr td:first-child { font-weight: 500; max-width: 420px; }
.file-table a { color: var(--fg); text-decoration: none; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-table a:hover { color: var(--accent); }
.file-meta-cell { color: var(--fg2); font-size: 0.82rem; white-space: nowrap; }
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
  width: 360px; max-height: 500px; display: flex; flex-direction: column;
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
  min-height: 200px; max-height: 380px;
}
.chat-messages::-webkit-scrollbar { width: 3px; }
.chat-messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.chat-msg {
  font-size: 0.82rem; line-height: 1.5; padding: 0.5rem 0.7rem;
  border-radius: 10px; max-width: 88%; word-break: break-word; white-space: pre-wrap;
}
.chat-msg.user {
  align-self: flex-end; background: var(--accent); color: #fff;
  border-bottom-right-radius: 3px;
}
.chat-msg.assistant {
  align-self: flex-start; background: var(--code-bg); color: var(--fg);
  border-bottom-left-radius: 3px;
}
.chat-msg.assistant p { margin: 0 0 0.4rem; }
.chat-msg.assistant p:last-child { margin-bottom: 0; }
.chat-msg.assistant code { background: var(--border); padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.78rem; }
.chat-input-row {
  display: flex; gap: 0.4rem; padding: 0.6rem 0.75rem; border-top: 1px solid var(--border);
}
.chat-input-row input {
  flex: 1; border: 1px solid var(--border); border-radius: 8px;
  padding: 0.4rem 0.6rem; font-size: 0.82rem; font-family: inherit;
  background: var(--bg); color: var(--fg); outline: none;
}
.chat-input-row input:focus { border-color: var(--accent); }
.chat-input-row button {
  background: var(--accent); color: #fff; border: none; border-radius: 8px;
  padding: 0.4rem 0.7rem; font-size: 0.78rem; cursor: pointer; font-weight: 500;
  white-space: nowrap;
}
.chat-input-row button:disabled { opacity: 0.4; cursor: default; }
.chat-empty { color: var(--fg3); font-size: 0.78rem; text-align: center; padding: 2rem 1rem; }
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

const ALL_CSS = THEME_CSS + PROSE_CSS + LAYOUT_CSS + EDITOR_CSS + ANNOTATION_CSS + INDEX_CSS + CHAT_CSS + RESPONSIVE_CSS;

// ── Page builders ───────────────────────────────────────────────────────────────

function shell(title: string, css: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function indexPage(files: { rel: string; name: string; mtime: number; mins: number }[]): string {
  const label = basename(BASE_DIR);
  const filesJson = JSON.stringify(files);
  return shell(`mdmaster / ${label}`, ALL_CSS, `
<div id="app"></div>
<script type="module">
import { h, render } from 'https://esm.sh/preact@10';
import { useState, useEffect, useCallback, useMemo } from 'https://esm.sh/preact@10/hooks';
import htm from 'https://esm.sh/htm@3';
const html = htm.bind(h);

const FILES = ${filesJson};
const LABEL = ${JSON.stringify(label)};

function useTheme() {
  const [theme, setThemeState] = useState(() => {
    const s = localStorage.getItem('mdmaster-theme');
    if (s) return s;
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('mdmaster-theme', theme);
  }, [theme]);
  const toggle = useCallback(() => setThemeState(t => t === 'dark' ? 'light' : 'dark'), []);
  return { theme, toggle };
}

function ThemeToggle({ theme, onToggle }) {
  return html\`<button class="theme-toggle" onClick=\${onToggle}>\${theme === 'dark' ? '\\u2600\\uFE0F' : '\\uD83C\\uDF19'}</button>\`;
}

function FileTable({ files, sortCol, sortDir, onSort }) {
  const arrow = (col) => sortCol === col ? (sortDir === 1 ? '\\u25B2' : '\\u25BC') : '';
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
        \${files.map(f => {
          const d = new Date(f.mtime * 1000);
          const ds = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          return html\`
            <tr key=\${f.rel}>
              <td><a href=\${'/doc/' + f.rel}>\${f.name}</a></td>
              <td class="file-meta-cell">\${ds}</td>
              <td class="file-meta-cell">\${f.mins} min</td>
            </tr>\`;
        })}
      </tbody>
    </table>\`;
}

function IndexApp() {
  const { theme, toggle } = useTheme();
  const [sortCol, setSortCol] = useState('modified');
  const [sortDir, setSortDir] = useState(-1);

  const handleSort = useCallback((col) => {
    setSortCol(prev => {
      if (prev === col) { setSortDir(d => d * -1); return col; }
      setSortDir(col === 'modified' ? -1 : 1);
      return col;
    });
  }, []);

  const sorted = useMemo(() => {
    return FILES.slice().sort((a, b) => {
      let v;
      if (sortCol === 'name') v = a.name.localeCompare(b.name);
      else if (sortCol === 'modified') v = a.mtime - b.mtime;
      else if (sortCol === 'read') v = a.mins - b.mins;
      return v * sortDir;
    });
  }, [sortCol, sortDir]);

  return html\`
    <div class="index-container">
      <header class="index-header">
        <h1>mdmaster <span>/ \${LABEL}</span></h1>
        <div class="header-controls">
          <a class="new-btn" href="/new">+ New</a>
          <\${ThemeToggle} theme=\${theme} onToggle=\${toggle} />
        </div>
      </header>
      <\${FileTable} files=\${sorted} sortCol=\${sortCol} sortDir=\${sortDir} onSort=\${handleSort} />
    </div>\`;
}

render(html\`<\${IndexApp} />\`, document.getElementById('app'));
</script>`);
}

function dirPage(relDir: string, entries: DirEntry[]): string {
  const label = basename(BASE_DIR);
  const entriesJson = JSON.stringify(entries);
  const segments = relDir.split("/").filter(Boolean);
  // Build breadcrumb: [{ name, href }] starting with the root.
  const crumbs: { name: string; href: string }[] = [{ name: label, href: "/" }];
  let acc = "";
  for (const seg of segments) {
    acc = acc ? acc + "/" + seg : seg;
    crumbs.push({ name: seg, href: "/doc/" + acc + "/" });
  }
  const crumbsJson = JSON.stringify(crumbs);
  const titleStr = relDir ? `${label} / ${relDir}` : label;
  return shell(`mdmaster / ${titleStr}`, ALL_CSS, `
<div id="app"></div>
<script type="module">
import { h, render } from 'https://esm.sh/preact@10';
import { useState, useEffect, useCallback, useMemo } from 'https://esm.sh/preact@10/hooks';
import htm from 'https://esm.sh/htm@3';
const html = htm.bind(h);

const ENTRIES = ${entriesJson};
const CRUMBS = ${crumbsJson};

function useTheme() {
  const [theme, setThemeState] = useState(() => {
    const s = localStorage.getItem('mdmaster-theme');
    if (s) return s;
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('mdmaster-theme', theme);
  }, [theme]);
  const toggle = useCallback(() => setThemeState(t => t === 'dark' ? 'light' : 'dark'), []);
  return { theme, toggle };
}

function ThemeToggle({ theme, onToggle }) {
  return html\`<button class="theme-toggle" onClick=\${onToggle}>\${theme === 'dark' ? '\\u2600\\uFE0F' : '\\uD83C\\uDF19'}</button>\`;
}

function DirTable({ entries, sortCol, sortDir, onSort }) {
  const arrow = (col) => sortCol === col ? (sortDir === 1 ? '\\u25B2' : '\\u25BC') : '';
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
        \${entries.map(e => {
          const d = e.mtime ? new Date(e.mtime * 1000) : null;
          const ds = d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
          if (e.kind === 'dir') {
            return html\`
              <tr key=\${'d:' + e.rel}>
                <td><a href=\${'/doc/' + e.rel + '/'}>\${'\\uD83D\\uDCC1 ' + e.name}</a></td>
                <td class="file-meta-cell">\${ds}</td>
                <td class="file-meta-cell">—</td>
              </tr>\`;
          }
          return html\`
            <tr key=\${'f:' + e.rel}>
              <td><a href=\${'/doc/' + e.rel}>\${e.name}</a></td>
              <td class="file-meta-cell">\${ds}</td>
              <td class="file-meta-cell">\${e.mins} min</td>
            </tr>\`;
        })}
      </tbody>
    </table>\`;
}

function Breadcrumbs({ crumbs }) {
  return html\`
    <h1>mdmaster <span>/ \${crumbs.map((c, i) => {
      const isLast = i === crumbs.length - 1;
      return html\`<\${isLast ? 'span' : 'a'} href=\${c.href}>\${c.name}\</\${isLast ? 'span' : 'a'}>\${isLast ? '' : ' / '}\`;
    })}</span></h1>\`;
}

function DirApp() {
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

  const sorted = useMemo(() => {
    // Always keep directories before files, then sort within each group.
    const dirs = ENTRIES.filter(e => e.kind === 'dir').slice();
    const files = ENTRIES.filter(e => e.kind === 'file').slice();
    const cmp = (a, b) => {
      let v;
      if (sortCol === 'name') v = a.name.localeCompare(b.name);
      else if (sortCol === 'modified') v = (a.mtime || 0) - (b.mtime || 0);
      else if (sortCol === 'read') v = ((a.mins || 0) - (b.mins || 0));
      return v * sortDir;
    };
    dirs.sort(cmp);
    files.sort(cmp);
    return [...dirs, ...files];
  }, [sortCol, sortDir]);

  return html\`
    <div class="index-container">
      <header class="index-header">
        <\${Breadcrumbs} crumbs=\${CRUMBS} />
        <div class="header-controls">
          <a class="new-btn" href="/new">+ New</a>
          <\${ThemeToggle} theme=\${theme} onToggle=\${toggle} />
        </div>
      </header>
      <\${DirTable} entries=\${sorted} sortCol=\${sortCol} sortDir=\${sortDir} onSort=\${handleSort} />
    </div>\`;
}

render(html\`<\${DirApp} />\`, document.getElementById('app'));
</script>`);
}

function docPage(title: string, filePath: string): string {
  return shell(`${esc(title)} \u2014 mdmaster`, ALL_CSS, `
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
import { basicSetup, EditorView } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { markdown as mdLang } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
const html = htm.bind(h);
const CM = { EditorView, EditorState, basicSetup, markdown: mdLang, oneDark, Compartment };

const FILE_PATH = ${JSON.stringify(filePath)};
const IS_NEW = FILE_PATH === '__new__';

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

// ── Annotation color palette ──
const ANNOTATION_COLORS = {
  yellow: { light: 'rgba(251,191,36,0.25)', lightHover: 'rgba(251,191,36,0.45)', dark: 'rgba(251,191,36,0.3)', darkHover: 'rgba(251,191,36,0.5)', dot: 'rgb(251,191,36)' },
  blue:   { light: 'rgba(59,130,246,0.2)',  lightHover: 'rgba(59,130,246,0.4)',  dark: 'rgba(59,130,246,0.25)', darkHover: 'rgba(59,130,246,0.45)', dot: 'rgb(59,130,246)' },
  green:  { light: 'rgba(34,197,94,0.2)',   lightHover: 'rgba(34,197,94,0.4)',   dark: 'rgba(34,197,94,0.25)',  darkHover: 'rgba(34,197,94,0.45)',  dot: 'rgb(34,197,94)' },
  pink:   { light: 'rgba(244,114,182,0.2)', lightHover: 'rgba(244,114,182,0.4)', dark: 'rgba(244,114,182,0.25)',darkHover: 'rgba(244,114,182,0.45)',dot: 'rgb(244,114,182)' },
  purple: { light: 'rgba(168,85,247,0.2)',  lightHover: 'rgba(168,85,247,0.4)',  dark: 'rgba(168,85,247,0.25)', darkHover: 'rgba(168,85,247,0.45)', dot: 'rgb(168,85,247)' },
  orange: { light: 'rgba(251,146,60,0.2)',  lightHover: 'rgba(251,146,60,0.4)',  dark: 'rgba(251,146,60,0.25)', darkHover: 'rgba(251,146,60,0.45)', dot: 'rgb(251,146,60)' },
};
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
  const headings = container.querySelectorAll('h2');
  let fnHeading = null;
  headings.forEach(h => { if (/^footnotes$/i.test(h.textContent.trim())) fnHeading = h; });
  if (fnHeading) {
    const section = document.createElement('div');
    section.className = 'footnotes-section';
    fnHeading.parentNode.insertBefore(section, fnHeading);
    while (section.nextSibling) section.appendChild(section.nextSibling);
    section.querySelectorAll('ol > li').forEach(li => li.classList.add('fn-item'));
  }
  // Wire footnote refs: add class, ensure sup wrap, attach tooltip
  container.querySelectorAll('a[data-footnote-ref]').forEach(a => {
    a.classList.add('footnote-ref');
    if (a.parentNode.tagName !== 'SUP') {
      const sup = document.createElement('sup');
      a.parentNode.insertBefore(sup, a);
      sup.appendChild(a);
    }
    // Hover tooltip
    const href = a.getAttribute('href');
    if (href) {
      const fnLi = container.querySelector(href);
      if (fnLi) {
        const tip = document.createElement('div');
        tip.className = 'footnote-tooltip';
        const clone = fnLi.cloneNode(true);
        clone.querySelectorAll('[data-footnote-backref]').forEach(b => b.remove());
        tip.innerHTML = clone.innerHTML;
        const sup = a.closest('sup');
        if (sup) sup.appendChild(tip); else a.parentNode.appendChild(tip);
      }
    }
  });
  // Smooth-scroll all footnote links (both directions)
  container.querySelectorAll('a[data-footnote-ref], a[data-footnote-backref]').forEach(a => {
    a.addEventListener('click', e => {
      const href = a.getAttribute('href');
      if (!href) return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Brief highlight on the target
        target.style.outline = '2px solid var(--accent)';
        target.style.outlineOffset = '4px';
        target.style.borderRadius = '4px';
        setTimeout(() => { target.style.outline = ''; target.style.outlineOffset = ''; }, 2000);
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
    const btn = document.createElement('button');
    btn.className = 'table-expand-btn';
    btn.textContent = '\\u2922';
    btn.title = 'Expand table';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = wrap.classList.toggle('expanded');
      btn.textContent = expanded ? '\\u2921' : '\\u2922';
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
    tdInstance.addRule('annotations', {
      filter: node => node.nodeName === 'SPAN' && node.classList.contains('annotated'),
      replacement: content => content
    });
    tdInstance.addRule('evalResult', {
      filter: node => node.nodeName === 'SPAN' && node.classList.contains('eval-result'),
      replacement: (content, node) => '\x60= ' + (node.getAttribute('title') || content) + '\x60'
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
    const s = localStorage.getItem('mdmaster-theme');
    if (s) return s;
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('mdmaster-theme', theme);
  }, [theme]);
  const toggle = useCallback(() => setThemeState(t => t === 'dark' ? 'light' : 'dark'), []);
  return { theme, toggle };
}

function useConflictDetection(pathRef, mtimeRef, onConflict) {
  const onConflictRef = useLatest(onConflict);
  useEffect(() => {
    const id = setInterval(async () => {
      const path = pathRef.current;
      const mtime = mtimeRef.current;
      if (IS_NEW || !mtime || !path) return;
      try {
        const res = await fetch('/api/mtime/' + path);
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
  const savedPathRef = useRef(IS_NEW ? null : filePath);
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
    if (IS_NEW) return;
    try {
      const res = await fetch('/api/annotations/' + filePath);
      const data = await res.json();
      applyNotes(data.annotations || []);
    } catch (e) { applyNotes([]); }
  }, [filePath, applyNotes]);

  const persist = useCallback((updated) => {
    const path = savedPathRef.current;
    if (!path) return Promise.resolve();
    // Snapshot the payload and chain on the existing write queue so PUTs run
    // strictly in order — last enqueued is the last to land on disk.
    const payload = JSON.stringify({ annotations: updated });
    const next = writeChainRef.current.then(() =>
      fetch('/api/annotations/' + path, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: payload,
      }).catch(() => {})
    );
    writeChainRef.current = next;
    return next;
  }, []);

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

  return { notes, notesRef, setNotes: applyNotes, load, persist, addNote, updateNote, resolveNote, deleteNote, savedPathRef };
}

// ── Components ──

function ThemeToggle({ theme, onToggle }) {
  return html\`<button class="theme-toggle" onClick=\${onToggle}>\${theme === 'dark' ? '\\u2600\\uFE0F' : '\\uD83C\\uDF19'}</button>\`;
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

function TopBar({ mode, onSetMode, isDirty, autoSave, onSetAutoSave, onSave, conflictState, wordCount, readTime, theme, onToggleTheme }) {
  const isFixed = mode === 'raw' || mode === 'formatted';
  return html\`
    <div class=\${'top-bar' + (isFixed ? ' fixed' : '')}>
      <div class="top-left">
        <a href="/">\u2190 all files</a>
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

function TocSidebar({ mode, cmEditorRef, tocVersion }) {
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
      <div class="toc-header" onClick=\${() => setMinimized(!minimized)}>
        <span class="toc-title">Contents</span>
        <button class="toc-minimize">\${minimized ? '+' : '\\u2013'}</button>
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
    wireFootnotes(ref.current);
    wireInlineSectionLinks(ref.current);
    wireTableExpand(ref.current);
    applyAnnotations(ref.current, notes, onHighlightClick);
  }, [markdown, notes, renderVersion]);
  return html\`<article class="prose" id="content" ref=\${ref}></article>\`;
}

function RawEditor({ markdown, onDirty, cmEditorRef, cmThemeCompRef, theme }) {
  const wrapRef = useRef(null);
  const onDirtyRef = useLatest(onDirty);
  useEffect(() => {
    if (!wrapRef.current) return;
    if (cmEditorRef.current) {
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
  return html\`<article class="prose" id="formatted-editor" contenteditable="true" ref=\${ref}
    style="display:block" onInput=\${onDirty}></article>\`;
}

function NoteInput({ onAdd, onUpdate, onSelectionActive, editingNote, onClearEditing, onSelTextChange, onNoteCreated }) {
  const [comment, setComment] = useState('');
  const [selText, setSelText] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [fading, setFading] = useState(false);
  const textareaRef = useRef(null);
  const saveTimerRef = useRef(null);
  const statusTimerRef = useRef(null);
  const fadeTimerRef = useRef(null);
  const selTextRef = useRef('');
  const editingRef = useLatest(editingNote);
  const onClearEditingRef = useLatest(onClearEditing);
  const onSelectionActiveRef = useLatest(onSelectionActive);

  // Keep refs in sync
  useEffect(() => { selTextRef.current = selText; if (onSelTextChange) onSelTextChange(selText); }, [selText]);

  // When editingNote changes, populate the textarea
  useEffect(() => {
    if (editingNote) {
      setComment(editingNote.comment || '');
      setSelText(editingNote.text);
      setSaveStatus('');
      // Highlight the note's text in prose
      removePendingHighlights();
      const proseEl = getProseEl();
      if (proseEl) {
        clearActiveHighlights();
        const span = proseEl.querySelector('[data-ann-id="' + editingNote.id + '"]');
        if (span) { span.classList.add('active'); span.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      }
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        setTimeout(() => { if (textareaRef.current) { textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'; } }, 0);
      }
    } else {
      // Don't clear if there's an active text selection (new note flow)
      if (!selTextRef.current) {
        setComment('');
        setSelText('');
      }
    }
  }, [editingNote]);

  const autoResize = useCallback((el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, []);

  // Track selection: single mouseup handler
  useEffect(() => {
    const onMouseUp = (e) => {
      setTimeout(() => {
        if (e.target.closest && e.target.closest('.note-input-section')) return;
        if (e.target.closest && e.target.closest('.notes-sidebar')) return;

        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
          const proseEl = getProseEl();
          if (proseEl && proseEl.contains(sel.anchorNode)) {
            const text = sel.toString();
            // New selection → clear any editing state, start fresh
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
        // Clicked outside prose/sidebar without valid selection → deselect note
        if (editingRef.current) onClearEditingRef.current();
        removePendingHighlights();
        setSelText('');
        setComment('');
      }, 50);
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, []);

  // Autosave: debounce 800ms after typing
  const flashStatus = useCallback((msg) => {
    setSaveStatus(msg);
    setFading(false);
    clearTimeout(statusTimerRef.current);
    clearTimeout(fadeTimerRef.current);
    // Start fading after a brief pause
    statusTimerRef.current = setTimeout(() => setFading(true), 600);
    // Clear text after fade completes
    fadeTimerRef.current = setTimeout(() => { setSaveStatus(''); setFading(false); }, 2200);
  }, []);

  const handleInput = useCallback((e) => {
    const val = e.target.value;
    setComment(val);
    autoResize(e.target);
    clearTimeout(saveTimerRef.current);
    clearTimeout(statusTimerRef.current);
    clearTimeout(fadeTimerRef.current);
    setFading(false);
    if (val.trim()) setSaveStatus('Unsaved');
    else { setSaveStatus(''); return; }

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

  // Clean up timers
  useEffect(() => () => { clearTimeout(saveTimerRef.current); clearTimeout(statusTimerRef.current); clearTimeout(fadeTimerRef.current); }, []);

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
      ></textarea>
      <span class=\${'note-save-status' + (saveStatus === 'Unsaved' ? ' dirty' : '') + (fading ? ' fading' : '')}>\${saveStatus || '\\u00A0'}</span>
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
        <button class="notes-minimize">\${minimized ? '+' : '\\u2013'}</button>
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

function NewFileBar({ visible }) {
  if (!visible) return null;
  return html\`
    <div class="new-file-bar">
      <span>Filename:</span>
      <input type="text" id="new-filename" placeholder="my-document.md" />
    </div>\`;
}

// ── Chat ──

function ChatPanel({ getArticleText }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages]);
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const userMsg = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);

    try {
      const articleText = getArticleText ? getArticleText() : '';
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, articleContext: articleText }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'request failed' }));
        setMessages(m => [...m, { role: 'error', content: err.error || 'request failed' }]);
        setStreaming(false);
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
  }, [input, messages, streaming, getArticleText]);

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
        \${messages.length === 0 ? html\`<div class="chat-empty">Ask anything about this article</div>\` : null}
        \${messages.map((m, i) => m.role === 'error'
          ? html\`<div key=\${i} class="chat-error">⚠ \${m.content}</div>\`
          : html\`<div key=\${i} class=\${'chat-msg ' + m.role}>\${m.content}</div>\`
        )}
        <div ref=\${messagesEndRef} />
      </div>
      <div class="chat-input-row">
        <input ref=\${inputRef} value=\${input} onInput=\${e => setInput(e.target.value)}
          onKeyDown=\${handleKeyDown} placeholder="Ask about this article…"
          disabled=\${streaming} />
        <button onClick=\${send} disabled=\${streaming || !input.trim()}>Send</button>
      </div>
    </div>\`;
}

// ── DocApp ──

function DocApp() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [mode, setModeState] = useState(IS_NEW ? 'raw' : 'read');
  const [markdown, setMarkdown] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [autoSave, setAutoSave] = useState(true);
  const [conflictState, setConflictState] = useState(false);
  const [renderVersion, setRenderVersion] = useState(0);
  const [tocVersion, setTocVersion] = useState(0);

  const fileMtimeRef = useRef(null);
  const savedFilePathRef = useRef(IS_NEW ? null : FILE_PATH);
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
  const readTime = useMemo(() => Math.max(1, Math.ceil(wordCount / 238)), [wordCount]);

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

    if (IS_NEW && !savedFilePathRef.current) {
      const input = document.getElementById('new-filename');
      let name = input.value.trim();
      if (!name) { input.focus(); input.style.borderColor = '#dc2626'; return; }
      if (!name.endsWith('.md')) name += '.md';
      savedFilePathRef.current = name;
      notesHook.savedPathRef.current = name;
      const res = await fetch('/api/file/new', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path: name, content}) });
      if (res.ok) {
        setIsDirty(false);
        setMarkdown(content);
        history.replaceState(null, '', '/doc/' + name);
        // Initial persist for a brand-new file: at this point savedPathRef
        // just became valid, so any prior annotation mutations were no-ops.
        await notesHook.persist(notesRef.current);
      } else {
        const d = await res.json();
        alert('Error: ' + (d.error || 'save failed'));
        savedFilePathRef.current = null;
        notesHook.savedPathRef.current = null;
      }
      return;
    }

    const path = savedFilePathRef.current || FILE_PATH;
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
  useConflictDetection(savedFilePathRef, fileMtimeRef, async () => {
    if (isDirty) {
      setConflictState(true);
      wasAutoSaveRef.current = autoSave;
      if (autoSave) setAutoSave(false);
    } else {
      const path = savedFilePathRef.current || FILE_PATH;
      const fileRes = await fetch('/api/file/' + path);
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
  const setMode = useCallback((newMode) => {
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

  // Note actions — bump renderVersion to re-apply highlights
  const rerender = () => setRenderVersion(v => v + 1);
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
    if (IS_NEW) return;
    (async () => {
      const [mdRes] = await Promise.all([
        fetch('/api/file/' + FILE_PATH),
        loadNotes()
      ]);
      if (!mdRes.ok) return;
      const data = await mdRes.json();
      setMarkdown(data.content);
      fileMtimeRef.current = data.mtime || null;
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
    <\${TocSidebar} mode=\${mode} cmEditorRef=\${cmEditorRef} tocVersion=\${tocVersion} />
    <div class="layout">
      <main class="main-col">
        <\${NewFileBar} visible=\${IS_NEW} />
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
    <\${ChatPanel} getArticleText=\${getArticleText} />\`;
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

function getMtime(stat: Deno.FileInfo): number | null {
  return stat.mtime ? stat.mtime.getTime() / 1000 : null;
}

// ── Route handler ───────────────────────────────────────────────────────────────

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname);
  const method = req.method;

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
    if (!fp) return jsonResponse({ error: "not found" }, 404);
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(fp);
    } catch {
      return jsonResponse({ error: "not found" }, 404);
    }
    if (stat.isDirectory) {
      // Canonicalize directory URLs to end with "/" so relative links work
      if (!trailingSlash) {
        return new Response(null, {
          status: 301,
          headers: { Location: "/doc/" + rel + "/" },
        });
      }
      const entries = await collectDirEntries(fp, rel);
      return htmlResponse(dirPage(rel, entries));
    }
    const name = basename(fp, ".md");
    const title = name.replace(/[_-]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    return htmlResponse(docPage(title, rel));
  }

  // GET /new
  if (method === "GET" && path === "/new") {
    return htmlResponse(docPage("New File", "__new__"));
  }

  // GET /static/*
  if (method === "GET" && path.startsWith("/static/")) {
    const rel = path.slice(8);
    const fp = safePath(rel);
    if (!fp) return jsonResponse({ error: "path not allowed" }, 403);
    try {
      const data = await Deno.readFile(fp);
      const ext = extname(fp);
      const mime = MIME[ext.toLowerCase()] || "application/octet-stream";
      return new Response(data, { headers: { "Content-Type": mime } });
    } catch {
      return jsonResponse({ error: "not found" }, 404);
    }
  }

  // GET /api/file/:path
  if (method === "GET" && path.startsWith("/api/file/")) {
    const rel = path.slice(10);
    const fp = safePath(rel);
    if (!fp) return jsonResponse({ error: "not found" }, 404);
    try {
      const content = await Deno.readTextFile(fp);
      const stat = await Deno.stat(fp);
      return jsonResponse({ content, mtime: getMtime(stat) });
    } catch {
      return jsonResponse({ error: "not found" }, 404);
    }
  }

  // GET /api/mtime/:path
  if (method === "GET" && path.startsWith("/api/mtime/")) {
    const rel = path.slice(11);
    const fp = safePath(rel);
    if (!fp) return jsonResponse({ error: "not found" }, 404);
    try {
      const stat = await Deno.stat(fp);
      return jsonResponse({ mtime: getMtime(stat) });
    } catch {
      return jsonResponse({ error: "not found" }, 404);
    }
  }

  // GET /api/annotations/:path
  if (method === "GET" && path.startsWith("/api/annotations/")) {
    const rel = path.slice(17);
    const fp = safePath(rel + ".annotations.json");
    if (!fp) return jsonResponse({ error: "path not allowed" }, 403);
    try {
      const data = await Deno.readTextFile(fp);
      return jsonResponse(JSON.parse(data));
    } catch {
      return jsonResponse({ annotations: [] });
    }
  }

  // PUT /api/file/:path
  if (method === "PUT" && path.startsWith("/api/file/")) {
    const rel = path.slice(10);
    const fp = safePath(rel);
    if (!fp) return jsonResponse({ error: "path not allowed" }, 403);
    if (!fp.endsWith(".md")) return jsonResponse({ error: "only .md files" }, 400);
    try {
      await Deno.stat(fp);
    } catch {
      return jsonResponse({ error: "not found" }, 404);
    }
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
    const rel = path.slice(17);
    const fp = safePath(rel + ".annotations.json");
    if (!fp) return jsonResponse({ error: "path not allowed" }, 403);
    const body = await req.json();
    await Deno.writeTextFile(fp, JSON.stringify(body, null, 2));
    return jsonResponse({ ok: true });
  }

  // POST /api/file/new
  if (method === "POST" && path === "/api/file/new") {
    const body = await req.json();
    const rel = body.path || "";
    if (!rel || !rel.endsWith(".md")) return jsonResponse({ error: "path must end in .md" }, 400);
    const fp = safePath(rel);
    if (!fp) return jsonResponse({ error: "path not allowed" }, 403);
    try {
      await Deno.stat(fp);
      return jsonResponse({ error: "file already exists" }, 409);
    } catch {
      // Good — file doesn't exist
    }
    const dir = dirname(fp);
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(fp, body.content || "");
    return jsonResponse({ ok: true, path: rel });
  }

  // POST /api/chat
  if (method === "POST" && path === "/api/chat") {
    if (!ANTHROPIC_API_KEY) {
      return jsonResponse({ error: "ANTHROPIC_API_KEY not set" }, 500);
    }
    const body = await req.json();
    const userMessages = (body.messages || []).map((m: { role: string; content: string }) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));
    if (!userMessages.length) return jsonResponse({ error: "no messages" }, 400);

    const systemPrompt = body.articleContext
      ? `You are a helpful reading assistant. The user is reading the following article and may ask questions about it. Be concise.\n\n<article>\n${body.articleContext}\n</article>`
      : 'You are a helpful reading assistant. Be concise.';

    try {
      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: systemPrompt,
          messages: userMessages,
          stream: true,
        }),
      });
      if (!apiRes.ok) {
        const err = await apiRes.text();
        return jsonResponse({ error: `Anthropic API error: ${apiRes.status}` }, 502);
      }

      // Stream SSE back to client
      const stream = new ReadableStream({
        async start(controller) {
          const reader = apiRes.body!.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              const lines = buf.split('\n');
              buf = lines.pop() || '';
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6).trim();
                  if (!data || data === '[DONE]') continue;
                  try {
                    const evt = JSON.parse(data);
                    if (evt.type === 'content_block_delta' && evt.delta?.text) {
                      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: evt.delta.text })}\n\n`));
                    }
                  } catch {}
                }
              }
            }
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          } catch (e) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: 'stream error' })}\n\n`));
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
      return jsonResponse({ error: 'Failed to reach Anthropic API' }, 502);
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

type DirEntry =
  | { kind: "dir"; rel: string; name: string; mtime: number }
  | { kind: "file"; rel: string; name: string; mtime: number; mins: number };

async function collectDirEntries(absDir: string, relDir: string): Promise<DirEntry[]> {
  const out: DirEntry[] = [];
  for await (const entry of Deno.readDir(absDir)) {
    const rel = relDir ? relDir + "/" + entry.name : entry.name;
    const fp = join(absDir, entry.name);
    if (entry.isDirectory) {
      let mtime = 0;
      try {
        const st = await Deno.stat(fp);
        mtime = getMtime(st) || 0;
      } catch { /* ignore */ }
      out.push({ kind: "dir", rel, name: entry.name, mtime });
    } else if (entry.isFile && entry.name.endsWith(".md") && !entry.name.endsWith(".annotations.json")) {
      const stat = await Deno.stat(fp);
      const content = await Deno.readTextFile(fp);
      const words = content.split(/\s+/).filter(w => w).length;
      out.push({
        kind: "file",
        rel,
        name: entry.name.replace(/\.md$/, ""),
        mtime: getMtime(stat) || 0,
        mins: Math.max(1, Math.ceil(words / 238)),
      });
    }
  }
  return out;
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

const files: { rel: string; name: string; mtime: number; mins: number }[] = [];
await collectFiles(BASE_DIR, "", files);

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

console.log(`mdmaster \u2192 http://localhost:${port}`);
console.log(`  serving ${files.length} files from ${BASE_DIR}`);

Deno.serve({ port, hostname: "127.0.0.1" }, handler);
