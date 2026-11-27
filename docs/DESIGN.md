# Championship Chess Director

Technical design for the [Live Chess Broadcast Interface PRD v1.3](Live_Chess_Broadcast_UI_PRD.docx). The first release produces a silent, automatically directed programme for one championship game. OBS captures the programme URL and the producer mixes music separately. The source document contains the visual mockups, provider references S1–S13 and the acceptance cases A01–A36.

## What belongs on each surface

The standard programme carries the actual game, hypothetical analysis and measured statistics. The director decides when the picture changes. The viewer needs the evidence for the position on screen. The operator needs controls and the reasons an item is ineligible.

| Surface | Required information | Where the detail belongs |
|---|---|---|
| Programme | Players and colours, actual clocks and turn, last played move, confirmed result, engine identities, verified values and the active board role. Keep DEMO or REPLAY visible in rehearsal. | Use SAN, unit labels and tabular numbers. One label per item or column. |
| Operator | Same eligible programme preview, local cues, source health, bound game, active scene, fixture time, command success or rejection. | Keep diagnostics such as the root key, event cursors, adapter error or validation reason outside the capture. |
| Documentation | Score semantics, timing defaults, recovery procedures, fixture details and test instructions. | Link the control room runbook from the repository; keep paragraphs and rehearsal instructions off the programme. |

Use the [pilot contract](DEMO_SLICE.md) and [phased plan](PHASED_PLAN.md) to distinguish implemented behaviour from target behaviour. The stateful service below is the target architecture. The current server runs a synthetic fixture with a checkpoint and command journal. Live adapters, an arbitrary-delay observation journal, general scene rotation and the final OBS performance gate require additional work.

## Runtime and ownership

Deploy one persistent Node.js/TypeScript process on the producer's machine with SQLite in WAL mode. Use a shared TypeScript domain model and a browser UI with a DOM or SVG chessboard. Keep chess rules on the server for authoritative replay and PV validation. Send the browser validated board frames, SAN and highlights. A single writer serialises observations, commands and director deadlines. Multiple OBS windows therefore see the same scene and never open additional provider connections.

| Component | Input | Responsibility and output |
|---|---|---|
| Provider adapters | One connection per configured feed | Decode versioned payloads into immutable observations with source, receipt time, optional trusted occurrence time and provider identity. |
| Reconciler | Bound event, observations, rules engine | Establish the authoritative mainline, verify analysis roots, assign epoch and revision, and invalidate descendants of corrections. |
| Programme timeline | Timestamped observations | Release eligible inputs in deterministic order to an independent on-air projection. Keep raw state accessible only to the operator. |
| Director | Released state, monotonic deadlines, profile | Select eligible scenes, freeze playback frames and emit versioned programme snapshots. |
| Programme client | Snapshot plus ordered server events | Render one scene, interpolate the running clock and animate the current ply. On a sequence gap fetch a fresh on-air snapshot. |
| Operator client | Preview, diagnostics and command API | Bind feeds, manage profiles, inspect health, rehearse and override direction. |

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
| Actual move | Highlight the move on the large board for at least 6 s unless superseded. Clear old arrows and advance the played notation. |
| Settling | Label matching early values provisional. Hold any comparison emphasis until 12 s and readiness. At 30 s rotate matching provisional panels while keeping spotlight gates closed for unready lines. |
| Ordinary rotation | Comparison 20 s, Leela outcomes 18 s, time investment 20 s, search progress 16 s, history 20 s. Skip unavailable panels. With fewer than two, retain the best live summary. |
| Variation spotlight | After 75 s of thinking select a settled legal line. Hold root 2 s, advance at most eight plies at 2 s each and hold the end 4 s. Trim to a 24 s total budget including transitions. |
| Conclusion and waiting | Confirmed result stops clocks and playback. Show conclusion for 30 s then recap. Show match score and next start only from verified metadata. |
| HOLD | Freeze or conceal explicitly with a persistent label. Resume from the current eligible snapshot. A layout pin never freezes the game. |

Readiness is per engine and root. Require three substantive revisions spanning at least six seconds with a stable first move and advancing work. Reset on a changed first move. Tune optional score stability separately in pawns or WDL percentage points. Heartbeats never count. Replay the complete candidate line legally before selection. Alternate eligible sources with distinct ideas. Joint attribution ends at the verified common prefix. Freeze the chosen frame sequence through later engine updates.

After a spotlight, require a 90 s cooldown and 45 s of large-board time. Before entering, project the proposed scene against the rolling five-minute large-board minimum of 70%, excluding holds and conclusions. Disable spotlights with an uncertain clock, at or below five minutes, or after three actual moves within 30 s. Recover from rapid play after 45 quiet seconds with trusted clocks. In the final minute pin the large board and compact summary.

## Programme composition

Use a fixed 1920 × 1080 canvas, scaled uniformly. The baseline reserves a 768-square actual board, a right-hand analysis region, a fixed header and a lower strip for recent played notation. Keep orientation fixed unless explicitly changed. In a spotlight retain a 416-square actual board on the left. Keep both player clocks and the side-to-move indication in the header. Give the 768-square analysis board a move rail, source, root move and permanent **ANALYSIS LINE NOT PLAYED** label. Only the actual board has clocks.

Use named engine columns on neutral score plates. Use 44–56 px clocks, 30–36 px headings and at least 22 px secondary text. Slide and fade an incoming supporting panel over 760 ms and coalesce visible evaluations to two refreshes per second. Actual moves bypass coalescing. Keep the page silent and free of controls and scrollbars. For a long line, remove trailing whole plies before reducing type size. Keep check, mate, capture, castling, disambiguation and promotion marks intact.

### Score strip, board identity and motion

The reference broadcast gives the board the most area, keeps clocks in a fixed strip, and assigns one purpose to each supporting graphic. Use the right-side area for engine analysis. The product needs neither a camera feed nor event artwork. The fixed header pairs the event and side to move with an ivory player strip. An underline and vermilion digits identify the running clock. Keep this header at the same coordinates during spotlight playback. Give each board its own label and reserve clocks for the actual game.

| Element | Treatment at 1080p |
|---|---|
| Canvas and tiles | Flat near-black field (#101010), square corners, aligned seams. |
| Clocks and scores | Ivory (#F7F5EF) with dark ink. Tabular digits and fixed allocation for both clocks. |
| Board | Planned brushed-silver and graphite squares, bold monochrome pieces and a cool blue-grey last-move tint. See the board specification below. |
| Graphic labels | Compact rectangular slugs, condensed uppercase headings, sentence case for continuations. Name each engine. |
| Outcome display | Show independent White win, Draw and Black win percentages from a verified root or named candidate. The comparison sheet also uses these values for the segmented bar. |

| Change | First visible frame | Motion |
|---|---|---|
| Enter spotlight | Full actual board in motion with both clocks anchored | The live board travels down and left and scales to 416 px as the labelled analysis board and rail slide in from the right edge. The boards share a 1.05 s timeline and ease to a stop with a gap between them throughout. |
| End spotlight at the same position | Actual board grows back into the main layout | The boards reverse along the same 1.05 s path with the same easing and separation. The supporting panel slides in underneath. |
| Actual move during playback | Publish the accepted position, clocks and played-move strip | Stop the PV and animate the two boards back from their current positions over 750 ms. Reveal the new move tint and supporting move graphic on landing. |
| Actual move during another programme panel | Publish the accepted position on the anchored live board | Slide the outgoing panel off the right edge over 750 ms, then reveal the tint and move graphic. Keep the move card in place while engines are still pending. |
| Next PV ply or clock tick | Advance the current frame or digits | Retain label positions. No scene entrance. |
| Reconnect, refresh, reduced motion | Render the eligible snapshot | Direct cut. Never queue a missed animation. |
| WDL and history updates | Publish the new eligible value or point | Smooth bar width only within a root. Clear obsolete values immediately on a root change. |

The pilot client receives full SSE snapshots. The director owns scene timing and the sequence of hypothetical plies. The browser starts motion on a change of scene instance and preserves animated elements through clock and evaluation updates. The departing analysis freezes as artwork during a return or a consecutive played move. Corrections, discontinuous snapshots, disconnects and resnapshots clear the artwork and cancel the prior motion.

Evaluation history and cumulative move time begin at move 0 and extend through the latest played position. Cumulative time starts at zero for both players. The evaluation chart plots the recorded starting-position sample when available. Missing samples remain gaps. Axis labels thin as history grows while the plot retains each recorded point.

See the [phased implementation plan](PHASED_PLAN.md) for sequencing and release evidence.

### Board and piece theme for Phase 0

The default uses the silver and graphite board in the [visual reference](reference/metal-board-and-pieces.png). The large actual board, spotlight miniature, analysis board and control-room preview share the same SVG renderer. The compact board softens the grain and sheen, omits plate fasteners and increases coordinate type size.

| Layer | Full board | Small actual board |
|---|---|---|
| Light squares | Brushed silver with fine vertical grain and a soft variation in brightness across the plate. Use a thin seam and discreet circular fasteners just inside the corners. | Flatten the brightness variation and omit fasteners if they interfere with coordinates or appear as isolated specks. |
| Dark squares | Mid-to-dark graphite with low-contrast diagonal brushing. Keep enough separation between graphite and a black pawn to read the pawn’s head and base. | Reduce the grain contrast. Square colours alone must preserve the checkerboard pattern. |
| Pieces | Use one locally bundled, consistently scaled vector set. White pieces have solid white interiors and heavy dark contours. Black silhouettes have light internal cuts to distinguish the crown, mitre, mane and rook battlements. Centre the pieces with a clear margin on all sides. | Keep contours and defining details legible when a square becomes approximately 35 px wide in a 720p preview. |
| Last move | Tint both the departure and arrival squares muted blue-grey. Preserve the difference in brightness between a highlighted light square and a highlighted dark square. | Draw the highlight below the pieces. Keep both endpoints visible when one square is empty. |
| Coordinates | Set files along the bottom edge and ranks along the left. Use dark ink on silver and light ink on graphite. Recheck contrast over the tint. | Reserve an inset clear of seams and fasteners. Coordinates must stay clear of adjacent corners and pieces. |

**Rendering.** Extend the existing SVG board in `src/client/board.ts`. Its 800-unit view box already places eight 100-unit cells on each axis. Reuse that geometry and each board’s existing `BoardFrame` for piece positions and the two highlight squares. Layer square bases, static textures, highlights, pieces and coordinates in that order. Use role-specific IDs for definitions when actual and analysis SVGs share a page. A local SVG pattern or a small repeatable local image is sufficient for grain. Keep its origin fixed between snapshots so an idle position remains visually still. Ship original or appropriately licensed local artwork and retain its attribution when required.

**Piece renderer.** The renderer maps the existing `BoardFrame.pieces` entries (side, type and square) to original paths in [pieces.ts](../src/client/pieces.ts) with a shared 100 × 100 square, optical baseline and side bearings. The paths were drawn for this repository using the opening screenshot as a visual reference. White and Black use the same silhouette landmarks, with colour-specific outlines and internal details. Reuse the set on both boards and in the operator preview. Font availability must have no effect on the set’s appearance. Keep the accessible board label, FEN and last-move highlights independent of artwork. The [Phase 0 piece table](PHASED_PLAN.md#0-metal-board-and-matching-chess-pieces) describes the six silhouettes and the required 24-sample comparison.

**A36 review evidence.** Capture a populated position that includes all six piece types and a sparse position with visible source and destination squares. Include the 768 px actual board, the 416 px actual board and the 768 px analysis board across captures at 1920 × 1080 and 1280 × 720. During playback, the actual board retains its last played move while the analysis board highlights each hypothetical ply. On a played-move interruption, the actual pieces show the new position on the first eligible frame. The tint follows the animated return and appears immediately on a direct cut. Inspect a scaled capture for coordinate and piece legibility. At the OBS rehearsal, inspect a short 30 fps recording for grain shimmer or blocking on static squares; reduce texture contrast or simplify the small board if either appears. Browser screenshots provide the review evidence for Phase 0 and the encoded recording belongs to the broadcast sign-off phase.

## Derived panels

* **Comparison.** Show up to three supplied candidates per engine with their own depth, preferred move, PV and source statistics. Normalise verified Stockfish pawn scores to White's perspective. Keep mate, bound and tablebase types distinct. Preserve Leela's native units. Promote agreement only for stable choices at the identical verified root.
* **Outcomes.** Validate tuple range, total, orientation and root versus candidate scope. For verified side-to-move tuples on Black's turn swap wins and losses. Convert to White win, Draw and Black win percentages, retaining precision and using largest-remainder rounding with fixed tie order. Label conditional estimates with their candidate move. Unknown calibration precludes claims about the players' personal odds. Search share requires a verified denominator and retains any undisplayed remainder.
* **Time investment.** Prefer recorded elapsed move time. Otherwise compute previous same-player post-move clock + increment + period bonus + signed adjustment − new clock. Require known conventions. Record gaps for missing anchors and investigate negative durations. Delay time controls require elapsed evidence. Plot completed-move totals and optional paired per-move bars. Label partial coverage with the starting move. Project only the verified running clock from an on-air anchor and stop extrapolation on transport uncertainty.
* **History.** Align separate Stockfish pawn and Leela WDL charts by ply. Freeze the last eligible sample before the next actual move, preserve age and gaps, and keep retrospective analysis in a separate series.
* **Played notation.** Use released game history for the lower strip. Show recent full-move numbers with SAN in chronological order. Pair White and Black plies and leave an unplayed reply empty. Highlight the newest accepted ply. On a correction replace the affected suffix. A spotlight advances only its separate PV rail.
* **Optional editorial profile (later).** Start disabled. An explicit producer choice may replace the lower strip with reviewed entries. Store source, category, review state, binding, priority, applicability window and expiry. Recheck eligibility at presentation time after pins, corrections or game changes. An 18-second dwell applies only in this optional mode.
* **Later context.** Database departure requires a named and versioned corpus, filters, transposition policy, exclusion of the current game and a complete query. A timeout suppresses the claim. For choice matches, freeze an already displayed choice at least five seconds before the earlier of verified occurrence and first trusted arrival. With arrival evidence alone label it “Earlier displayed choice”. Omit when chronology is insufficient.

### From field to graphic

Use the server snapshot as the only input to the programme. These bindings express the product contract; production adapters must additionally verify provider units, event identity and time conventions.

| Display | Binding or derivation | Missing, invalid or stale input |
|---|---|---|
| Game identification and clocks | Released game metadata and clock anchors. Use fixed-width digits and a non-colour turn indicator. Both clocks belong to the actual game through every layout. | Preserve the last trusted board on interruption. Freeze uncertain clocks and show one connection state. A zero clock alone cannot create a result. |
| Last move and move strip | Use the accepted move label and ordered mainline SAN. Pair by the move number and side to move at the initial position; custom FEN starts can begin on a Black ply. | At the start, omit the last-move value. A missing turn history does not justify filling a gap from the engine PV. |
| Engine comparison | In each named source sheet display ranked legal root choices, their own supplied depths and a short continuation. Expose a bound or mate as its own typed value. | A missing depth leaves that statistic absent; an illegal line is ineligible. On a root change clear scores and rows together. Leave surviving source data visible. |
| Outcome estimates | Carry values with scale, perspective, scope and calibration in the adapter. Normalize before formatting. If conditional, identify the candidate in SAN. | Omit a tuple with missing fields, unknown scale, incompatible scope or wrong root. A verified zero remains 0%. A partial tuple never becomes a bar. |
| Variation spotlight | Render the saved frame sequence against its exact released root. Identify the source and active ply on the rail. The analysis label travels with that board. | If the line is invalid or too short, keep the actual board large. Superseding moves invalidate all frames even during an entrance animation. |
| Depth, work and graphs | Preserve source units in the typed field. Display search work as nodes or visits only when the adapter has established that meaning. Time uses minutes or seconds consistently on a labelled axis. | A work counter without a verified unit can still drive source-specific readiness if known to advance; omit its numeric display. Gaps in history stay gaps. |

### Fixture acceptance sequence

1. Load the fixture after 9…h6. Confirm White to move, two actual clocks and a large actual board. For Leela's synthetic root tuple of 300 / 500 / 200 per thousand, the three displayed values are 30%, 50% and 20%. Keep calibration metadata in the operator view or fixture contract.
2. Cue the variation or wait to the 75 s fixture mark. Hold the actual position and move list fixed. Step a PV frame and check that only the separate analysis position and its active move advance.
3. Release 10.d4 during the variation. The board, side to move, clock ownership and notation must update together. Remove all prior-root candidate scores, arrows and WDL. Keep each source pending until its first matching revision. Stockfish returns at 90 seconds and Leela at 96 seconds.
4. Open a second viewer and reconnect one viewer after the move. Both converge on the released position and keep the earlier PV cleared. Under reduced motion the transition is a cut. A transport interruption freezes uncertain clocks regardless of the selected scene.
5. Capture at 1080p and 720p. Inspect the broadcast raster, including the small board, time digits, full SAN tokens and percentage labels. A node, overlay or footer may not contain cue instructions, branded slogans, historical trivia or prose describing the scene director in the standard profile. A test may inspect visible semantic regions rather than counting words or outlawing player names.

## Operator interface and recovery

Serve read-only /programme and its on-air snapshot/event stream separately from protected /operator and its raw diagnostics. A programme snapshot carries sequence, presentation timestamp, game key, clock anchors, scene and eligible game / analysis fields. Existing clients can ignore legacy editorial fields. Subscribe from its cursor or resnapshot on a gap. Keep secrets out of URLs. Bind controls locally by default. For remote operation authenticate writes, validate command payload and expected game revision, reject duplicate command IDs idempotently and log decisions.

Expose event binding, time control, schedule, automatic direction, return to live, eligible spotlight, pin, HOLD, appearance, cadence and optional editorial queue in an explicitly enabled later profile. Show delayed preview beside a distinctly labelled raw monitor. Validate imported profiles before atomic activation, including the total playback budget. Reject invalid changes without disrupting the active profile.

Track transport activity, actual moves and substantive engine progress separately. One failed engine loses its arrows and agreement claims while the other remains visible. The source cell can show “Updating” or “Unavailable”. The operator sees the precise mismatch and both root keys. Loss of move authority retains the last confirmed board, labels interruption and age, freezes uncertain clocks and stops autoplay. A healthy twenty-minute think is ordinary play. Configure idle budgets per protocol (initial Leela candidate 75 s), and reconcile a full snapshot after reconnect. Only authoritative or explicit operator confirmation ends a game.

## Delivery and verification

Use recorded provider payloads, an injectable presentation clock and deterministic event ordering. Replay identical input twice and compare snapshots and scene decisions. Capture the programme at every transition, including the interval between upstream arrival and delayed release.

| Gate | Evidence |
|---|---|
| Phase 0 — board theme | A36. Compare the metal board across both scene roles, sizes and viewport resolutions. Verify the two boards have independent last-move highlights. Include the texture in Phase 6 encoded capture. |
| M0 — validate feeds | Capture current Sesse full/delta and Leela socket traffic. Verify event binding, WDL and candidate semantics, timing conventions and provider usage terms. Unknown Leela semantics block dual-engine launch. |
| M1 — reliable live view | A02–04, A07–09, A14, A17–25. Inject a late engine, repeated patch, wrong history, lost base, correction, disconnect, result, refresh and restart. Inspect every delayed output surface. |
| M2 — dynamic programme | A01, A05–06, A10, A24–27. Interrupt at each spotlight phase, including a pinned layout. Exercise castling, promotion and en passant. Have five viewers independently identify the actual board, turn and hypothetical status within five seconds. |
| M3 — complete P0 | A11–13 and A26–28 plus regression of all P0 cases. Verify 600→580 s with 30 s increment gives 50 s used and 100→1870 s with 1800 s bonus gives 30 s. Run eight hours without intervention and inspect memory, clock drift and repeated alerts. |
| Standard programme contract | A29–35. Compare both viewport sizes, reduced motion, rapid interruption, missing WDL versus zero, root changes and the words visible on the captured programme. |
| M4 — richer context | A15–16. Test incomplete corpus, transpositions, insufficient chronology and post-move analysis with immutable historical evidence. P2 audience voting and tactical explainers remain future work. |

For OBS rehearsal use a 1920 × 1080 Browser Source at 30 fps with refresh-on-activation and shutdown-when-hidden disabled. Inspect at 1080p and downscaled 720p. Measure release-to-paint latency, scene transition latency (target one second), journal growth and dropped frames. Investigate above 1% frame loss across ten minutes of mixed scenes. Include an eight-hour recorded match, a provider changing events during a break and a browser restart while future moves are buffered. Mark all fixture broadcasts REPLAY or DEMO throughout.
