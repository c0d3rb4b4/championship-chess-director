# Finish the unattended live programme

**Take Game N to programme is the last routine operator action for that game.** From then on, the server chooses the picture for every viewer. A producer can close the operator tab. The countdown, previous-game replay, live graphics, engine variations, move interruptions, result and recap must still run. A completed game stays selected until the producer takes another round.

## Starting point after G5

[PR #24](https://github.com/c0d3rb4b4/championship-chess-director/pull/24) completed selection, waiting, live move delivery, finished-game replay and rehearsal. The G5 gap was **during play**. In that revision, `Broadcast.activate()` constructs `Director` for DEMO, while `realSnapshot()` has a waiting cursor and a finished recap cursor but no live scene cursor. The real renderer can show the last move and matching engine lines indefinitely. The demo demonstrates the intended pacing and motion. Its scripted moves, clocks and search samples belong only to rehearsal.

## What a viewer should see

| Trigger | Automatic programme behaviour |
|---|---|
| Take a round before play, join an ongoing round, or select a finished archive | Follow the existing game-day lifecycle. A mid-game join shows the latest eligible actual position. Every viewer, the operator preview and a refreshed OBS source join the same scene and variation ply. |
| Player is thinking | Keep the actual board large and rotate eligible graphics on the right. Carry over the ordinary cycle: comparison (20 s), Leela outcomes (18 s), completed-move time (20 s), search progress (16 s), evaluation history (20 s). A bound PGN alone supports played notation and a game-in-numbers panel with each side's moves and captures. Use these to give an authority-only game a meaningful cycle as soon as there are distinct facts to show. If only one view is supported, hold it. |
| A long think has a settled engine line | Automatically feature a legal line matched to the selected game, ply, FEN and history. Keep the compact actual board visible, with Black and White player rows, flags and verified clocks on their own sides. Ease both boards together without touching. A separate board labelled **ANALYSIS LINE NOT PLAYED** enters from the right and plays up to eight hypothetical plies at two seconds each. Alternate distinct eligible ideas across long thinks. |
| A played move becomes eligible during **any** live graphic, including entrance, playback, exit or another move emphasis | In one released update cancel superseded timers, reveal the new actual board, SAN, turn and available clock state, and clear old-position analysis. The first correct board paints within **500 ms of eligible release**. The faster return animation must expose the accepted position immediately. A simultaneous panel or PV tick loses. Use one transition, one notation entry and a direct cut on reduced motion or resnapshot. Emphasise the move for six seconds, then resume automatically. A newer move interrupts that emphasis. |
| Time pressure, rapid moves or missing data | Apply the existing long-think, cooldown, readiness and clock-pressure rules in the design. Use one eligible engine when the other is unavailable. Skip unsupported graphics. Keep graph axes anchored at move zero with gaps for missing observations, and separate Stockfish pawn units from Leela probabilities. A healthy long think keeps running. Authority loss freezes uncertain clocks and suspends hypothetical playback until a bound resnapshot. |
| The authority corrects the game or confirms a result | Discard superseded history and scene deadlines. A final move and result in one PGN produce one conclusion at the correct final position. Freeze clocks and run the existing 30-second conclusion, eligible recap pages and selected-game replay. A withdrawn result returns to the corrected live programme. |

The server owns scene selection and timing even when there are no clients. Keep added programme delay at its existing default of zero. For any configured delay, apply the same release rule to the board, analysis, clocks, panel exits and every viewer. The 500 ms target starts at eligibility on this timeline. Source transmission and polling latency are measured separately. An optional layout pin yields to a move. Explicit emergency HOLD is a producer override with a visible state and a deliberate resume.

## Software checkpoints

The [implementation PR](https://github.com/c0d3rb4b4/championship-chess-director/pull/26) covers all five checkpoints. The [original milestones](PHASED_PLAN.md#sequence-and-dependencies) track release evidence. External observations can stay open while independent engineering proceeds. Update the status and evidence here as work lands.

| Checkpoint | Software status | Implementation and proof |
|---|---|---|
| 1. Shared real-game cycle | Implemented | A single released scene drives every viewer and preview. The real renderer shares the demo board animation. PGN alone rotates played notation and game totals. Each engine, clock and history panel has its own data gate. |
| 2. Live analysis and clocks | Implemented with per-field production gates | Bound Sesse deltas and Leela subscriptions follow successive roots. Per-source work, legal PVs, typed scores, verified clock anchors, staged time controls and separately gated WDL/visit shares use the released journal. Both deployed engines matched Game 4 across 11.a4 and 11…b6. See the field-by-field record. |
| 3. Spotlights, interruptions and recovery | Implemented | Stable advancing search, verified history and healthy clocks gate a frozen legal variation. Real moves preempt every ordinary panel and all phases of playback. The 22-case matrix measures the 1080p, 720p and preview surfaces. |
| 4. Producer controls and persistence | Implemented | Automatic direction by default, optional pin, next, eligible variation, return, HOLD/resume and validated versioned cadence. Delay changes start a fresh buffer under HOLD. SQLite preserves scene deadlines, frozen lines, commands and per-ply evidence and detects missing journal coverage. |
| 5. Unattended regression and endurance | Implemented | The PR/main capture workflow exercises the normal routes and publishes stills, clips, paint measurements and two accelerated eight-hour replays with resource samples and a deterministic digest. |

[Rehearsal, private feed observations and remaining broadcast sign-off](evidence/unattended/README.md) · [Operator runbook](../README.md#match-day-runbook)

### Acceptance through the normal routes

1. Take a round once via `/operator`. Inject fixture traffic at the provider transport and use the real server, SQLite, HTTP and SSE. With two `/programme` windows and the preview, verify matching game, scene, board and ply. Close the operator, let several graphic changes and a spotlight happen unaided, then reopen it mid-scene. Repeat in authority-only, one-engine and both-engine conditions.
2. At zero and 60 seconds of delay, release a move during each ordinary panel, spotlight entrance, PV step and exit. Check one millisecond before eligibility for early disclosures, including an early panel exit. Measure first correct paint on all three connected surfaces, one interruption, and zero stale PV frames thereafter. Include rapid successive moves, a final move with its result, reduced motion, a corrected line and a restart mid-delay.
3. Run clean install, typecheck, build, Node and browser suites and provider captures. Inspect 1920 × 1080 and 1280 × 720 output. Publish commit-labelled stills and clips of ordinary rotation, spotlight entrance/return and interrupted graphics. Compare two replays of identical input for scene order, displayed positions and final totals.
4. Report software checks, deployed feed observations and production-host sign-off separately. The existing review record lists the OBS encode, viewer check and source confirmations. Missing external evidence leaves its specific field or sign-off open. Continue implementing and testing the rest of the programme.

[Technical design and timing](DESIGN.md) · [PRD](Live_Chess_Broadcast_UI_PRD.docx) · [Provider contracts](PROVIDER_CONTRACTS.md) · [Game-day release record](evidence/game-day-g5/README.md)

## One prompt for all remaining development

Paste this into a fresh project chat after the documentation PR merges. Reuse the same prompt to resume an open implementation PR.

```text
@GitHub Use c0d3rb4b4/championship-chess-director. Complete all remaining development in docs/AUTOMATED_PROGRAMME.md against current main. Read the repo instructions, design, PRD, provider contracts, original milestones and G1–G5 evidence. Inspect merged and open PRs. Reuse an existing implementation branch if present. Work through every unfinished software checkpoint in this run. If the table is implemented on main, report the verification and remaining external checks.

After one Take Game action in /operator, /programme must run unattended even with the operator tab closed. Cycle all eligible graphics from real released data, including useful PGN-only graphics when both engines are absent. Play settled engine lines automatically during long thinks. Every released live move interrupts any graphic or animation in one update, shows the correct actual board within 500 ms of eligibility, and resumes the cycle automatically. Follow the plan for delay, pressure, result, corrections, recovery and optional overrides. Keep demo explicit.

Implement and test through the normal routes. Run the plan’s acceptance matrix, inspect 1080p and 720p stills and clips, and verify CI. Attempt available live checks, keep private captures private, and report outstanding source or host evidence separately. Continue independent development when an external check is unavailable. Update the checkpoint table and runbook with evidence. Open or update one review-ready PR against main covering the remaining development. Return its link, test results, visual evidence and outstanding external checks. Leave merging to me.
```
