# Live stream / studio canvas (investigation)

**Date:** 2026-08-24  
**Scope:** How Open Design streams artifacts to the studio canvas. Not the AMC orchestrator.  
**Status:** Investigation only. No product code in this document.

---

## Verdict

Live paint **already exists** for one surface, in one conversation, on one FileViewer tab.

It is not missing as a Grok/OD “wait until done” flag. Grok was explicitly switched to streaming-json so HTML paints as tokens arrive. What the owner is seeing now is the **single-surface contract** plus **conversation pinning** plus (likely) **AMC covering the iframe**.

Later screens are not supposed to paint live in the same iframe today. A run that emits `identifier=dashboard` then `identifier=library` does **not** give the studio two live canvases. Child conversations do **not** paint into the iframe that is still subscribed to conversation 1.

---

## 1. How live stream works today for the primary file

### Contract: first visible characters

The web parser (`apps/web/src/artifacts/parser.ts`) is a streaming scanner for one tag at a time:

```text
<artifact identifier="kebab-slug" type="text/html" title="Human title">
<!doctype html>
...
</artifact>
```

Nothing is treated as canvas HTML until a **complete** open tag is in the buffer (`<artifact` … `>`). A partial prefix such as `<art` or `<artifact identifier="dash` is held back. Quoted example tags inside markdown fences or inline code are skipped.

After the open tag:

1. `artifact:start` fires with `identifier`, `type`, `title`.
2. Every subsequent byte (minus a 10-byte holdback for a partial `</artifact>`) is `artifact:chunk`.
3. `</artifact>` fires `artifact:end`.

The daemon live-canvas extractor (`apps/daemon/src/runtimes/plain-stream.ts`) is slightly looser. In priority order it takes:

1. The **first closed** HTML `<artifact>…</artifact>` that looks like a document (`<!doctype html` or `<html` at the start of the body).
2. Else the **first open** HTML `<artifact>` (no closer yet).
3. Else the last bare `<!doctype html` / `<html` in the visible reply (pre-wrapper thought HTML).

Grok often dumps the mock inside `thought` before any assistant `text`. `handleGrokEvent` (`apps/daemon/src/runtimes/json-event-stream.ts`) remaps a thought chunk to `text_delta` when it contains `<artifact`, `<!doctype html`, or `<html`. That remapped text is what both the web parser and the daemon canvas writer see. Thought that does **not** look like HTML stays `thinking_delta` and never paints.

**First pixels therefore appear when the first of these is true:**

- a complete `<artifact …>` open tag, then enough body to start with `<!doctype html` / `<html` (daemon persist), **or**
- enough remapped thought to contain a bare doctype/`<html` (daemon persist), **or**
- the web parser has an open tag and has flushed the first body chunk into `artifact.html` (srcDoc paint, even before doctype if the model writes other markup first).

There is no “wait for `</artifact>`” on the primary canvas. Closed-tag extract is only the *preferred* snapshot once a closer exists.

### Two parallel projectors (same stream)

```text
Grok CLI  --output-format streaming-json
    │
    ▼
daemon json-event-stream  (thought HTML → text_delta)
    │
    ├─ SSE stdout / agent text_delta ──► ProjectView createArtifactParser()
    │                                      setArtifact({ html })
    │                                      FileWorkspace.artifactHtml
    │                                      FileViewer liveHtml
    │                                      srcDoc append-only document.write
    │
    └─ visibleAssistantText ──► createLiveHtmlCanvasWriter.note()
                                 extractLiveHtmlCanvasArtifact()
                                 persistLiveHtmlCanvas() → index.html (or claimed file)
                                 300ms throttle, overwrite in place
                                 first write: agent artifact { source: 'live-html-canvas' }
```

Grok is `executionProfile: 'text_artifact'` and `streamFormat: 'json-event-stream'` (`apps/daemon/src/runtimes/defs/grok-build.ts`). The comment on that def is the charter: paint as tokens arrive, **not** `plain` persist-on-exit.

Live-canvas disk writes are created only for `text_artifact` runs whose stream format is not `plain` (`apps/daemon/src/server.ts` around the `createLiveHtmlCanvasWriter` block). Filesystem agents (Claude, etc.) are told **not** to emit `<artifact>`; they write files with tools and the viewer URL-loads those files.

### What the studio actually shows

`ProjectView` holds **one** `artifact` (`identifier`, `html`, optional `fileName`). Every chunk replaces that object.

`FileWorkspace.resolveStreamingHtmlPreviewFile` (`apps/web/src/components/streaming-html-preview.ts`) binds that HTML to **one** tab name:

- claimed surface file, if the run has `designGenerationSurfaces[0].file`
- else always `index.html`

A synthetic `index.html` tab is opened as soon as `artifactHtml` is non-null (`FileWorkspace` effect on `streamingPreviewFile`). `liveHtml` is passed only to the FileViewer whose file name matches that preview file.

`FileViewer` forces srcDoc while `liveHtml` is set (`streamingLiveHtml` in `apps/web/src/components/file-viewer-render-mode.ts`) so a missing disk file cannot 404. Incremental transport (`apps/web/src/runtime/srcdoc-stream.ts`) keeps one document open and `document.write`s only new bytes. File-changed URL reloads are skipped while liveHtml owns the canvas.

Disk handoff: keep srcDoc until the run is idle **and** the stream has been `done: true` **and** the on-disk file has size/mtime (`shouldKeepLiveHtmlStream`).

### Canvas is one page, not a live multi-file stage

The thing the owner watches is **one FileViewer**, one iframe pair (URL-load + srcDoc), one `liveHtml` string.

Surrounding structure:

| Surface | What it is | Live paint? |
|---|---|---|
| FileViewer (active tab) | Full HTML preview / edit | Yes, for the single streaming file |
| HTML tab keepalive | Up to **3** mounted FileViewers (`HTML_VIEWER_KEEPALIVE_CAP`) | Only the streaming tab receives `liveHtml` |
| Workspace file tabs | User can switch files | Hidden in AMC embed |
| Design Files Canvas (`DesignSurfaceCanvas`) | Inert 16:9 thumbnails on a pan/zoom board | **No.** Placeholder until `filePresent`; then a frozen `HtmlPageThumbnail`. Plan text: frames update as generation **completes** |
| All screens | FileViewer toolbar button → Design Files root / Canvas | Navigate away from the live viewer |

So the studio can **swap** which file is focused, and can show a **board of completed** screens. It cannot paint ten live documents at once.

### Targeted runs vs unscoped Grok

If the run has `designGenerationSurfaces`:

- Daemon live writer persists only `surfaces[0]` (`server.ts` `target: designGenerationSurfaces[0]`).
- Web parser **drops** any artifact whose `identifier` ≠ `surfaces[0].surfaceId`.
- `identifier === 'index'` is allowed to claim the entry file `index.html` even when the semantic surface id is `dashboard` / `registration` (`artifactMatchesDesignTarget` in `plain-stream.ts`). A wrong id cannot steal `index.html` by filename.
- Extra claimed surfaces in the same run (`surfaces.slice(1)`) are persisted only at **process success**, from closed `</artifact>` blocks.

Unscoped Grok (no targets): live canvas is always `index.html`. Extra HTML artifacts persist at success under their identifier/title basename, skipping a second `index.html`.

Hard bound: a targeted claim may list **1–3** surface ids (`design-manifest.ts` `surfaceIds.length > 3` rejects). Ten screens are therefore at least four sequential runs by contract.

---

## Multiple identifiers in one reply

Example: one assistant message emits `identifier=dashboard`, then `identifier=library`.

**Web (active conversation, no claim, or claim = dashboard):**

- Parser is one-at-a-time, no nesting.
- On the second `artifact:start`, `liveHtml` is reset to `''` and `setArtifact` **replaces** the first object.
- The FileViewer paints dashboard, then wipes and paints library on the **same** tab.
- After `artifact:end` of library, `artifact` is still library. Disk handoff still follows the preview file name (`index.html` or the claimed file).

**Web (claim = dashboard, library arrives next):**

- Library events are `continue`d. Canvas stays on dashboard. Library is invisible in the iframe.

**Daemon live writer:**

- `extractLiveHtmlCanvasArtifact` prefers the **first closed** HTML artifact for the rest of the stream. Once dashboard closes, later library tokens do **not** move `index.html`.
- Open-tag extract only sees the **first** open `<artifact>`. A second open tag is ignored until the first closer exists.
- At success, `withoutLiveHtmlCanvasArtifact` drops that first HTML artifact so extras persist as `library.html` (etc.), not `index-2.html`.

**Net:** one reply with many identifiers is a **serial overwrite** on the web canvas and a **first-HTML lock** on disk. It is not N live surfaces.

---

## Child / subagent streams vs other conversations

OD does not have a first-class “subagent canvas.”

`run.child` in the daemon is the **CLI process** for this run. `liveHtmlCanvasChild` binds the writer to that process so a retry cannot keep writing after the child is swapped. Grok `grok-4.20-multi-agent` is still one OD run, one conversation, one `visibleAssistantText` concatenation.

What *does* split streams is **conversations**:

- `streamingConversationId` is set to the run’s conversation.
- `liveHtmlRunActive` is true only when `streamingConversationId === activeConversationId`.
- Reattach (`ProjectView` ~5152) only attaches to `activeConversationId`.
- Switching conversations, or creating a new one, calls `setArtifact(null)` and clears the streaming marker (`handleSelectConversation`, `handleNewConversation`).
- Stream deltas themselves are also dropped if `activeConversationIdRef.current !== runConversationId` (send-path ownership check).

Project files are **shared**. A conversation-2 run can still write `library.html` onto the project. The embed that is still on conversation 1 will:

- keep showing conversation 1’s finished `index.html` (or its last `artifact`)
- not receive conversation 2’s `liveHtml`
- skip file-changed remounts if conversation 1’s liveHtml still owns the canvas
- not auto-open conversation 2’s new file unless something in *this* conversation calls `requestOpenFile`

Default conversation when the URL has no `:cid` is `list[0]`. `listConversations` is `ORDER BY updatedAt DESC` (`apps/daemon/src/db.ts`). That is the **most recently updated** conversation, not “the first one created.” A later child conversation that writes a message can become `list[0]` on the next project load.

The multi-surface plan (`docs/plans/2026-08-22-amc-multi-surface-design-studio.md` §7) says remaining surfaces should reuse **the same OD project and conversation**, sequential runs, no concurrent writers. If AMC instead opens conversation 2+ for later screens, OD will persist files and those screens will generate **invisibly** in the conversation-1 iframe.

---

## Embed URL shape

Router (`apps/web/src/router.ts`):

| URL | Conversation | File |
|---|---|---|
| `/projects/:id` | `list[0]` (latest `updatedAt`) | none (Design Files / last persisted tab) |
| `/projects/:id/files/:file` | `list[0]` | that file |
| `/projects/:id/conversations/:cid` | pinned `:cid` | none |
| `/projects/:id/conversations/:cid/files/:file` | pinned `:cid` | that file |

Embed flags (`apps/web/src/amc-embed.ts`): `?amcEmbed=1` or `?embed=1`. Presentation only. Sets `html[data-amc-embed]`, posts `amc-design-ready` to `parent`, hides chrome.

Hidden in embed (`apps/web/src/styles/amc-embed.css`): workspace tabs, account cluster, pet, nav rail, tab shell, memory toast, update dialog. The FileViewer / canvas stay.

**One AMC iframe cannot see live paint for more than one surface without navigating.** Even if ten FileViewers were mounted, only the streaming preview file gets `liveHtml`, and embed hides the tab strip so the operator cannot click over to `library.html` while it writes. **All screens** exists so embed users can reach Canvas, but Canvas frames are completed-file thumbnails, not live streams.

`notifyAmcDesignComplete` (`amc-design-complete` postMessage) is **defined and never called**. Follow-up note in `docs/plans/grok-live-html-durable.md` §6: do not wire it until AMC’s payload is confirmed. If AMC’s “Designing” overlay waits for that message, it will sit until AMC decides the run is done by some other signal (HTTP poll, timeout, its own orchestrator). That overlay is **not in this repo**.

---

## Flags that buffer until complete (OD)

There is **no** OD feature flag that says “hide the iframe until Grok finishes.”

Things that *do* delay or drop paint:

| Mechanism | Effect |
|---|---|
| Grok `streamFormat: 'json-event-stream'` (current) | Streams. Opposite of buffer. |
| Other agents with `streamFormat: 'plain'` | Artifacts persist only on process exit (`server.ts` plain-stream finalize). |
| Incomplete `<artifact` open tag | Parser holds; no `artifact:start`. |
| Thought without HTML markers | Stays `thinking_delta`; no canvas. |
| Body that is not a document (`looksLikeHtmlDocument`) | Daemon extractor returns null; no `index.html` draft. |
| `</artifact>` required | Extra artifacts in the same reply persist only at success. |
| Claimed-surface identifier filter | Non-matching ids never enter `setArtifact`. |
| Live writer = `surfaces[0]` only | Surfaces 2–3 in a batch are end-of-run files. |
| 300ms canvas throttle | Disk drafts, not the SSE/srcDoc path. Web still paints every chunk. |
| Conversation ≠ active | No `liveHtml`, no reattach. |
| `skipArtifactGuards` on streaming drafts | Lets incomplete HTML land on disk; does not hide the iframe. |
| AMC “Designing” overlay | AMC-side. OD never sends `amc-design-complete`. |

The old failure mode documented in `docs/plans/grok-live-html-durable.md` (empty folder until child exits 0) is the **pre-fix** Grok path. Current Grok is incremental.

---

## 2. What would have to change for 10 screens to paint live in one studio session

Today’s architecture is “one live FileViewer + a completed-file board.” Ten live screens is a new product surface, not a prompt tweak.

Minimum OD changes, in dependency order:

1. **Per-surface live state on the client**  
   Replace the single `artifact` / `liveHtml` slot with a map `surfaceId | file → html`. The parser must emit parallel (or sequential-but-retained) streams instead of resetting `liveHtml` on the next `artifact:start`.

2. **Per-surface live persist on the daemon**  
   `extractLiveHtmlCanvasArtifact` + `persistLiveHtmlCanvas` must write **each** open HTML artifact to its mapped file (`dashboard.html`, `library.html`, …), not lock the first closed HTML onto `index.html`. Targeted runs must not ignore identifiers after `surfaces[0]`. The 1–3 surface claim bound stays unless the orchestrator also changes.

3. **A studio layout that can show more than one live document**  
   Three viable shapes (pick one; they are different products):

   - **Tabs:** auto-open each new identifier as a tab and keep `liveHtml` on every mounted HTML viewer. Embed must stop hiding `.workspace-tabs-chrome` / `.ws-tabs-shell`, or add an embed-safe tab rail. Keepalive cap is 3; 10 live FileViewers is expensive (bridges, comments, dual iframes).
   - **One canvas that swaps:** keep one FileViewer; on each `artifact:start` retarget `streamingPreviewFile` and remount/reset srcDoc. Operator sees one screen at a time, live. Cheap. Does not satisfy “all 10 paint at once.”
   - **Multiple artifacts on Canvas:** give `DesignSurfaceCanvas` a live srcDoc path per generating frame (or a bounded subset). Today those frames are inert thumbnails of **completed** files. The plan already says do not mount full FileViewer on every frame; a slim stream-only iframe (or throttled snapshot) would be new.

4. **Conversation subscription**  
   Either AMC must keep all surfaces in conversation 1 (the written plan), or the embed must subscribe to **project-level** live HTML (every run’s `text_delta` / live-canvas events), not only `activeConversationId`. Switching conversations must not `setArtifact(null)` for still-running sibling streams.

5. **Embed UX**  
   One iframe cannot show 10 live FileViewers without a board or tabs. All screens + Canvas is the existing navigation hatch, but Canvas is not live. If AMC covers the iframe with “Designing,” no OD stream work is visible.

6. **Writer / iframe budget**  
   Current v1: no concurrent same-project writers; 1–3 surfaces per run; sequential AMC queue. Ten simultaneous live writers would need a new lock story and a bound on live iframes (plan: “bound simultaneously live iframes”).

---

## 3. Is “stream as created” already there for conversation 1?

**Yes, for the primary file of the conversation the embed is actually showing.**

If AMC’s iframe is `/projects/:id/conversations/<conversation-1>` (or `/projects/:id` while conversation 1 is `list[0]`) and the run is unscoped Grok or a targeted run whose first surface is `index.html` / `identifier=index`:

- Thought HTML remaps to `text_delta`.
- `<artifact>` chunks update `artifact.html` every delta.
- FileViewer srcDoc appends in place.
- Daemon drafts `index.html` about every 300ms.
- The operator *should* see paint as soon as the first document bytes exist.

If that conversation is what AMC used to watch, and they now see “Designing” until done, the usual causes are **outside** that pipeline:

1. **AMC hides the iframe** until its own complete signal. OD posts `amc-design-ready` on load and never posts `amc-design-complete`.
2. **Wrong conversation.** Embed pinned to conversation 1 (or stale `list[0]`) while later surfaces run in conversation 2+. Conversation 1’s FileViewer stays on the finished first screen. Later files appear in Design Files / Canvas as they complete.
3. **Wrong file.** After the first screen, `liveHtml` stays on `index.html`. Remaining identifiers in the same reply are either filtered (targeted) or overwrite then get locked out on disk (unscoped first-closed). Sequential runs for `library` write `library.html` while the embed still shows `index.html`.
4. **Grok never emits a document-shaped open tag** (or only thinks in non-HTML thought). Canvas stays empty; AMC can look like a spinner.

So: stream-as-created is **implemented** for conversation 1’s primary artifact. It is **not** implemented for “every surface AMC asked for, in whatever conversation, visible in one embed.” The finished-first-screen / invisible-later-screens symptom matches (2) and (3) even when (1) is off.

---

## 4. Ordered OD stream work items (do not implement)

Priority is “restore the movie the owner already had, then make later screens visible,” not “rebuild the orchestrator.”

1. **Prove the embed is on the streaming conversation and the iframe is not covered.**  
   Log/compare AMC src: `/projects/:id` vs `/projects/:id/conversations/:cid` vs `/files/index.html`. Confirm AMC does not wait on `amc-design-complete`. This is mostly AMC; OD only needs a documented embed contract.

2. **Wire or delete `notifyAmcDesignComplete`.**  
   Today it is dead. Either AMC must not wait for it, or OD must post it at a defined moment (first live-canvas write? first `artifact:start`? run success?). Posting “complete” only at run end will keep “Designing” up for the whole movie.

3. **Pin embed conversation explicitly.**  
   Prefer `/projects/:id/conversations/:cid/files/index.html?amcEmbed=1` for the live surface. Do not rely on `list[0]`. If AMC creates child conversations, either don’t, or navigate the iframe (or add project-level live subscription).

4. **Keep later surfaces in the same conversation** (already the written AMC/OD plan).  
   Same SSE, same parser, same FileViewer. Sequential targeted runs of 1–3 surfaces. After each run, either swap the embed to the new claimed file or show All screens / Canvas for completed frames while `index.html` stays the live primary.

5. **Stop treating extra identifiers in one reply as live.**  
   Prompt/directive already says “first listed surface is the live-stream surface.” If models still emit `dashboard` then `library` in one blob, decide: filter (current targeted behavior) or sequential swap (current unscoped web behavior). Do not pretend both paint.

6. **Per-surface live persist + client map** (only if the product is “10 movies at once”).  
   Daemon: write each open HTML artifact to its mapped file while streaming. Web: `liveHtmlByFile`. Parser: do not discard the previous identifier. This is the real OD stream project.

7. **Studio chrome for N lives.**  
   Pick tabs (unhide in embed, raise keepalive carefully) **or** live Canvas frames (new slim stream iframe, bound concurrency) **or** one-canvas swap. Canvas-as-completed-thumbnails is already shipped and is the wrong primitive for live paint.

8. **Project-level live events (only if AMC will keep using multiple conversations).**  
   SSE or `/api/projects/:id/events` carrying `{ file, identifier, html delta }` independent of `activeConversationId`. FileWorkspace applies deltas to the matching tab/frame even when chat is on conversation 1.

9. **Iframe / writer budget.**  
   Keep sequential project writers unless a new lock is designed. Bound live srcDoc frames. Do not mount 10 full FileViewers.

10. **Do not add an OD “buffer until complete” flag.**  
    Grok’s current path is the live path. A flag that waits for `</artifact>` would recreate the old AMC blank.

---

## File index

| File | Role |
|---|---|
| `apps/web/src/artifacts/parser.ts` | Streaming `<artifact>` contract |
| `apps/web/src/components/ProjectView.tsx` | `setArtifact`, conversation gating, claim filter |
| `apps/web/src/components/FileWorkspace.tsx` | One streaming preview file, keepalive 3, All screens |
| `apps/web/src/components/streaming-html-preview.ts` | `index.html` (or claimed file) tab |
| `apps/web/src/components/FileViewer.tsx` | srcDoc live append |
| `apps/web/src/runtime/srcdoc-stream.ts` | Incremental `document.write` |
| `apps/web/src/components/file-viewer-render-mode.ts` | Force srcDoc while `liveHtml` |
| `apps/web/src/amc-embed.ts` | `?amcEmbed=1`, ready/complete messages |
| `apps/web/src/styles/amc-embed.css` | Hides workspace tabs |
| `apps/web/src/router.ts` | Project vs conversation vs file URLs |
| `apps/web/src/components/DesignSurfaceCanvas.tsx` | Completed-file board, not live |
| `apps/daemon/src/runtimes/plain-stream.ts` | Extract / persist / first-HTML lock / `index` alias |
| `apps/daemon/src/runtimes/live-html-canvas.ts` | 300ms overwrite writer |
| `apps/daemon/src/runtimes/json-event-stream.ts` | Grok thought → text when HTML-shaped |
| `apps/daemon/src/runtimes/defs/grok-build.ts` | `text_artifact` + streaming-json |
| `apps/daemon/src/server.ts` | Live writer only for text_artifact; persist extras at success |
| `apps/daemon/src/routes/runs.ts` | “First listed surface is the live-stream surface” |
| `apps/daemon/src/storage/design-manifest.ts` | 1–3 surfaces per claim |
| `apps/daemon/src/db.ts` | Conversations `ORDER BY updatedAt DESC` |
| `docs/plans/grok-live-html-durable.md` | Why Grok paints live; complete message unwired |
| `docs/plans/2026-08-22-amc-multi-surface-design-studio.md` | Same conversation, sequential runs, Canvas after complete |
