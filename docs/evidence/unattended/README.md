# Unattended programme rehearsal

Take a championship round in `/operator`, leave `/programme` open, then close the control room. The server keeps polling, releasing positions and directing scenes. A returning operator joins the same variation ply as OBS.

## Repeatable checks

The **Provider simulation screenshots** workflow runs on PRs into main and on the merge. Download the artifact named for the tested SHA and open `MATCH-DAY.md`. It links the 1080p and 720p comparison, game totals and spotlight stills, the four silent rotation, entrance, return and interrupt MP4s, and per-surface release measurements.

| Scenario | Check |
|---|---|
| One take | Actual HTTP selector and embedded preview, SQLite and SSE. Close the operator during PGN-only, Sesse-only, Leela-only and dual-engine runs. Two viewers follow eligible panels. Reopen mid-line and refresh a viewer. |
| Release deadline | Eleven cases at D=0 and D=60. Release during move emphasis, each of seven panels, spotlight entrance, PV playback and exit. Inspect the old position just before eligibility. Check first correct FEN, turn, played SAN, stale analysis, move tint and automatic resumption on two foreground Chromium viewers and the preview. `interrupt-D0.json` and `interrupt-D60.json` report milliseconds from advancing the eligible server clock to two animation frames after the correct board. |
| Recovery and overrides | Cover pin then move, invalid cadence, duplicate commands, HOLD during new data, restart in HOLD, delay refill, missing journal row, skipped observation interval and restart during buffered PV playback. The existing game-day suites cover correction, result withdrawal, switch, result arriving with a move and deterministic finished-game replay. |
| Endurance | `npm run test:endurance` runs the same eight hours of fixture time twice. The trace covers a classical game, rapid play, provider outage, restart, result, replay and a between-games interval. The report records elapsed wall time, scene durations, minimum rolling five-minute large-board share, clock error against accepted PGN anchors, SQLite/WAL sizes, journal rows, process RSS and socket generations. The scene, position and statistics digests must agree. Use `npm run test:endurance -- --elapsed` for a wall-paced eight-hour rehearsal. |

All published media use original fixture traffic at the upstream boundary. The accelerated endurance run does not measure OBS or eight hours of elapsed host time.

## Deployed Game 4 observations · 28 November 2026 UTC

| Check | Observation |
|---|---|
| Private recording | 15:26–15:33 UTC. 374 packets, 372 normalised observations per replay, two identical replays. Lichess chapter `IriXvwPw`, Sesse and Leela game 484 all matched White Gukesh D and Black Javokhir Sindarov after **11.a4**. Sesse preserved the FEN en-passant target after the double push. The adapter accepts that spelling only when the legal mainline proves it. |
| Shared move and recovery | 15:35:59–15:42:36 UTC. Both engines matched the 21-ply root and the next root after **11…b6**. The 392 packets included advancing work, Sesse full and delta responses, Leela subscriptions and separately induced disconnect/recovery for all three transports. Recovery from the recorded gap took 26.0 s for Lichess, 1.3 s for Sesse and 11.3 s for Leela. The second recorder was interrupted before its JSON footer. The replay envelope used all 392 complete packet records and the unique game ID from its subscriptions. Both runs emitted the same 372 observations, SHA-256 `1c06248c7460807c7941e9358a7a61885a8c933629bf7594b428e51861cbed21`. |
| Normal programme | 15:43–15:45 UTC. A separate server and fresh SQLite database used the checked-in round and actual transports. A browser took Game 4 once and closed `/operator`. The released board showed **11…b6**, White to move. Both engines matched. The programme cycled through comparison, search progress, evaluation history, notation and game totals. |
| Clocks and time | The PGN annotated 11.a4 with 1:19:54 and 11…b6 with 1:03:54. An independent broadcast-clock comparison at those moves and confirmation of the applied time control remain open. The championship binding withholds clocks, clock-derived time panels and clock-gated spotlights. No trusted elapsed-time annotation contract was enabled for this round. |
| Leela outcome and shares | The live deep position and per-candidate WDL were present. For evaluation 2805920 at ply 22, 20 named candidates accounted for 36,171,963 of 36,199,626 visits. The deployed per-game WDL calibration and same-evaluation partial-frame accounting against the serving client remain unverified. Production outcome percentages and visit shares stay disabled. The bound legal suggestions and named candidate work can air independently. |
| Sesse idle | Both live captures contained substantive work during the long think. An empty in-play delta was absent. The earlier archive and deterministic transport tests cover idle traffic. |

Raw provider captures and the production SQLite database stay private. Fixture permissions, private source observations and the rights to broadcast publicly are separate decisions.

## Broadcast sign-off

The producer tracks source terms, credit and required programme delay for the intended public stream. The production-host ten-minute OBS 1080p30 encode with frame-loss and scaled-picture review, wall-clock eight-hour host soak, and five-viewer/five-second comprehension check remain open. [G5 release record](../game-day-g5/README.md#public-broadcast-readiness)
