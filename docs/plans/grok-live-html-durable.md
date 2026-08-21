# Durable live HTML for Grok / AMC Studio

**Status:** proposed for this PR  
**Branch base:** `feat/live-html-incremental-stream`  
**Date:** 2026-08-21

## Why

AMC iframes Open Design (`?amcEmbed=1`) as a chromeless Design panel. Grok now
paints HTML into that panel as tokens arrive (`<artifact>` → `liveHtml` →
append-only srcDoc). That movie is the product.

It is still a movie of RAM. The project folder stays empty until the child
exits 0 and the daemon scrapes a closed `</artifact>`. Stop, crash, or a
thought-only mock with no closer → AMC shows a design that is not a design
file. After success, persist unique-names (`index-2.html`) and URL-loads a
file that may not exist yet, so the iframe can 404 at the exact moment the
stream hands off to disk.

Claude’s filesystem loop is the better *workspace* (files exist mid-turn,
iterate is Edit). Grok’s actual behavior is to design in `thought` / dump one
`<artifact>`. We keep that charter. We steal Claude’s durability underneath
the projector we already built.

## What AMC must still see

- Empty canvas → one `index.html` tab.
- HTML fills in place. No remount, no `/raw/index.html` 404, no jump to a
  second tab because “first HTML on disk” changed.
- `liveHtml` stays on **that same tab name** for the whole stream.
- `skipDefaultScenario` stays so `kind: other` does not attach
  `od-new-generation` and seed extra HTML.

## What this PR will do

### 1. Pin the live tab to `index.html`

Today `resolveStreamingHtmlPreviewFile` binds to the first `kind === 'html'`
file on disk. A draft or a persist with a different basename retargets the
canvas.

While `artifactHtml` is streaming, the preview file name is
`STREAMING_HTML_PREVIEW_NAME` (`index.html`) unless that tab is already open
under that name. Do not follow “whatever HTML appeared first.”

### 2. Write a draft `index.html` while the artifact is still open

Daemon already concatenates Grok `text_delta` into `visibleAssistantText`.
Add an extractor that returns an **open** HTML artifact (no `</artifact>`
required), debounce (~300ms, only if the body grew), and
`writeProjectFile(..., { overwrite: true })` to `index.html`.

- Manifest `status: 'streaming'` on drafts (already a valid status, unused).
- Final success persist **overwrites the same file**, sets `status:
  'complete'`. Never `reserveUniqueArtifactFileName` for this live canvas
  file.
- Client `persistArtifact` must update `index.html` in place when that is
  the live tab, not allocate `hud.html` / `index-2.html`.

Thought-as-`text_delta` stays. Grok often writes the mock inside `thought`
**before** any assistant `text`. We map that thought HTML onto `text_delta`
so AMC paints during thinking, not after the model “responds.” Hiding
thought from the transcript in this PR would drop the only copy of the HTML.

### 3. Do not let `file-changed` steal the live iframe

Draft writes fire chokidar → SSE `file-changed` → `filesRefreshKey` →
FileViewer’s 180ms URL-iframe reload.

While `streamingLiveHtmlActive`:

- FileViewer live-reload effect returns early (same shape as the screenshot
  suppress and annotation freeze).
- SrcDoc identity already ignores size/mtime/`filesRefreshKey`. Keep that.
- Do not drop `liveHtml` because a real file now exists.

Handoff to URL-load only after the stream is finished **and** the on-disk
document is the final artifact.

### 4. Close the live document

Stream postMessages currently always send `done: false`. When `liveHtml`
goes away after a successful persist of the same HTML, post one
`done: true` (or activate the existing open/write/close path) so scripts /
`DOMContentLoaded` can run. Do not remount if the persisted bytes are the
same prefix-complete document.

### 5. Stop swallowing unknown Grok JSON

`handleGrokEvent` returns `true` for unrecognized types, so a schema drift
in CLI 1.0.4 is a silent blank canvas. Keep ignoring `available_commands`.
Unknown types emit `raw` (or a bounded diagnostic), not a silent success.

### 6. Out of scope (follow-ups)

- Grok ACP / filesystem Write-as-source-of-truth (turn-2 Edit).
- Stripping thought-HTML from the visible chat transcript.
- Wiring `notifyAmcDesignComplete` until AMC’s expected payload is confirmed.
- Deduplicating the two srcDoc stream-bridge strings (safe cleanup, not
  required for the AMC bug).
- Capturing a real Grok `streaming-json` fixture under `mocks/` (do it when
  we have a recorded session; do not invent NDJSON).

## Review invariants (must hold)

Plan review (architecture + AMC + Codex) blocked the first sketch. This PR
is only correct if all of these are true:

1. **One writer, one name.** `persistLiveHtmlCanvas` is the only daemon writer
   for the live canvas. Always `index.html`, `overwrite: true`. Do not call
   `persistPlainStreamArtifactList` / `createProjectArtifactFile` for that
   file (unique-name + `overwrite: false` forks `index-2.html` / `hud.html`).
2. **`liveHtml` is not chat-busy.** Drive it from `artifactHtml` on the pinned
   tab. Stop / `onDone` must not URL-load `/raw/index.html` before disk exists.
3. **First draft is immediate.** Debounce later growth. Flush on every
   terminal status (success → `complete`; cancel/fail → leave `streaming`).
   Cancel the timer so a late draft cannot clobber a completed file.
4. **`status: 'streaming'` skips publication/stub guards.** Run those guards
   only when promoting to `complete`.
5. **Client persist overwrites `index.html`** when that file already exists.
   Do not unique-name a second HTML tab.
6. **Post `done: true` while `liveHtml` is still set** (run no longer busy).
   Do not drop `liveHtml` in the same tick as close — that skips `document.close()`.

## How (implementation sketch)

| Layer | Change |
|---|---|
| `plain-stream.ts` | `extractOpenPlainStreamArtifact(text)` for unclosed `<artifact>`; `persistLiveHtmlDraft({ name: 'index.html', overwrite: true, status })`. Closed extract stays for other plain adapters. |
| `server.ts` | On grok `text_artifact` runs, debounce draft persist from `visibleAssistantText`. On success, overwrite the same draft as complete. Track the live file name on the run so unique-name persist cannot fork it. |
| `streaming-html-preview.ts` | Prefer `index.html` / already-open streaming tab; do not retarget to an unrelated HTML file mid-stream. |
| `FileWorkspace.tsx` | Keep `liveHtml` on the pinned name even after the draft appears. |
| `FileViewer.tsx` | Skip `filesRefreshKey` URL reload while `streamingLiveHtmlActive`. Post `done: true` on stream end. |
| `json-event-stream.ts` | Unknown grok types → `raw`. |
| `ProjectView.tsx` `persistArtifact` | If the live canvas file is `index.html`, overwrite it. |

## Tests (red first where cheap)

- Unclosed `<artifact>` extract returns a draft body; closed extract unchanged.
- Two draft writes of growing HTML stay on `index.html` (no `index-2.html`).
- Success persist overwrites that file, `status: 'complete'`.
- Grok unknown JSON line is `raw`, not dropped.
- `resolveStreamingHtmlPreviewFile` stays on `index.html` when another HTML
  file exists but the stream started on the synthetic tab.
- `buildSrcDocTransportIdentity` still ignores refresh keys while streaming
  (already covered; keep green).
- FileViewer live-reload is skipped when `liveHtml` is set (unit the guard,
  not the whole iframe).

## Success

AMC first generate: pixels appear as Grok thinks/writes. Stop or crash after
the first HTML chunk: Design Files still has `index.html`. Run completes:
same tab, same file, complete document, no 404 flash, no second HTML file.
