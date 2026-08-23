# AMC multi-surface Design Studio

**Status:** Accepted working design; OD-A and OD-B are implemented and verified locally, AMC follows.

**Repositories:**

- `Five-Boroughs-Labs-FBL/open-design` — Design Manifest, multi-surface generation/view, coverage.
- `Five-Boroughs-Labs-FBL/agent-mission-control` — post-grill Design Scope, ticket reconciliation, Feature gate.

## 1. Problem

AMC's current I'll-design-it path is fast and can produce an attractive primary HTML screen. It does not reliably design a complete SaaS, game, or other multi-surface product.

Today AMC sends Open Design a goal, a bounded summary of locked grill decisions, style/color, optional existing `DESIGN.md`, and tickets only when they already exist. Open Design is told to stream one primary artifact first and create extra screens only when it decides they are needed. AMC accepts one HTML file as enough to seal Design and exports at most eight HTML files.

This creates four gaps:

1. No durable inventory of journeys, screens, states, or game asset groups.
2. Early Design starts before ticket context exists and never receives the completed ticket delta.
3. Open Design can persist multiple files but has no coverage contract for the AMC product scope.
4. The Studio focuses one file at a time; it does not give the operator a whole-product visual overview.

## 2. Product outcome

After the grill locks, AMC produces one small structured Design Scope before detailed ticket planning. Open Design and the spec planner consume the same scope in parallel.

```text
final grill answer
  -> discovery locked
  -> short Design Scope pass
  -> persist versioned scope
     |-> Open Design: primary frame first, then remaining surfaces
     `-> spec planner: implementation tickets linked to surface ids
  -> reconcile completed tickets against scope and generated artifacts
  -> operator approves complete or explicitly partial coverage
  -> builders start with per-ticket design references
```

The first useful visual remains fast. Completeness becomes explicit rather than inferred from one good-looking page.

## 3. Ownership

### AMC owns

- Grill questions and locked product decisions.
- The post-grill Design Scope request and durable FeatureRun copy.
- Foundation/segment facts relevant to the product surface.
- Detailed implementation tickets.
- Stable links from `[UI]` tickets to Design surface ids.
- Feature gating, approval, and builder dispatch.
- Reconciliation between planned surfaces, generated artifacts, and tickets.

### Open Design owns

- The versioned Design Manifest stored with the OD project.
- Visual system, tokens, components, and layout decisions.
- Rendering surfaces and states from the supplied scope.
- Stable surface filenames and live generation status.
- Multi-surface Studio review and revisions.
- Coverage reporting and structured export.
- Design/media asset production when the manifest requests supported asset groups.

Open Design does not create AMC tickets. AMC does not become a visual generator.

## 4. Post-grill Design Scope

The scope is created only after discovery has no unanswered blocking questions. It is a short constrained planning result, not an implementation plan and not a visual artifact.

Recommended persisted location in AMC:

```text
featureRun.discovery.designScope
```

Proposed shape (AMC is authoritative; Open Design never rewrites it):

```json
{
  "schema": "amc.design-scope.v1",
  "scopeId": "dscope_01",
  "revision": 1,
  "intentDigest": "sha256:...",
  "product": {
    "type": "multi-tenant-saas",
    "primaryJourney": "Manage job applications"
  },
  "journeys": [
    {
      "id": "application-management",
      "title": "Manage job applications",
      "surfaceIds": ["dashboard", "application-list", "application-detail"]
    }
  ],
  "surfaces": [
    {
      "id": "dashboard",
      "title": "Dashboard",
      "purpose": "Summarize applications and upcoming work",
      "kind": "screen",
      "required": true,
      "states": [
        { "id": "populated", "label": "Populated", "required": true },
        { "id": "empty", "label": "Empty", "required": true }
      ],
      "formFactors": ["desktop", "mobile"],
      "priority": "primary"
    }
  ],
  "sharedPatterns": [
    {
      "id": "app-shell",
      "title": "Authenticated app shell",
      "surfaceIds": ["dashboard", "application-list", "application-detail"]
    }
  ],
  "assetGroups": [],
  "assumptions": []
}
```

Use **surfaces**, not a raw page count. A surface can require multiple states or form factors. Games can use the same contract for title, character select, lobby, HUD, pause, inventory, map, results, and settings, with additional `assetGroups` for characters, items, environments, icons, or effects.

### Scope pass behavior

- Input: goal, every locked question/answer, existing project/design context, foundation/platform facts.
- Output: small validated JSON only.
- This pass answers “what complete product must be designed?” It deliberately does not decide repository files, implementation order, test strategy, ticket dependencies, or acceptance criteria; those are why the detailed planner takes longer.
- The detailed planner does not independently rediscover the information architecture. It receives this exact scope and expands it into implementation-ready specs while Open Design begins the primary visual surface from the same revision.
- It does not write tickets or code.
- It does not normally reopen the grill. Non-blocking uncertainty becomes an explicit assumption.
- Failure must not strand planning. If scope generation fails, detailed specs continue and early Design waits for the finished `[UI]` tickets.
- Stable ids are lower kebab-case and immutable within a `scopeId`. Revisions can add or retire an id but cannot silently reuse it for a different meaning.
- `intentDigest` binds the scope to locked discovery without exposing the full grill transcript in browser-visible project metadata.

## 5. Shared ids and later reconciliation

The spec planner receives the exact persisted Design Scope and attaches stable ids to UI tasks:

```json
{
  "title": "[UI] Build application management",
  "designSurfaceIds": ["application-list", "application-detail"]
}
```

When the plan lands, AMC compares:

```text
scope surfaces
vs ticket designSurfaceIds
vs OD manifest artifacts
```

The reconciliation result can add missing surfaces, report orphaned designs, and map each prototype to the relevant tickets. It must not restart the OD project or discard the approved visual system.

## 6. Open Design Manifest

Open Design already emits an export-time `DESIGN-MANIFEST.json` using `open-design.design-manifest.v1`. The feature must evolve that existing contract to a durable project-level `open-design.design-manifest.v2`; it must not create a competing underscore-named file. AMC seeds the locked scope; Open Design owns generation state, artifact mapping, and derived coverage.

Proposed shape:

```json
{
  "schema": "open-design.design-manifest.v2",
  "revision": 4,
  "projectId": "project-01",
  "entrySurfaceId": "dashboard",
  "scope": {
    "schema": "amc.design-scope.v1",
    "scopeId": "dscope_01",
    "revision": 1,
    "intentDigest": "sha256:..."
  },
  "directionStatus": "locked",
  "surfaces": [
    {
      "id": "dashboard",
      "title": "Dashboard",
      "purpose": "Summarize applications and upcoming work",
      "priority": "primary",
      "kind": "screen",
      "file": "index.html",
      "status": "complete",
      "required": true,
      "states": [
        { "id": "populated", "label": "Populated", "required": true },
        { "id": "empty", "label": "Empty", "required": true }
      ],
      "formFactors": ["desktop", "mobile"],
      "latestRunId": "run-01",
      "updatedAt": "2026-08-22T00:00:00.000Z"
    },
    {
      "id": "billing",
      "title": "Billing",
      "purpose": "Manage plan, payment method, and invoices",
      "priority": "required",
      "kind": "screen",
      "file": "billing.html",
      "status": "queued",
      "required": true,
      "states": [
        { "id": "trial", "label": "Trial", "required": true },
        { "id": "active", "label": "Active", "required": true },
        { "id": "past-due", "label": "Past due", "required": true }
      ],
      "formFactors": ["desktop"],
      "latestRunId": null,
      "updatedAt": null
    }
  ],
  "coverage": {
    "required": 2,
    "complete": 1,
    "failed": 0,
    "waived": 0,
    "pending": 1,
    "missingSurfaceIds": ["billing"],
    "percent": 50,
    "ready": false
  }
}
```

The manifest is control metadata, not model-authored prose. `DESIGN-MANIFEST.json` is the portable public projection, while a daemon-private authority copy owns live claims, revisions, and statuses. The daemon store parses, normalizes, caps, and atomically writes both with optimistic revisions; direct edits to the ordinary project file cannot release a writer or forge completion. Coverage is always derived from validated authoritative state and committed files; callers and models cannot declare it directly. Unsafe paths, duplicate ids/files, unsupported future schemas, and stale revisions fail explicitly. A required surface may be explicitly `waived`; that resolves coverage as an auditable partial acceptance without pretending a file was generated. Existing projects and v1 export fallback remain compatible. An exact imported v1 handoff manifest is treated as “no durable v2 manifest,” so ordinary imported projects retain the historical Pages grid.

## 7. Multi-surface generation

Generation should be globally reasoned and progressively persisted:

1. Establish or inherit the visual system.
2. Stream the primary surface immediately into its stable file.
3. Mark that surface complete and make it reviewable.
4. Generate remaining surfaces in priority order through sequential runs, normally one surface and at most one related batch of three surfaces per run (`queued -> generating -> complete|failed`).
5. Reuse the same OD project, conversation/session, and visual system.
6. Persist status after every surface so Stop/crash/resume does not lose coverage truth.

Every generation task must receive the whole Design Scope and locked visual direction, while writing a bounded surface or related surface group. This is **think globally, render incrementally**: cross-screen coherence comes from shared scope and direction; reliability comes from separately tracked surface coverage. V2 requires the primary surface to use `index.html` so Open Design's existing immediate live-stream and handoff path remains intact.

Do not launch an unbounded set of independent screen agents or concurrent writers in the same project directory. Work is sequential and bounded inside one OD project/conversation. Each run carries a typed `designGeneration` target with the expected manifest revision and one to three surface ids. A continuation run receives only missing or failed surface ids, plus the complete scope, manifest, locked direction, and existing project files. Conversation resume can improve continuity, but correctness must be reconstructable from durable scope, manifest, direction, tokens, and artifacts alone.

AMC should orchestrate the queue later because AMC owns the durable FeatureRun and the transient provider credentials. Open Design owns target validation, stable file mapping, per-surface state transitions, and coverage. This prevents OD from persisting forwarded credentials just to execute a future queue.

One unbounded output that asks for an entire SaaS or game as a single artifact is not the target architecture. It risks token exhaustion, partial persistence, inconsistent screens, and an unreliable completion signal.

Initial compatibility behavior may continue to accept ordinary multi-file runs. Manifest-driven orchestration is an additive AMC path.

## 8. Canva-like review canvas

The Studio should add a whole-product **Canvas** view for manifest-driven projects.

### Required interaction

- All manifest surfaces appear as named frames on one board.
- Wheel/trackpad or drag pans horizontally and vertically.
- Zoom in, zoom out, reset, and fit-all controls.
- Clicking a frame selects it.
- Opening/focusing a frame enters the existing detailed FileViewer rather than replacing it.
- Frames appear or update as generation completes.
- Queued/running/failed/missing states are visible without pretending a file exists.
- The primary live stream remains visible while later surfaces generate.

### Implementation boundary

Do not mount the full heavyweight FileViewer/editor for every frame. The current viewer owns edit bridges, comments, publishing, keep-alive, and iframe lifecycle. The Canvas should reuse Open Design's existing lightweight HTML page-preview primitive and hand the selected surface to the existing FileViewer for detailed interaction. The Pages tab already provides sandboxed fixed-layout previews, lazy viewport loading, incremental batches, a bounded fetch queue, and version-aware source caches.

The first implementation should use a deterministic grid/flow layout derived from manifest order. Freeform frame repositioning and persisted x/y coordinates can follow after pan/zoom/selection are proven.

### Performance and safety

- Lazy-load or virtualize offscreen previews.
- Bound simultaneously live iframes.
- Keep preview iframes `pointer-events: none`; the focusable frame wrapper owns selection and every pan/zoom gesture.
- Freeze thumbnail motion, omit download capability, and avoid injecting host-facing bridges that an inert overview does not need.
- Size or partition the source cache for the supported surface cap so panning across a large board does not repeatedly evict and refetch frames.
- At low zoom, prefer thumbnails/placeholders over interactive documents.
- Keep preview frames sandboxed and inert on the overview board.
- Make the Canvas miniature document host-owned at its first bytes: CSP is inserted before all authored markup, and the iframe has an empty sandbox. A fake `<head>` in a comment or style must never capture the policy.
- Do not let generated HTML capture canvas pan/zoom input.
- Preserve the existing single-file workspace for non-manifest projects.
- Use native scrolling as pan state and a scaled inner world for correct scroll bounds. Ctrl/Cmd+wheel and `+`/`-` zoom; wheel/trackpad and space/middle drag pan; fit-all computes from the board bounds.
- Canvas ordering comes from manifest order, not file mtime, so a rewritten frame does not jump during generation.
- AMC embed mode currently hides the workspace tabs. The full HTML viewer therefore needs an **All screens** action that returns to Canvas; a Design-Files-only toggle would be unreachable from the embedded primary preview.

## 9. Approval semantics

Early visual approval and complete package approval are different facts.

Suggested internal states:

```text
direction_draft
direction_locked
coverage_generating
reviewable
ready
partial_accepted
```

The operator can lock the visual direction while the spec planner is still working. Final `Use this design` requires reconciled coverage or an explicit partial-coverage acceptance that lists missing surfaces. Builders must never infer full coverage from one HTML file.

## 10. Security boundary

- AMC's OD API token remains server-to-server only.
- AMC Grok credentials remain accepted only on authenticated OD API calls and are never returned to the browser.
- Manifest paths are project-relative, normalized, and bounded.
- Structured export is byte-bounded and cannot blindly inline an unlimited product.
- A signed, short-lived Studio embed grant should replace reliance on `?amcEmbed=1` as the integration matures; that query parameter is presentation mode, not authorization.

## 11. Delivery order

### Open Design first

1. Evolve the existing export-only `DESIGN-MANIFEST.json` v1 into a validated, durable v2 contract; keep v1 export fallback for ordinary projects.
2. Add an atomic daemon manifest store with optimistic revision checks and daemon-derived coverage.
3. Add authenticated project manifest GET/PUT APIs, a thin project invalidation event, and `od project design-manifest get|put` CLI parity.
4. Add typed, revision-checked `designGeneration` targets to runs and durable run status.
5. Stream the first targeted surface to its immutable manifest filename; keep legacy `index.html` behavior for unscoped runs.
6. Map bounded artifact identifiers to stable surface files, and transition only committed files to complete; failures affect only claimed unfinished surfaces.
7. Add the multi-surface Canvas overview with pan/zoom/fit/select and coverage/status placeholders.
8. Reuse the existing lightweight preview and keep selected-frame review on the existing FileViewer.
9. Add an **All screens** viewer action so AMC embed users can reach Canvas even while workspace tabs are hidden.

### AMC second

1. Add the post-grill Design Scope pass and persisted schema.
2. Feed the same scope into OD and the spec planner.
3. Add `designSurfaceIds` to planned UI work.
4. Reconcile ticket and OD coverage when Turn B completes.
5. Split direction lock from final Design completion.
6. Replace the fixed eight-HTML export assumption with manifest-aware bounded export.
7. Show coverage/progress in Mission.

## 12. Verification

Open Design:

- Manifest parser rejects unsafe paths, duplicate ids, and invalid states.
- Non-manifest projects render exactly as before.
- Canvas fit/zoom/pan/selection works with one, many, queued, failed, and missing surfaces.
- Live primary updates do not remount every frame.
- Project switch and file deletion cannot leak stale previews.
- Keyboard and reduced-motion behavior remain usable.
- Focused daemon/web tests, typecheck, guard, and a live browser walkthrough.

AMC follow-on:

- Final grill lock produces or safely omits a validated scope.
- Scope failure cannot block ticket planning.
- OD and Turn B receive the same scope revision.
- Ticket reconciliation adds missing surfaces without replacing the OD project.
- Early direction lock cannot start builders.
- Final/partial completion is explicit and fully audited.

## 13. Decisions still to verify in code review

1. Use the existing filename `DESIGN-MANIFEST.json`; do not introduce `DESIGN_MANIFEST.json`.
2. A narrow manifest endpoint is justified because it is the authoritative, revisioned AMC poll/mutation contract; the Canvas can still refresh through project file events.
3. Overview frames initially reuse the existing inert HTML preview path. Daemon-produced image thumbnails remain a later optimization if very large canvases make iframe previews too expensive.
4. Initial bounds: 60 surfaces, 128 KiB source Design Scope, 256 KiB durable manifest, and one to three surface targets per sequential run. Exceeding a bound fails explicitly; the review UI never silently truncates coverage.
5. AMC orchestrates sequential runs later; OD validates targets and reports coverage. No concurrent same-project writers in v1.
6. The exact signed-embed design and deployment compatibility remains follow-up security hardening; embed postMessage is UX notification only, never coverage authority.

## 14. Review outcome (2026-08-22)

Three focused architecture reviews and Claude Opus 5 agreed on the core shape: stable surface ids, a host-validated manifest, bounded sequential generation, a lightweight inert overview, and reuse of the existing full viewer for editing.

The review changed the initial proposal in these material ways:

1. Reuse and version the shipped `DESIGN-MANIFEST.json`; never create the confusing underscore variant.
2. Make `index.html` the primary surface in v2 so current live streaming remains fast and compatible.
3. Derive coverage from daemon-owned state plus committed files; never trust agent-authored coverage or stale running flags.
4. Expose the normalized manifest through one API used by both Web and `od --json` CLI.
5. Generate sequentially in target-bound runs of one to three related surfaces, with no concurrent same-project writers.
6. Make recovery stateless from durable project data even when conversation resume is available.
7. Give AMC embed an explicit **All screens** entry because its normal workspace tabs are intentionally hidden.
8. Preserve iframe and network budgets by extracting the existing preview machinery, freezing motion, and keeping the overview inert.
9. Load manifest membership at the workspace boundary as well as in Design Files. This keeps **All screens** available when AMC embed or a deep link opens a surface before the Canvas has ever mounted.
10. Override the shared compact-button height on Canvas frames. Each frame owns a non-shrinking 16:9 preview plus caption; real-browser fit/pan testing is required because DOM-only tests do not expose collapsed visual geometry.
11. Treat `generating` as an internal claim state. Public manifest PUT cannot forge an active writer, and a competing write receives a typed revision/writer conflict instead of a generic server error.
12. Mark a claimed surface complete only after the run itself succeeds and its exact stable file was both touched and committed. Failed or cancelled streaming drafts remain failed.
13. Normalize paths for Windows as well as POSIX: reject Windows-forbidden characters and case-folded filename collisions before any manifest reaches the store.
14. Bind lost-response retries to the original request fingerprint. A retry remains idempotent even if the manifest subsequently advances or removes that surface.
15. Show the whole-product Canvas only at the Design Files root. Entering a real folder returns to the ordinary file grid, preserving file navigation for manifest projects.
16. Rebuild a recharge-resumed target from the current durable manifest, reclaim its surfaces, refresh its exact file mapping/directive, and attach the same end-of-run reconciliation as a fresh attempt. A lost-response retry remains parse-only and idempotent; an explicit resume is a new physical attempt of the same logical request.
17. Make a non-empty artifact identifier authoritative. A wrong surface id can never satisfy a claim merely because its inferred filename happens to equal the target (especially `index.html`); filename fallback exists only for artifacts that omit an identifier.
18. Use one portable path identity—slash-normalized, NFC-normalized, and case-folded—across parser coverage, stale recovery, deliverable validation, and Canvas membership. Exact on-disk spelling wins; otherwise only one unambiguous portable match is accepted.
19. Reset folder/page/upload navigation before **All screens** opens Design Files. A surface opened from `screens/...` therefore returns to the root Canvas instead of a nested file grid.
20. Allow fit-all to go below the normal 20% manual zoom floor for large products. The 60-surface bound now genuinely fits in one viewport, while later wheel zooming cannot jump a sub-floor fitted board upward.
21. Persist the revision-specific surface-to-file mapping with the run so daemon restart and terminal validation cannot fall back to the wrong entry page.
22. Make Canvas miniatures genuinely static and offline: empty iframe sandbox, restrictive CSP, and defense-in-depth removal of authored scripts, handlers, redirects, and active embeds. The normal full viewer keeps its existing interactive behavior.
23. Carry the refreshed manifest target into recharge execution metadata so the runtime cannot overwrite a newly claimed revision with the original request revision.
24. Separate portable projection from live authority. `DESIGN-MANIFEST.json` remains exportable and inspectable, but daemon-private state is authoritative if a generic file tool or agent overwrites the projection; an authoritative read repairs that projection best-effort.
25. Serialize every same-project run, including two ordinary/unscoped runs and both targeted/unscoped orderings. All of them can touch the same project directory.
26. Enforce exact targeted HTML output at completion: every claimed file must be touched, and no unclaimed HTML file or daemon-owned manifest may be touched. Supporting assets remain allowed.
27. Reconcile stale claims before manifest GET and PUT, not only when a later run starts. A daemon restart therefore cannot leave Canvas indefinitely stuck on `generating`.
28. Place Canvas CSP before all authored markup instead of searching raw HTML for the first textual `<head>`, which could be inside a comment.
29. Fence the short terminal-to-manifest reconciliation window in memory. A normal GET cannot mark a just-finished run stale before exact-output validation commits, while a daemon restart intentionally loses the fence and recovers the abandoned claim from durable run state.
30. Delete daemon-private manifest authority with the project so a removed project cannot leave control-state orphans or contaminate an unlikely future id reuse.
31. Recover a successful terminal claim as complete only when the run's durable `deliverableValid` checkpoint proves the exact-output validator passed. Status, file presence, and artifact paths alone are insufficient after restart.
32. Serialize manifest reads, reconciliation, and project-state deletion on the same daemon-global project lock, and reject later mutations once the project registry row is gone. Direct and workspace batch deletion both clear public projection and private authority without hiding cleanup errors.
33. Discover Canvas through the authoritative manifest endpoint even when the public projection is missing or the ordinary file inventory is stale. Endpoint `404` remains the legacy/non-manifest fallback.
34. Treat public-projection writes as repairable after private authority commits. A projection failure cannot turn a committed revision into a false API failure; the next authoritative read repairs it best-effort.
35. Never bootstrap private v2 authority from `DESIGN-MANIFEST.json`. The portable file is untrusted even when authority is absent; only sanctioned manifest writes may create authority. Project duplication explicitly snapshots source authority and seeds revision 1 for the destination, resetting any in-flight claim to queued and clearing source run ids.
36. Match imported-folder deletion semantics. Removing an Open Design project always deletes daemon-private authority, but deletes the public projection only from a daemon-managed project directory; user-owned imported folders and their files remain untouched.

### Implementation stages on this branch

- **OD-A — complete:** contracts, v2 store, derived coverage, GET/PUT API, project invalidation, CLI parity, Canvas, direct-link-safe All screens entry, tests, and browser verification.
- **OD-B — complete:** typed run targets, stable per-surface persistence, live target mapping, run state transitions, stale recovery, writer exclusion, failure/retry handling, and lifecycle tests.
- **AMC follow-on:** Design Scoper, planner ids, sequential queue, reconciliation, approval gates, manifest-aware handoff.
