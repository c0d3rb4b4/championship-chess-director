# Championship Chess Director delivery plan

Start with **Phase 0, the metal board and matching piece set**, to review the new visual direction against a working demo. Then use Phase 1 to reacquire analysis after a real move. Phase 0 is independent of the engine work, so Phases 1–5 keep their existing numbers and dependencies.

[Product requirements](Live_Chess_Broadcast_UI_PRD.docx) · [Technical design](DESIGN.md) · [Demo implementation](DEMO_SLICE.md) · [Review captures](evidence/README.md)

## What exists today

| Area | Pilot baseline through `64377bb` | Boundary to carry forward |
|---|---|---|
| Game | `fixtures/demo-game.json` contains 18 initial plies and one scheduled actual move, 10.d4. The server legally replays the history from the starting position. | The fixture has one scripted event and one analysed root. It does not establish event selection, corrections or result handling. |
| Analysis | `src/server/fixtures.ts` checks game identity and replays each candidate. Both sources have three synthetic work samples at 0, 3 and 6 seconds. Each candidate carries its own depth. | The initial Leela root declares scale 1000, White perspective and synthetic calibration. Production score fields, scope and configuration need independent verification. |
| Direction | `src/server/director.ts` starts playback at 75 s. The root holds for 2 s; subsequent PV plies play every 2 s. The move released at 83 s preempts a simultaneous PV deadline. At 89 s the six-second emphasis ends. | This proves one interruption. It does not exercise general panel rotation, engine alternation or discovery of a second live game. |
| Recovery | `src/server/http.ts` serves ordered full snapshots to both routes. SQLite stores one checkpoint and applied command IDs in `src/server/store.ts`. | A fixture restart restores elapsed programme time. A future restart against an advancing live feed needs a journal and a release cursor. |
| Graphics | The broadcast strip and reduced-motion cut shipped in PR #2. The actual board scales from 768 to 416 px during a spotlight. The hypothetical board is separate and labelled. | Two-viewer browser timing is a local sample. Keep OBS performance and viewer comprehension as open release gates. |

**Merged scorecard (PR #3).** The demo puts SAN, recent actual moves, source-labelled candidates, per-line depths and Stockfish/Leela statistics on screen. The played strip follows the accepted mainline across scenes. Whenever the engine summary is on air and matching WDL is available, it shows explicitly labelled percentages. A separate timed WDL detail view is optional; history graphs and live feeds are future slices. Operating instructions and interpretation belong in the README, control room or specification. The default programme carries the game, analysis, statistics and essential state labels. Reserve editorial features for an explicit producer choice.

## Sequence and dependencies

| Slice | Depends on | Output to review |
|---|---|---|
| 0. Metal board and twelve chess pieces | Current fixture pilot | In review. Local A01, A27 and A29–33 regression checks plus A36 visual review are recorded in the [review captures](evidence/README.md). Live interruption, encoded OBS texture and viewer checks remain for sign-off. |
| 1. Multiple analysed positions | Current fixture pilot | Play 10.d4, watch each source update independently, then play a Black reply. |
| 2. Statistics and rotation | Slice 1 for move boundaries | Watch WDL, search work and history advance across real moves with the actual board and clocks anchored. |
| 3. Validate provider contracts (M0) | Independent of slices 1–2 | Replay captured packets offline into typed observations and inspect field provenance. |
| 4. Release live game state (M1) | Slices 1 and 3 | Follow one bound game, with delay, corrections and recovery. |
| 5. Generalise direction and operations (M2) | Slices 2 and 4 | Direct a full classical game through normal play, pressure, source failure, result and interval. |
| 6. Broadcast sign-off (M3) | Phases 0–5 | Reproducible full-game and eight-hour rehearsals, browser and OBS evidence. |

**Progress at this revision.** Phase 0 is in review. Phases 1–6 are planned. PRs #1–3 delivered the fixture pilot, broadcast composition and scorecard. When working a phase, add its PR number and the passing or outstanding exit checks beside its row. Use the merged PR and its evidence to mark a phase complete.

Deliver one selected phase per pull request. Use the numbered steps within that branch as implementation and verification checkpoints. Preserve one working programme at each merge. The core gates have distinct owners in code: adapters establish field meanings, the server decides what is eligible, and the browser renders the released snapshot.

### 0. Metal board and matching chess pieces

**Target.** The two reference views show the same board in an opening and a sparse endgame. Light squares resemble brushed silver plates with faint vertical grain and tiny fasteners just inside the corners. Dark graphite squares carry a quieter diagonal abrasion pattern. Coordinates reverse tone at the edge. The last move leaves a desaturated blue-grey tint on both the origin and destination. White pieces have an opaque light body with a strong dark outline. Black silhouettes have light internal cuts that distinguish the pieces even against graphite.

**Implementation.** Start with the shared SVG board in `src/client/board.ts` and its piece and coordinate styling in `src/client/styles.css`. Give actual and analysis boards the same material and piece set. Scope SVG definitions per board instance. Render the last-move tint from each board’s own frame. Keep grain stationary and fasteners subordinate to the pieces. At the 416 px size, reduce texture detail first. Use locally bundled, reproducible artwork with recorded provenance. The fixed clocks, scorecard and played-move strip already provide the surrounding broadcast layout.

**Piece artwork.** Deliver a locally bundled two-colour set alongside the square treatment. The current implementation draws the six Unicode symbols with a system font. Replace that piece-rendering path with deterministic vector artwork keyed by side and piece type. White pieces have opaque white bodies and bold black contours. Black pieces have solid dark bodies with deliberate white cuts in the face, crown or collars. A pawn can stay solid. The pieces themselves are flat ink drawings; the brushed finish belongs to the squares.

| Piece | Shape to match in both colours |
|---|---|
| Pawn | Small round head, rounded collar, flared bell-shaped body and flat foot. |
| Knight | Left-facing horse in both colours, two pointed ears, a cut-in muzzle and sweeping mane. Keep the eye and mane legible. |
| Bishop | Ball finial above a pointed mitre with a central cross, banded collar and a split, sweeping foot. |
| Rook | Square battlements, narrow straight tower shaft and broad stepped plinth. |
| Queen | Five splayed crown points with round tips, narrowing into a band above a broad base. |
| King | A cross above a three-lobed crown, with a broad banded base. The crown must be recognisable beside the queen at miniature size. |

**Piece review.** Use the [opening-position reference](reference/metal-board-and-pieces.png) to compare the major pieces across the back ranks and the pawn banks. Include a contact sheet in the implementation PR showing each of the twelve pieces on both silver and graphite (24 samples). Include a compact-size sample as well as in-game captures: the 416 px board becomes roughly 35 px per square at 720p. Inspect the bishop’s mitre, the king’s cross, the queen’s points and the knight’s profile at that size. Source and attribute suitable vector assets, or draw original ones. The screenshot is visual reference; the runtime loads local piece assets. Completion requires the surface, pieces and in-game evidence together.

**Exit evidence (A36 alongside A01, A27 and A29–33).** Capture the large board in a crowded opening and a sparse endgame, then capture the 416 px actual board beside the 768 px analysis board. Review at 1920 × 1080 and 1280 × 720. Check all twelve piece silhouettes on both square colours, edge-coordinate contrast and a last move on each colour. Advance the hypothetical line and confirm that only its board changes highlights. Release an actual move during the line and rerun the existing interruption and reduced-motion tests. Retain the captures for PR review. Phase 6 adds the encoded OBS check for texture shimmer. The [review captures](evidence/README.md) document the rendered metal theme.

### 1. Complete a second analysis cycle

1. Extend the fixtures with a small ordered event sequence. Keep the existing rehearsal timestamps and first interruption. Add a matching Stockfish update for the position after 10.d4, a late Leela sample for the previous root, then matching Leela revisions for the new root and a legal Black reply. Store expected ply, side and actual SAN alongside the rehearsal cases in the fixture guide.
2. In `src/server/fixtures.ts`, validate each root from its full move history. In `src/server/director.ts`, select the latest eligible sample per engine and root at the current presentation time. The server owns pov, scope, units and legal PVs. The browser should be able to render a changed percentage or move without knowing the fixture's names, score or timestamps.
3. Keep clock anchors and released moves together. The same snapshot must change the actual board, turn, recent SAN and source statuses. Drop the old score, WDL, candidate lines and arrows as soon as the root changes. A late packet for an old root cannot restore them.
4. Add fake-clock director tests at one tick before, at and after each boundary. Replay twice and compare board state, visible values and scene order at the same timestamps. Extend the browser case to verify that one returning source can be shown while the other remains pending.

**Exit evidence.** Sequence of four programme snapshots: old root with both engines, new root pending, new root with one engine, new root with both. At every step the fixture and programme agree on ply, side and root. The summary for each source contains only that source's released data. Re-run the 500 ms move interruption test. Relates to A01, A03–07, A09 and A33–35.

### 2. Add one statistical question per panel

Extend `ProgrammeSnapshot` with the minimum typed data each panel needs. Keep panel selection and deadlines in the director. Use the existing 1920 × 1080 fixed canvas, score strip and small-board/large-board distinction. Implement the rows as review checkpoints on the Phase 2 branch and present their captures together in its pull request.

| Panel | Data and display | Fixture and pass condition |
|---|---|---|
| Leela outcomes | Keep the compact estimate visible on the engine summary. If the selected profile includes an 18 s detail scene, enlarge this same estimate. Label White / Draw / Black; add candidate SAN if the estimate is conditional. Convert known scale and perspective once on the server. | White-root 300/500/200 per thousand gives 30/50/20%. A Black-to-move tuple swaps wins and losses only when its documented perspective is side to move. Test a malformed tuple, partial data and a rounding tie. Suppress an ineligible scene. |
| Search progress | Preserve each source's own depth and work units. Show the observed sample age or work delta only with reliable timing. Keep each candidate's supplied depth. | Hold work fixed across heartbeat packets, then advance it. Readiness must advance only on genuine work. If visible candidates account for 72% of verified total visits, preserve a 28% remainder or label the sample partial. |
| Time investment | Anchor to the same player's successive post-move clocks; prefer supplied elapsed times. Record increment, period bonus and signed adjustments with the move. Carry missing observations as gaps. | 600→580 s with 30 s increment yields 50 s. 100→1870 s with 1800 s bonus yields 30 s. A missing starting clock leaves the first duration unknown. Current thinking time stays outside completed-move totals. |
| Evaluation history | Align series by released ply. Retain source, position, units, observation age and revision with each point. Store the last eligible pre-next-move sample, leaving gaps where needed. | Add late analysis for the previous position. The existing on-air point stays frozen. A subsequent correction invalidates affected points. Stockfish pawn scores and Leela percentages use distinct scales. |
| Ordinary cycle | Begin with comparison, WDL, time, search and history. Skip missing panels and retain the best comparison when fewer than two are eligible. Schedule changes on the presentation timeline. | Exercise one eligible panel, two panels, a root change during entrance and a zero-duration/rejected profile. A resnapshot or clock tick cannot restart an entrance. Keep at least 70% large-board time over the five-minute window defined by the PRD. |

**Review evidence.** Capture each new panel with typical, missing and long values at 1080p and downscaled 720p. Assert that the clock strip stays anchored, text fits, the actual board remains visible and each numerical field has scope, side or unit where required. Exercise reduced motion and a released move at each panel boundary. Covers A07–13, A27, A29–34.

### 3. Validate the live input contracts

Capture a full snapshot, ordinary update, idle period, disconnect and reconnect from each deployed source. Document the capture date, feed version or implementation revision, selected event/round and which fields the production configuration actually supplies. Keep replayable samples small and identify any redistribution restrictions before checking captures into the repository.

| Source | Decoder contract | Failure fixture |
|---|---|---|
| Event authority | Pin authority, provider game ID, round, player IDs/colours, start FEN, moves, result and clock convention. Reconcile the mainline before admitting dependent analysis. | Two rounds with the same players; unrelated event during an interval; result absent despite a mate evaluation. |
| Sesse | Decode full state and apply a delta against the advertised base. Keep typed pawn, mate and bound scores; keep separate candidate depths. | Missing base triggers full resnapshot; duplicate patch creates no second move; idle poll leaves genuine-work timestamp unchanged. |
| Leela | Bind the subscribed game and connection generation. Preserve unmentioned candidates across partial updates. Verify score scope, perspective, calibration and actual search-share denominator. | Late message after game switch; wrong-root PV; unsupported WDL scale; partial game list omitting the selected game. |

Implement provider-specific decoders outside the renderer. Reuse the chess replay/root-validation logic already exercised by the demo. Give each decoder a contract test that runs without internet access. Record explicitly which fields remain unknown and disable only the features depending on them. M0 closes when a replay can reconstruct the bound game and both advertised analyses from observed production payloads. A03–04, A07–09, A14, A17–18.

### 4. Release a live position without leaking the next one

1. Add versioned migrations in the store for immutable observations, accepted moves, selected engine samples and release checkpoints. Keep command deduplication. Attach receipt time, optional verified occurrence time, source ID/version, epoch, revision, root ply and content identity as applicable. Define compaction after the replay, delay and diagnostic windows.
2. Reconcile by event, game, start position and complete legal history. Establish a revision on correction, replay from the shared ancestor and invalidate dependent lines, clocks, histories and scene callbacks. Keep old observations available for diagnosis.
3. Introduce a server release queue. With delay D, release an item no earlier than both receipt and the trusted time basis plus D. Break timestamp ties with actual moves/results ahead of their dependent analyses. The programme HTTP snapshot, SSE, browser refresh and operator programme preview all read the released state.
4. Simulate a restart with an intact journal, then with a missing interval. Recover directly to the eligible position when history suffices; show the buffer-filling state otherwise. On authority loss, retain the last confirmed board and stop uncertain clocks and PV playback. After one engine fails, keep the surviving engine and actual game available.

**Boundary test.** Buffer a move for a 60 s delay while a hypothetical line is on air. Sample both viewers just before and after release. Inspect boards, clocks, SAN, WDL, arrows, result and operator programme preview. Even an early cancellation would disclose the move. Repeat with refresh, source correction and result. Exercise A02–04, A17–23, A25 and A35.

### 5. Generalise the director and operator controls

Replace fixture-specific deadlines with a profile applied to the released state. Add scene eligibility and repeated long-think policies, then bind the protected operator commands to the same policies. Expose profile tuning, source status and diagnostics on the control surface.

| Rehearsal event | Expected programme decision |
|---|---|
| Human thinks for 20 minutes with healthy feeds | Continue live coverage. Prefer a settled legal PV after 75 s. Allow at most 24 s per spotlight, 90 s cooldown from its end and at least 45 s of large board before the next. Alternate eligible distinct ideas. |
| Running clock reaches 5 min, then 60 s | Disable spotlight at the first threshold, retain large board with compact summary at the second. Three actual moves in 30 s also suppress playback; recover after 45 quiet seconds with trusted clocks. |
| Result, correction or real move occurs during a panel entrance | Resolve the higher-priority event in one server update. Drop all superseded animation state. A layout pin cannot block new actual moves. |
| Producer selects HOLD or changes delay | Enter an explicit HOLD/waiting state. Validate profile ranges and buffer coverage; resume to the eligible position once reconciled. |
| Confirmed result, interval, next round | Freeze clocks. Show confirmed result, verified score and confirmed next start when available. Advance only to a verified binding, using a fresh epoch. |

Use `tests/director.test.ts` for clock-driven boundary cases, `tests/http.test.ts` for replay/restart and command ordering, and `tests/browser/interruption.spec.ts` for visible behaviour across two viewers. Cover A01, A05–06, A10, A14, A20–25. The producer should be able to leave a full fixture game running without manual scene switching.

### 6. Sign off on the production host

| Check | Evidence to retain | Pass condition |
|---|---|---|
| Browser regression | Typecheck, build, Node and browser results from the reviewed revision. Screenshot a long name, late engine, spotlight, interruption, result and reduced-motion view at both sizes. | No clipped essential data, duplicate labels, hidden actual board or old PV after an eligible move. |
| Timed interruption | Record server release, first correct programme frame and the measurement method. Repeat for a coincident PV deadline, entrance and active delay. | Eligible release to correct actual board within 500 ms. Distinguish upstream delay, command-to-browser samples and encoded output. |
| OBS capture | Record host, OBS settings, resolution, target FPS and dropped frames during ten minutes including a spotlight and result. | Use a 1920 × 1080 Browser Source at 30 fps. Investigate frame loss over 1%; inspect the resulting 720p view. |
| Full-game soak | Eight-hour recorded match with healthy long thinks, data loss, restart and a between-games interval. Sample process memory, journal size, reconnect counts, scene time shares and clock drift. | Bounded storage and memory after compaction, clocks agree with trusted anchors, no repeated announcements and no required manual direction. |
| Viewer comprehension | During a spotlight ask five viewers independently which board is actual, who is to move and whether the featured line was played. | Each identifies all three within five seconds. Verify the minimal labels before adding any explanatory text. |

Record the result and evidence for the game-only presentation and planned v1.3 board theme in the release review.

| Check | Verify on the captured programme |
|---|---|
| A32 · Programme content | Review the ordinary, early analysis, spotlight, interrupted and offline states in the programme and operator preview. Every visible word is a game field, move, metric, necessary label or state. |
| A33 · Played strip | Release 10.d4 once. Exactly one ply appears; a PV step, manual return and browser refresh add zero. |
| A34 · Outcome semantics | Validate all three fixture percentages, a legitimate zero, absence of WDL and an old-root message. Labels and eligibility must survive updates. |
| A35 · Degraded state | Hold one source behind, disconnect the programme and reconnect. Only the appropriate status appears on air; technical recovery detail stays in the control room. |
| A36 · Board and piece set | Review the 24 piece/square combinations, opening and endgame at full and compact sizes, and the two independent last-move tints. Inspect grain stability in the encoded recording. |

Sign off A26–36 alongside the earlier slice evidence. Until the live feed and host checks pass, retain the DEMO/REPLAY identifier on fixture or recorded output.

### Later, by explicit choice

Optional database-departure and earlier-choice records need a named/versioned corpus or immutable pre-move evidence respectively (A15–16). Their failure mode is an omitted claim. Trivia, promotional copy and a commentary ticker are outside the default game presentation. Entry scheduling, provenance and expiry belong to a future opt-in editorial profile. None is a dependency of the next stats or live-feed pull request.


## Run one phase in Codex

Use the same request for every phase. With **NEXT**, start at Phase 0 and advance in numbered order after each reviewed PR is merged. You can substitute a number (0–6) to select a particular phase. The dependency table also supports starting Phase 3 alongside fixture development. If an open PR already covers the selected phase, continue there. The “Later” section is outside this numbered run.

```text
Implement phase NEXT of docs/PHASED_PLAN.md in c0d3rb4b4/championship-chess-director and open one PR against main. NEXT means the lowest-numbered unfinished phase whose prerequisites are merged. Use the plan, current code and existing PRs to determine its status. If all phases are complete, report that.

Start from current main. Read the selected phase, its dependencies and exit criteria, the relevant parts of docs/DESIGN.md and the PRD in docs/, and inspect the current code and tests. Check merged work and open PRs first. Reuse an open phase branch, or create a fresh branch for the outstanding work. If the phase is already complete, give me its PR link.

Implement the selected phase end to end. For Phase 0, deliver both the brushed-silver/graphite squares and all twelve reference-style vector pieces, with a 24-sample piece sheet and full/compact in-game captures. Keep the programme focused on the actual game, labelled analysis and stats. Run the repo’s typecheck, build, Node and browser tests plus the phase-specific checks. For visible changes, inspect 1080p and 720p captures and include them in the PR. Record what passed and any evidence that still needs a live feed, OBS host or viewer session.

Update the phase progress in the plan, commit and push the work, and open or update the PR. Leave it open for review. Return the PR link, what I should inspect and any outstanding acceptance checks.
```

For a phase with an external sign-off step, deliver the work that can be verified, specify the missing evidence in the PR and resume that same phase when the evidence is available.
