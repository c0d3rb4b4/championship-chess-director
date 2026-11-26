# Championship Chess Director

Technical design for the [Live Chess Broadcast Interface PRD v1.0](Live_Chess_Broadcast_UI_PRD.docx). The first release produces a silent, automatically directed programme for one championship game. OBS captures the programme URL and the producer mixes music separately. The source document contains the visual mockups, provider references S1–S13 and the normative acceptance cases A01–A28.

## Runtime and ownership

Deploy one persistent Node.js/TypeScript process on the producer's machine with SQLite in WAL mode. Use a shared TypeScript domain model and a browser UI with a DOM or SVG chessboard. Keep chess rules on the server for authoritative replay and PV validation. Send the browser validated board frames, SAN and highlights. A single writer serialises observations, commands and director deadlines. Multiple OBS windows therefore see the same scene and never open additional provider connections.

| Component | Input | Responsibility and output |
|---|---|---|
| Provider adapters | One connection per configured feed | Decode versioned payloads into immutable observations with source, receipt time, optional trusted occurrence time and provider identity. |
| Reconciler | Bound event, observations, rules engine | Establish the authoritative mainline, verify analysis roots, assign epoch and revision, and invalidate descendants of corrections. |
| Programme timeline | Timestamped observations | Release eligible inputs in deterministic order to an independent on-air projection. Keep raw state accessible only to the operator. |
| Director | Released state, monotonic deadlines, profile | Select eligible scenes, freeze playback frames and emit versioned programme snapshots. |
| Programme client | Snapshot plus ordered server events | Render one scene, interpolate the running clock and animate the current ply. On a sequence gap fetch a fresh on-air snapshot. |
| Operator client | Preview, diagnostics and command API | Bind feeds, manage profiles and trivia, inspect health, rehearse and override direction. |

## Source contracts and game identity

At setup, bind event ID, round, players, colours, initial position and each provider's game identifier. Pin one authority for moves and results, preferably event PGN, with explicitly bound Sesse as a fallback deployment choice. An authority change requires a reconciled full snapshot and advances the revision. Follow the next round automatically only after verifying its mapping.

* Sesse adapter starts with a full snapshot and retains its version as the base for long-poll updates. Apply a delta atomically only against the expected base. Fetch a fresh full snapshot on a missing base, invalid patch or reconnect. An idle response proves transport activity only. Preserve principal and alternative lines independently.
* Leela adapter discovers and subscribes to the selected game ID. Merge partial updates by game and candidate identity, preserving entries omitted by a patch. Reset the subscription generation on reconnect and discard callbacks from the old connection. Verify the deployed socket, message semantics, WDL scope, scale, perspective and calibration using captures before enabling those fields. PRD S3–S4 describe an implementation pinned to a commit.
* Both adapters retain unknown additive fields in diagnostic captures. Unsupported required semantics disable the affected field or panel. Back off with jitter after failures. Optional cached-position lookups and opening databases are outside the P0 live path.

Replay the accepted sequence from its initial FEN. Identify each analysis root by game epoch, revision, ply, full legal position and a digest of the initial state and ordered UCI moves. Verify castling rights, en passant, move counters and repetition history. Same pieces in a different game or via another history cannot establish agreement. Incomplete history permits separately labelled limited verification only. A slow engine cannot advance or rewind the actual board.

## State, persistence and release

| SQLite record | Identity and contents |
|---|---|
| Game and moves | Epoch, authority, binding and revision. Per ply retain UCI, SAN, resulting FEN, timestamps, clock anchors and confirmed result evidence. |
| Observation journal | Local sequence, provider ID/version, payload, basis time, receipt time and deduplication key. Index by eligibility time and sequence. |
| Engine snapshot | Position key, source, analysis age, typed scores, candidate-level depth/work and legal PVs. Store selected historical samples separately from live churn. |
| Programme checkpoint | Released cursor, scene, frozen frames, deadlines, last applied command, profile version and rolling large-board intervals. |
| Editorial and configuration | Versioned profile, reviewed entries, provenance, command IDs and audit record. |

Use a transaction for each accepted mainline change and the dependent invalidations. Deduplicate retries by source version or content identity. A correction replays from the common ancestor, bumps the revision and invalidates subsequent analyses, clock samples, graphs and position-bound trivia. Revalidate dependent choice records against archived pre-move evidence. A game change starts a new epoch.

Compute eligibility from trusted occurrence time plus configured delay, otherwise receipt time plus delay. Never project a packet before receipt. Release causally dependent analysis only after the matching board is on air. For ties, commit the authoritative move or result before considering associated panels. Drive clocks, ticker, status changes and content-bearing commands through this projection too. Even cancelling a hypothetical line on upstream receipt could disclose a delayed move.

Restore from the last durable checkpoint and journal, advancing directly to the current eligible state without playing missed announcements. If coverage is insufficient, show a filling-buffer slate for the delay interval. Lock delay during play and reconcile under HOLD before changing it. Compact the journal only after checkpoint, delay and diagnostic retention requirements are satisfied. Keep per-ply evidence throughout the game. Use monotonic time for runtime timers and persisted presentation timestamps for recovery.

## Direction and interruption

At each eligible event or deadline evaluate concealment/HOLD, actual move or confirmed result, correction, time pressure, operator preference and scheduled rotation in that order. Tag every animation and timeout with epoch, revision, root ply and scene instance. A released move replaces the scene and invalidates those tokens in a single update. The browser drops queued animations for the superseded instance. Target at most 500 ms from release to the actual board on screen.

| Scene | Entry, duration and exit |
|---|---|
| Actual move | Highlight the move on the large board for at least 6 s unless superseded. Clear old arrows and pause ticker changes. |
| Settling | Label matching early values provisional. Allow headlines only after 12 s and readiness. At 30 s rotate matching provisional panels while keeping spotlight gates closed for unready lines. |
| Ordinary rotation | Comparison 20 s, Leela outcomes 18 s, time investment 20 s, search progress 16 s, history 20 s. Skip unavailable panels. With fewer than two, retain the best live summary. |
| Variation spotlight | After 75 s of thinking select a settled legal line. Hold root 2 s, advance at most eight plies at 2 s each and hold the end 4 s. Trim to a 24 s total budget including transitions. |
| Conclusion and waiting | Confirmed result stops clocks and playback. Show conclusion for 30 s then recap. Show match score and next start only from verified metadata. |
| HOLD | Freeze or conceal explicitly with a persistent label. Resume from the current eligible snapshot. A layout pin never freezes the game. |

Readiness is per engine and root. Require three substantive revisions spanning at least six seconds with a stable first move and advancing work. Reset on a changed first move. Tune optional score stability separately in pawns or WDL percentage points. Heartbeats never count. Replay the complete candidate line legally before selection. Alternate eligible sources with distinct ideas. Joint attribution ends at the verified common prefix. Freeze the chosen frame sequence through later engine updates.

After a spotlight, require a 90 s cooldown and 45 s of large-board time. Before entering, project the proposed scene against the rolling five-minute large-board minimum of 70%, excluding holds and conclusions. Disable spotlights with an uncertain clock, at or below five minutes, or after three actual moves within 30 s. Recover from rapid play after 45 quiet seconds with trusted clocks. In the final minute pin the large board and compact summary.

## Programme composition

Use a fixed 1920 × 1080 canvas, scaled uniformly. Header at (48,32), actual board at (80,184) sized 768 square, dual-engine summary at (912,128), changing panel at (912,272) sized 960 × 680 and ticker at (48,984). Keep orientation fixed unless explicitly changed. In a spotlight retain a 416-square actual board, player clocks and side to move on the left. Give the 768-square analysis board a move rail, source, root move and permanent **ANALYSIS LINE NOT PLAYED** label. Only the actual board has clocks.

Use cool blue for Stockfish and warm amber for Leela alongside their names. Use 44–56 px clocks, 30–36 px headings and at least 22 px secondary text. Animate changed elements for 250–400 ms and coalesce visible evaluations to two refreshes per second. Actual moves bypass coalescing. Keep the page silent and free of controls and scrollbars.

## Derived panels

* **Comparison.** Show up to three supplied candidates per engine with their own depth, preferred move, PV and source statistics. Normalise verified Stockfish pawn scores to White's perspective. Keep mate, bound and tablebase types distinct. Preserve Leela's native units. Promote agreement only for stable choices at the identical verified root.
* **Outcomes.** Validate tuple range, total, orientation and root versus candidate scope. For verified side-to-move tuples on Black's turn swap wins and losses. Convert to White win, Draw and Black win percentages, retaining precision and using largest-remainder rounding with fixed tie order. Label conditional estimates with their candidate move. Unknown calibration precludes claims about the players' personal odds. Search share requires a verified denominator and retains any undisplayed remainder.
* **Time investment.** Prefer recorded elapsed move time. Otherwise compute previous same-player post-move clock + increment + period bonus + signed adjustment − new clock. Require known conventions. Record gaps for missing anchors and investigate negative durations. Delay time controls require elapsed evidence. Plot completed-move totals and optional paired per-move bars. Label partial coverage with the starting move. Project only the verified running clock from an on-air anchor and stop extrapolation on transport uncertainty.
* **History.** Align separate Stockfish pawn and Leela WDL charts by ply. Freeze the last eligible sample before the next actual move, preserve age and gaps, and keep retrospective analysis in a separate series.
* **Ticker.** Store text, category, review state, source, priority, enabled flag, applicability window, binding, duration and expiry. Filter at programme time in Europe/London by default. Crossfade every 18 s, honour repeat cooldown and pause during move emphasis and result announcement. Operator pins still require eligibility. Ship reviewed historical facts and permit verified operator-authored opening notes.
* **Later context.** Database departure requires a named and versioned corpus, filters, transposition policy, exclusion of the current game and a complete query. A timeout suppresses the claim. For choice matches, freeze an already displayed choice at least five seconds before the earlier of verified occurrence and first trusted arrival. With arrival evidence alone label it “Earlier displayed choice”. Omit when chronology is insufficient.

## Operator interface and recovery

Serve read-only /programme and its on-air snapshot/event stream separately from protected /operator and its raw diagnostics. A programme snapshot carries sequence, presentation timestamp, game key, clock anchors, scene and ticker. Subscribe from its cursor or resnapshot on a gap. Keep secrets out of URLs. Bind controls locally by default. For remote operation authenticate writes, validate command payload and expected game revision, reject duplicate command IDs idempotently and log decisions.

Expose event binding, time control, schedule, automatic direction, return to live, eligible spotlight, pin, HOLD, appearance, cadence and editorial queue. Show delayed preview beside a distinctly labelled raw monitor. Validate imported profiles before atomic activation, including the total playback budget. Reject invalid changes without disrupting the active profile.

Track transport activity, actual moves and substantive engine progress separately. One failed engine loses its arrows and agreement claims while the other remains visible. Wrong-position analysis displays “Updating for this position” or a mismatch diagnostic. Loss of move authority retains the last confirmed board, labels interruption and age, freezes uncertain clocks and stops autoplay. A healthy twenty-minute think is ordinary play. Configure idle budgets per protocol (initial Leela candidate 75 s), and reconcile a full snapshot after reconnect. Only authoritative or explicit operator confirmation ends a game.

## Delivery and verification

Use recorded provider payloads, an injectable presentation clock and deterministic event ordering. Replay identical input twice and compare snapshots and scene decisions. Capture the programme at every transition, including the interval between upstream arrival and delayed release.

| Gate | Evidence |
|---|---|
| M0 — validate feeds | Capture current Sesse full/delta and Leela socket traffic. Verify event binding, WDL and candidate semantics, timing conventions and provider usage terms. Unknown Leela semantics block dual-engine launch. |
| M1 — reliable live view | A02–04, A07–09, A14, A17–25. Inject a late engine, repeated patch, wrong history, lost base, correction, disconnect, result, refresh and restart. Inspect every delayed output surface. |
| M2 — dynamic programme | A01, A05–06, A10, A24–27. Interrupt at each spotlight phase, including a pinned layout. Exercise castling, promotion and en passant. Have five viewers independently identify the actual board, turn and hypothetical status within five seconds. |
| M3 — complete P0 | A11–13 and A26–28 plus regression of all P0 cases. Verify 600→580 s with 30 s increment gives 50 s used and 100→1870 s with 1800 s bonus gives 30 s. Run eight hours without intervention and inspect memory, clock drift and repeated alerts. |
| M4 — richer context | A15–16. Test incomplete corpus, transpositions, insufficient chronology and post-move analysis with immutable historical evidence. P2 audience voting and tactical explainers remain future work. |

For OBS rehearsal use a 1920 × 1080 Browser Source at 30 fps with refresh-on-activation and shutdown-when-hidden disabled. Inspect at 1080p and downscaled 720p. Measure release-to-paint latency, scene transition latency (target one second), journal growth and dropped frames. Investigate above 1% frame loss across ten minutes of mixed scenes. Include an eight-hour recorded match, a provider changing events during a break and a browser restart while future moves are buffered. Mark all fixture broadcasts REPLAY or DEMO throughout.
