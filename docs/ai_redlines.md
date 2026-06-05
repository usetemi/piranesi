# AI Redlines: Cursor-Style Inline Editing for Piranesi

## Problem

Piranesi's chat sidebar can see the full document and talk about it, but can't touch it. When a user says "remove the # column from the Lead Gen sources table," the AI describes the edit in chat and the user has to manually apply it. The AI is an advisor, not an actor.

## Goal

The user types an instruction in chat. The AI proposes edits as inline redlines in the document. The user accepts or rejects each one. Accepted edits modify the file on disk.

## Example Interaction

1. User is viewing `channel_experiment_research_panel_person_to_person_sales.md` in the browser.
2. User opens chat, types: "remove the # column from Lead Gen sources section."
3. The AI identifies the table under "## Lead gen sources" and produces the edit.
4. The old table text is highlighted in red (redline) in the document.
5. The annotation sidebar shows the proposed replacement text, with Accept / Reject buttons.
6. **Accept →** old text is replaced with new text in the markdown, annotation is deleted, file is saved to disk.
7. **Reject →** annotation is deleted, document unchanged.

## Design: Reuse Annotations as the UI Layer

AI-proposed edits are annotations with a special type. The existing annotation system already:

- Highlights arbitrary text passages in the document by exact string match
- Supports multiple highlight colors (yellow, blue, purple, pink, orange)
- Renders a sidebar panel with the annotation comment
- Persists to a sidecar `.annotations.json` file
- Works across read, raw, and formatted modes

### New annotation shape

```json
{
  "id": "ai-edit-<uuid>",
  "text": "<exact old text to be replaced>",
  "comment": "<replacement text>",
  "color": "red",
  "type": "ai_edit",
  "created": "2026-05-22T...",
  "updated": "2026-05-22T...",
  "resolved": null
}
```

- `text` — the substring to find in the document (same as existing annotations)
- `comment` — the replacement content
- `color` — a new redline color (red or similar), visually distinct from user annotations
- `type` — `"ai_edit"` distinguishes these from regular annotations

### Accept flow

1. Find `annotation.text` in the current markdown.
2. Replace it with `annotation.comment`.
3. Delete the annotation.
4. Save both the markdown file and the annotations file to disk.

### Reject flow

1. Delete the annotation.
2. Save the annotations file. Document unchanged.

## Architecture

### AI call

The chat endpoint (`POST /api/chat`) calls the Anthropic API (raw HTTP, not Vercel AI SDK) with a tool:

```
Tool: propose_edit
Parameters:
  old_text: string  — exact substring of the current document to replace
  new_text: string  — the replacement
```

The system prompt instructs the model to use `propose_edit` when the user asks for changes, and to respond with plain text when they're just asking questions.

The server runs a simple loop: call the API → if the response contains tool calls, execute them (create annotations), return tool results, call the API again → repeat until the model responds with text only.

This allows multi-hunk edits in a single user message (e.g., "remove the # column" produces one `propose_edit` per table, or one for the whole table block).

### Server-side handler

On receiving a `propose_edit` tool call:

1. Verify `old_text` exists in the current document markdown.
2. Create an `ai_edit` annotation in the sidecar file.
3. Return success to the LLM loop.
4. Stream an SSE event to the frontend: `{type: "ai_edit", annotation: {...}}`.

### Frontend

- Render `ai_edit` annotations with the redline highlight color.
- In the annotation sidebar (or inline), show Accept / Reject buttons for `ai_edit` type annotations.
- Accept calls the existing save flow (PUT markdown + PUT annotations).
- Reject calls the existing annotation delete flow.
- Optionally: "Accept All" / "Reject All" buttons when multiple edits are proposed.

### Streaming UX

While the AI is thinking / generating:

1. Chat shows the text response streaming (as it does today).
2. As each `propose_edit` tool call completes, the redline appears in the document immediately.
3. User can review and accept/reject edits while the AI is still processing subsequent ones.

## What Changes

| Component | Change |
|---|---|
| `annotations.json` schema | Add optional `type` field |
| Annotation rendering | New "red" highlight color for `ai_edit` type |
| Annotation sidebar | Accept / Reject buttons for `ai_edit` annotations |
| `POST /api/chat` handler | Replace Vercel AI SDK `streamText` with raw Anthropic API call + tool-use loop |
| System prompt | Add `propose_edit` tool instructions |
| Frontend chat | Handle new SSE event types for edit proposals |

## What Doesn't Change

- File read/write APIs (`GET/PUT /api/file`)
- Annotation persistence (`GET/PUT /api/annotations`)
- Text matching / highlight rendering logic (reused as-is)
- Editor modes (read, raw, formatted)
- Conflict detection (mtime-based)

## Open Questions

- **Diff preview:** Should the sidebar show a rendered diff (red/green) of old vs. new, or just the replacement text?
- **Large edits:** If the replacement is very long (e.g., rewriting a whole section), how should the sidebar display it? Collapsible?
- **Multiple edits:** Should multi-hunk edits be grouped with a single "Accept All" or always individual?
- **Undo:** After accepting, is there an undo path beyond git?
- **Model choice:** Use the same model for chat and edits, or a stronger model (Opus) for edits?
- **Token cost:** The full document goes in context every message. For large docs, consider sending only the relevant section. The AI could use a `read_section` tool to pull specific parts on demand instead of stuffing the whole doc in the system prompt.
