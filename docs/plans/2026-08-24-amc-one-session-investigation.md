# Investigation: one OD conversation vs AMC multi-surface workarounds

**Status:** Investigation only. No product behavior change.  
**Date:** 2026-08-24  
**Scope:** default `main` (`f86230ece` and ancestors).  
**Related plan:** [`2026-08-22-amc-multi-surface-design-studio.md`](./2026-08-22-amc-multi-surface-design-studio.md) (accepted; OD-A and OD-B marked complete).

This answers whether Open Design can already host **one conversation**, take AMC's design-scope + one instruction, design every required surface, stream each live to the canvas, and return all HTML — or whether AMC's current workarounds (one surface per run, fresh conversation per later surface, exact-output primary file only) are forced by today's primitives.

## Verdict (read this first)

**"Subagent" is the wrong word.** OD does not have a host-owned subagent / child-run / parallel-worker orchestrator for screens.

The real primitive is:

> **One project + one conversation + N sequential `designGeneration` runs, each claiming 1–3 `surfaceIds` against a revision-checked manifest. AMC owns the queue. OD owns claim, exact-file mapping, one live stream (first claimed surface), and coverage.**

That is exactly the accepted 2026-08-22 architecture. It is implemented. It is **not** "OD launches N screen agents and they all paint live."

AMC's workarounds are therefore a mix of:

| Workaround | Forced by OD today? |
|---|---|
| One design run = one surface | **Partly.** A run may claim **1–3** surfaces. Live paint is only the **first**. Remaining claimed files persist at process exit. Sending every surface in one run is rejected if `surfaceIds.length > 3`. |
| Fresh conversation per later surface | **Not required by the run/manifest model.** Sequential `POST /api/runs` with the same `conversationId` is the intended path. The observed xAI **device-login** is a **Grok resume-identity bug** (fixable inside OD). |
| Exact-output primary file only | **Required for a targeted run to mark surfaces `complete`.** Coverage will not advance on "pretty HTML existed" without the exact claimed file being touched and validated. |

---

## 1. What exists now

### 1.1 APIs

| Surface | Contract |
|---|---|
| Seed / read coverage | `GET` / `PUT /api/projects/:id/design-manifest` — [`apps/daemon/src/routes/project/design-manifest.ts`](../../apps/daemon/src/routes/project/design-manifest.ts) |
| CLI parity | `od project design-manifest get\|put` — [`apps/daemon/src/cli.ts`](../../apps/daemon/src/cli.ts) ~6890 |
| Start a design run | `POST /api/runs` with `designGeneration?: { manifestRevision, surfaceIds }` — [`packages/contracts/src/api/chat.ts`](../../packages/contracts/src/api/chat.ts) `ChatRunCreateRequest` / `McpRunCreateRequest` |
| CLI start | `od run start --project … [--conversation …] --surface-ids a,b --expected-revision N` — same CLI file ~7573 / ~7816 |
| Watch | `GET /api/runs/:id` and `GET /api/runs/:id/events` (SSE) |
| Files + conversation | `GET /api/runs/:id/result-package` — [`RunResultPackageResponse`](../../packages/contracts/src/api/workspaces.ts): run + `conversationId` + project `fileCount` + artifacts that already have an `artifactManifest` |
| Coverage after a run | Re-`GET` the design manifest. Coverage is daemon-derived, never caller-authored. |

There is no `startDesignRun` symbol in this repo. That is AMC's name for `POST /api/runs` plus `designGeneration`.

### 1.2 Run model

A **conversation** is a durable chat home on a **project**. A **run** is one spawned agent process (`queued → running → succeeded|failed|canceled`).

- One conversation **can** have many sequential runs. Headless tests bind `conversationId` and mint a new assistant pin per `POST /api/runs` ([`apps/daemon/tests/headless-runs.test.ts`](../../apps/daemon/tests/headless-runs.test.ts)).
- One project **cannot** have two writers at once. `reserveProjectWriter` + `assertProjectWriterAvailable` serialize **every** same-project run, targeted or unscoped ([`apps/daemon/src/routes/runs.ts`](../../apps/daemon/src/routes/runs.ts) 1036–1104). A second start while the first is active is `409 DESIGN_MANIFEST_WRITER_CONFLICT`.
- Concurrent runs on one conversation are therefore blocked **because they share the project directory**, not because conversations are single-run.

There is no child-run table, no host `Task` fan-out, and no OD worker pool for surfaces. `TaskCreate` in [`apps/daemon/src/runtimes/claude-stream.ts`](../../apps/daemon/src/runtimes/claude-stream.ts) is Claude's own tool name, parsed for UI. Hermes/DeepSeek marketing copy mentions isolated subagents; that is those CLIs, not an OD screen orchestrator. `grok-4.20-multi-agent` is only a **model id** on [`grok-build.ts`](../../apps/daemon/src/runtimes/defs/grok-build.ts).

`docs/orchestrator-workspaces.md` is provenance for folder-backed scratch trees. It is not a multi-agent orchestrator.

### 1.3 `designGeneration.surfaceIds` + `manifestRevision`

Contract ([`packages/contracts/src/api/design-manifest.ts`](../../packages/contracts/src/api/design-manifest.ts) 82–192):

```ts
interface DesignGenerationTarget {
  manifestRevision: number; // positive int
  surfaceIds: string[];     // 1..3 unique lower-kebab ids
}
```

`prepareDesignGeneration` then ([`runs.ts`](../../apps/daemon/src/routes/runs.ts) 1106–1151):

1. Requires a project and a durable v2 manifest.
2. Rejects unless `manifest.revision === target.manifestRevision` (`409 DESIGN_MANIFEST_REVISION_CONFLICT`).
3. Rejects unknown ids (`422`).
4. Resolves each id to its **immutable** `file` and injects `renderDesignGenerationDirective`.

`claim` then ([`apps/daemon/src/storage/design-manifest.ts`](../../apps/daemon/src/storage/design-manifest.ts) 353–416):

1. Requires `directionStatus === 'locked'`.
2. Rejects if any surface is already `generating` (writer conflict).
3. Allows only `queued`, `failed`, or `complete` with `filePresent === false`.
4. Marks claimed surfaces `generating`, stores `latestRunId`, **increments revision**.

So **AMC cannot send all required surfaceIds in one start** if the product has more than three. Three is the hard cap at parse, CLI, and claim.

**Revision is not a sticky "scope version."** Every successful claim (and finish/recovery) bumps it. A continuation run **must** `GET` the manifest and send the new revision. Reusing the seed revision after the first claim is a 409.

The directive tells the model ([`runs.ts`](../../apps/daemon/src/routes/runs.ts) 891–927): generate **exactly** these 1–3 surfaces, in order; do not touch `DESIGN-MANIFEST.json`; first listed surface is the live-stream surface; emit `identifier=<surfaceId>` or write the exact file.

### 1.4 Stream model (chat artifact → canvas)

Grok / text-artifact path:

1. Grok CLI `--output-format streaming-json` → [`handleGrokEvent`](../../apps/daemon/src/runtimes/json-event-stream.ts) maps `text` and HTML-looking `thought` to `text_delta`.
2. [`createLiveHtmlCanvasWriter`](../../apps/daemon/src/runtimes/live-html-canvas.ts) extracts **one** open/closed HTML artifact from the accumulating assistant text.
3. [`persistLiveHtmlCanvas`](../../apps/daemon/src/runtimes/plain-stream.ts) overwrites **one** file: claimed `designGenerationSurfaces[0].file`, else `index.html`.
4. Web [`resolveStreamingHtmlPreviewFile`](../../apps/web/src/components/streaming-html-preview.ts) pins the FileViewer tab to that claimed name (default `index.html`).
5. [`ProjectView`](../../apps/web/src/components/ProjectView.tsx) artifact parser paints `liveHtml` into that tab. It **skips** identifiers that are not `designGenerationSurfaces[0].surfaceId`.
6. Special alias: artifact `identifier="index"` may satisfy the **entry** file `index.html` even when the semantic surface id is `dashboard` / `registration` ([`artifactMatchesDesignTarget`](../../apps/daemon/src/runtimes/plain-stream.ts) 36–48). It must **not** claim a secondary surface.

At process success, extra closed `<artifact>` blocks persist via `persistPlainStreamArtifactList` against `designGenerationSurfaces.slice(1)` (or all targets if live canvas never wrote). That is **exit-time**, not live.

The old single-screen movie is still the live path. `identifier=index` remains the AMC primary-paint contract. A run may persist up to 50 artifacts in the unscoped extractor (`MAX_ARTIFACTS_PER_RUN`), but a targeted run only **counts** claimed files.

**Canvas** ([`DesignSurfaceCanvas.tsx`](../../apps/web/src/components/DesignSurfaceCanvas.tsx)): inert 16:9 thumbnails for `ready` HTML files; queued/generating/failed are **placeholders + spinner**. Generating frames do **not** stream live HTML. The plan text ("primary live stream remains visible while later surfaces generate") means: FileViewer keeps streaming the current run's first file; the board shows status, then a static thumbnail after the file is complete.

### 1.5 Grok identity

[`grok-build`](../../apps/daemon/src/runtimes/defs/grok-build.ts):

- Binary `grok`, `GROK_HOME` / `~/.grok/auth.json`, SuperGrok OAuth (`auth.x.ai`).
- Headless: `--prompt-file`, `--output-format streaming-json`, `--no-plan`, `--always-approve`, optional `--resume <id>`.
- `resumesSessionViaCli: true`.
- **`capturesSessionIdFromStream` is not set** (unlike Codex / OpenCode).
- `executionProfile: 'text_artifact'` (one `<artifact>` handoff, not filesystem Write).

AMC forwarding ([`amc-grok.ts`](../../apps/daemon/src/runtimes/amc-grok.ts), allowed only with the OD server API token):

```ts
amcGrok?: { sessionId, grokHome, sourceCwd?, apiKey?, authJson? }
```

Credentials are materialized under the daemon data root. `GROK_HOME` is persisted on **project metadata** as `amcGrokHome` for later runs. **`sessionId` is not persisted on the project** — only on the per-conversation `agent_sessions` row (and only if the resume machinery stores the right id).

On spawn ([`server.ts`](../../apps/daemon/src/server.ts) 10469–10558):

1. If this run omitted `amcGrok` but the project has `amcGrokHome`, restore home only.
2. If `sessionId` is present, [`adoptGrokSession`](../../apps/daemon/src/runtimes/grok-session-adopt.ts) copies `<GROK_HOME>/sessions/<urlencoded-cwd>/<id>` from AMC cwd to the OD project cwd so `--resume` can see it.
3. Missing transcript → **clear `sessionId` and start fresh** (comment: do not start a second Grok login). Other adopt errors → `GROK_RESUME_FAILED`.
4. If `sessionId` remains, `forceAmcGrokResume` **overrides** the normal resume context and passes `--resume <AMC id>`.

### 1.6 What a completed run returns

`POST /api/runs` is 202 with `{ runId, conversationId, assistantMessageId, designGenerationSurfaces?, reused, resumed }` — **not** the HTML.

When the run is terminal, `GET /api/runs/:id` adds `deliverableValid` / `deliverableValidation` / `deliverableEntryFile`. For a targeted run, [`validateRunDeliverable`](../../apps/daemon/src/run-deliverable-validation.ts) requires:

- every claimed file present and readable,
- every claimed file in `touchedPaths`,
- no unclaimed HTML and no `DESIGN-MANIFEST.json` touch.

`finishClaim` then marks only those claimed ids `complete` (else `failed`). Coverage is on the **next GET manifest**, not on the run JSON.

`GET /api/runs/:id/result-package` lists project files that already have an artifact manifest, plus `conversationId` and `fileCount`. AMC still needs the manifest for "which required surfaces are missing."

---

## 2. What OD already can do if AMC only changed the prompt

If AMC keeps one project, one conversation, and the existing APIs:

**Already possible**

- `PUT` a locked v2 manifest with **all** surfaces (cap 60). Entry surface **must** be `index.html`.
- First `POST /api/runs` with `conversationId`, `designGeneration: { manifestRevision, surfaceIds: [entry, …up to 2 more] }`, and the full scope in the user message (the daemon also injects the locked scope in the directive).
- Live-stream the **first** claimed surface into its stable file (entry → `index.html`).
- After success: `GET` manifest (revision has moved; coverage updated), then another `POST /api/runs` on the **same** `conversationId` with the new revision and the next 1–3 missing/failed ids.
- Read all HTML from the project / result-package; do not treat one pretty `index.html` as package-complete unless `coverage.ready`.

**Not possible by prompt alone**

- One run that claims 8 surfaces.
- Concurrent painters in one project.
- Live canvas frames for surface 2 and 3 while they are still generating (they persist at exit; Canvas shows a spinner until `ready`).
- Asking Grok to "design the whole SaaS as one artifact" and expecting coverage to go green. Exact-output will fail if extra HTML appears or claimed files are not touched.
- Reliable turn-2 Grok on the same conversation while resume identity is wrong (next section). A prompt change does not fix `--resume`.

---

## 3. What OD does not have

### 3.1 Subagent orchestrator

No OD-owned fan-out that launches one worker per surface, streams each, and joins. The accepted plan **explicitly forbids** unbounded independent screen agents and concurrent writers in one project directory.

### 3.2 Multi-live canvas

One live FileViewer stream per run (first claimed file). Canvas is an inert overview. "All screens stream live like the old single-screen movie" is **not** implemented.

### 3.3 Same-conversation Grok without device-login (today)

This is the AMC-observed failure, and it is **mostly an OD adapter bug**, not "conversations cannot have two runs."

Root mismatch:

| What the CLI actually does | What the grok-build def declares |
|---|---|
| Grok **mints** a session id and reports it on `{type:"end", sessionId}` ([`handleGrokEvent`](../../apps/daemon/src/runtimes/json-event-stream.ts) 1015–1025). There is **no** `--session-id` create flag in [`buildGrokHeadlessArgs`](../../apps/daemon/src/runtimes/grok-args.ts). | `resumesSessionViaCli: true` **without** `capturesSessionIdFromStream`. That is **specify-style**: persist `newSessionId` (daemon UUID) on a create turn ([`server.ts`](../../apps/daemon/src/server.ts) 11891–11893). Claude uses `--session-id` for that UUID; Grok does not. |

Turn 2 then does `--resume <daemon-UUID-Grok-never-created>` **and** `skipTranscript: true` ([`server.ts`](../../apps/daemon/src/server.ts) 10577–10582). The child has no session and no transcript.

`isAgentResumeFailure` ([`agent-session-resume.ts`](../../apps/daemon/src/agent-session-resume.ts) 305–323) handles Claude, Codex, OpenCode, AMR, DeepSeek — **not** `grok-build`. A dead `--resume` does not automatically reseed.

`forceAmcGrokResume` makes this worse if AMC keeps sending the **planner** session id on later design turns: it overrides the (already-wrong) stored handle and `--resume`s a session whose transcript lives under a different host/cwd, or one the local `GROK_HOME` cannot continue without SuperGrok device OAuth.

Adopt-missing-transcript already clears `sessionId` and comments "callers must not start a second Grok login." Device-login still happens when:

1. `--resume` is passed for an id Grok does not have, and the CLI falls into `grok login --oauth` / device flow instead of a clean headless error; or
2. `GROK_HOME` has no usable `auth.json` / `XAI_API_KEY` on that host (forwarded `grokHome` path exists only on AMC-BE; materialize requires `apiKey` or `authJson`).

So: **one conversation can run many turns in the run model.** Grok follow-up is unsafe until resume capture + failure fallback exist. That is fixable inside OD. It is not fixed by opening a new conversation (that only avoids `--resume`).

---

## 4. Smallest OD work items (do not implement here)

Ordered by leverage for "one session, many surfaces, live primary, all files back." Each item is a done-when.

### W1 — Treat Grok as capture-style resume

**Done when:** `grok-build` sets `capturesSessionIdFromStream: true`. A successful first run persists `{type:"end", sessionId}` (not a daemon UUID). A second `POST /api/runs` on the same conversation, **without** a new AMC planner `sessionId`, spawns `grok --resume <that captured id>` with `GROK_HOME` = materialized AMC home, and does **not** print a device-login URL. Red spec: two sequential headless grok-build runs, mock CLI records `--resume` of the id it emitted on `end`.

### W2 — Grok resume-failure fallback (no second login)

**Done when:** `isAgentResumeFailure('grok-build', …)` detects missing session / device-login / resume reject. Daemon clears the stored handle, retries **without** `--resume`, with full transcript, using the same materialized `apiKey`/`authJson`. `GROK_RESUME_FAILED` is only for adopt/auth materialize, not "CLI asked for login." Red spec: mock `grok --resume dead-id` → retry args omit `--resume`.

### W3 — Stop forcing AMC planner `--resume` on later design turns

**Done when:** `forceAmcGrokResume` applies only when the session directory was actually adopted **and** this is the first design spawn for that conversation (or AMC sends the **OD-captured** id). If AMC resends the planner id after OD already captured a studio session, OD uses the captured id. Project metadata may store `amcGrokSessionId` only if it is the studio session, not the planner id.

### W4 — AMC sequential queue on one conversation (AMC-owned; OD already ready)

**Done when:** AMC (not OD) loops: start run → wait terminal → GET manifest → if `coverage.missingSurfaceIds` then start next run with same `conversationId` and current revision. No new conversation. Documented in AMC; OD tests already cover sequential same-conversation runs for other agents.

### W5 — Live-stream only the first surface of each batch (product, already true)

**Done when:** AMC treats "live" as FileViewer of `designGenerationSurfaces[0]`. Surfaces 2–3 of a batch appear on Canvas after process exit. No OD work unless product insists otherwise.

### W6 — Optional: live-write claimed surfaces 2–3 during the same run

**Done when:** a second closed `<artifact identifier="billing">` overwrites `billing.html` **while the process is still running**, and Canvas refreshes that frame from disk (still inert). Not concurrent agents. Larger than W1–W3; not required for "all files returned."

### W7 — Do not build (unless product reverses 2026-08-22)

- OD-owned auto-queue that starts the next 1–3 surfaces without AMC.
- Concurrent same-project writers / N live FileViewers.
- Raising `surfaceIds` max so one run designs a whole SaaS.
- Host-level "subagents."

W7 is a new architecture, not a gap in the current one.

---

## 5. What we need from AMC

### Prompt / scope

- Persist `amc.design-scope.v1` and seed it on the OD manifest (`scope`, locked `directionStatus`, every surface, entry = `index.html`).
- User message: one instruction + the same scope. Do **not** ask for "one HTML that is the whole product."
- Per run, name the 1–3 target ids in the prompt (the daemon also injects the directive). Continuation runs: "here is the whole scope and existing files; write **only** these missing ids."

### Manifest / start payload

```http
PUT /api/projects/:id/design-manifest
{ "expectedRevision": 0 or current, "manifest": { …locked v2… } }

POST /api/runs
{
  "projectId": "…",
  "conversationId": "<same for every later surface>",
  "clientRequestId": "<new per logical start>",
  "message": "<instruction>",
  "agentId": "grok-build",
  "designGeneration": {
    "manifestRevision": <from last GET, not the seed after a claim>,
    "surfaceIds": ["dashboard"]  // 1–3, only queued|failed|missing-complete
  },
  "amcGrok": { … }
}
```

After each run: `GET /api/runs/:id` (wait until `deliverableValid` is set) **and** `GET /api/projects/:id/design-manifest`. Use `coverage.missingSurfaceIds` to build the next `surfaceIds`. Re-read `revision` every time.

Do **not** send 8 ids. Do **not** start a second run until the first is terminal (409 writer conflict).

### Grok forwarding

Until W1–W3 land:

- Always send `apiKey` and/or `authJson` so OD can materialize `GROK_HOME` on the OD host. A BE-only `grokHome` path without credentials is how device-login starts.
- First design run: `sessionId` + `sourceCwd` is optional continuity with the planner. If adopt fails, OD already drops resume and should stay on the API key.
- Later design runs on the **same conversation**: prefer **omit `sessionId`** (keep `grokHome` / credentials). Let OD resume its captured studio session — **after W1**. Until W1, omitting `sessionId` still `--resume`s a daemon UUID and can device-login; **fresh conversation is the only safe AMC workaround today.**
- Never expect OD to return Grok credentials to the browser.

### Return path

- HTML files: project file list / result-package / raw file GETs.
- Completeness: manifest `coverage`, not "we got an `index.html`."
- Conversation: `conversationId` on the 202 body; reuse it.

---

## Honest mapping to the owner's want

| Owner want | Today |
|---|---|
| One OD conversation | Supported as a data model. Unsafe on Grok follow-up until W1–W3. |
| AMC sends scope + one instruction | Supported if AMC then **queues** 1–3-id runs (or accepts a 3-surface product in one run). |
| OD orchestrates subagents | **Does not exist. Should not be the word.** Sequential runs are the primitive. Orchestrator = AMC (accepted 2026-08-22). |
| Every surface streams live like old `index.html` | **Only the first claimed surface per run.** Others are persist-at-exit + Canvas thumbnail. |
| Return all HTML to AMC | Yes, via project files + result-package + manifest coverage. |

The cheapest path to "one session, all screens designed, primary live, files back" is **W1–W3 in OD** plus **W4 in AMC**. Building a subagent orchestrator would fight the implemented writer lock, exact-output contract, and the accepted plan.
