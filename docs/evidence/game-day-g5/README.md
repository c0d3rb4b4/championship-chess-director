# Match-day rehearsal

## Private rehearsal

Use the **Provider simulation screenshots** check on this PR or its merge commit. Download the artifact named for the tested Git SHA and open `MATCH-DAY.md`. It links both sizes of each scene, three silent 720p clips, and the per-viewer timing measurements. The PR check tests GitHub's merge revision. The push check tests the resulting commit on main. Retention is 30 days.

| Acceptance case | Evidence from the deterministic run |
|---|---|
| A producer takes a game | Two programme windows and the operator's embedded preview use the production selector, SQLite journal, HTTP and SSE. The finished-rundown scenario first takes a completed game cold, then follows the next round from its previous-game replay through the first move, result, all eligible statistics and selected-game replay. |
| Replay identity and history | Opening takeover replaces the previous game’s board and colours. The composed endgame has castling, captures and promotions. Each replay ply is checked against its legal FEN and SAN. Node checks also compare mover and tinted squares. Restarting on the next loop reconstructs the same page order, result, statistics and replay frame from SQLite. |
| Delayed release | At D=0 and D=60 the capture suite measures the opening and the PGN containing the final move and result. At D=60 the old position stays on all three surfaces one millisecond before eligibility. Paint is sampled after two animation frames on each foreground surface. The restarted server reconnects viewers while the result is still buffered. The limit is 500 ms for connected viewers. |
| Recovery | Scenarios include both engines missing, late matching analysis, authority interruption, changed move, result withdrawal, refresh and server restart mid-replay, and switching away while a replay is running. A fresh selection fences the prior game. |
| Broadcast graphics | The index checks 1080p and 720p files for the waiting layouts with and without a predecessor, live board, conclusion, move totals, time used, evaluation history and mid-replay. It also checks the silent 720p opening, final-move/result and result-to-recap encodes. Reduced motion, game labels, player colours and graph origins have dedicated browser assertions. |

The tests inject original scores and engine packets at the upstream boundary. The normal server configuration continues to use the selected real source. See the [operator runbook](../../../README.md#match-day-runbook) for the setup and release decisions.

## Private live-feed observations · 28 November 2026 UTC

A separate loopback server started with an empty database, the checked-in catalogue, zero added delay and the deployed transports. The producer took both rounds through the selector. A programme window and the preview agreed.

| Source | Observed | Still to verify |
|---|---|---|
| Lichess move authority | Game 4 read at 14:45:56 UTC. Round `wIwJtPqz`, chapter `IriXvwPw` passed binding. Gukesh D (White) v Javokhir Sindarov (Black), underway after 7…Be6, 14 plies, open result. Game 3 read at 14:45:57 UTC. Round `fnmEB1kH`, chapter `RD8sbYw1` opened directly on the confirmed draw after 60…Kf3, 120 plies. | Opening and result arrival latency in play, clock convention against an independent broadcast reference, live redistribution terms. |
| Sesse | The Game 4 control room reported **Round mapping unverified** during the 14:45 UTC take. Game 3 has a previously verified archive mapping. | Verify Game 4 names, colour and root, then collect substantive in-play deltas, reconnect and confirm usage and credit. |
| Leela Live | At 14:45:57 UTC Game 4 reported **Awaiting matching analysis**. No matching evaluation was verified in this sample. | Collect consecutive bound live roots, partial updates and recovery. Verify WDL calibration and visit accounting. Confirm automated access and raw-data terms. |
| FIDE schedule and pairing | The rehearsal used the catalogue's existing verified schedule and pairings. | Recheck changes against FIDE before a take. Confirm coverage permission and required programme delay with the rights holder. |

## Public broadcast readiness

Public broadcast sign-off is **open**. The [provider contracts](../../PROVIDER_CONTRACTS.md#provider-terms-and-attribution) track attribution and permission by source. Keep raw observations private. Rehearsal media is generated solely from fixtures.

| Original gate | Status after G5 | Evidence still required |
|---|---|---|
| M0 · Validate providers | Partial. A deployed authority take and cold archive are verified. | Shared-root in-play capture and repeat replay for both engines, clock and Leela field audits, permissions. |
| M1 · Release live state | Partial. Game-day tests cover released board, journals, delays, revisions and recovery on all three surfaces. | Original delayed live analysis/spotlight boundary checks with verified provider observations, clocks and missing-buffer recovery on the production setup. |
| M2 · Generalise direction and operations | Partial. Game selection, conclusion, recap and interval run on the shared timeline. | Full classical-game direction, clock pressure, repeated long thinks, validated profiles and HOLD/resume controls. |
| M3 · Production host | Open. Browser stills, timings and transition clips are available for review. | Ten-minute 1080p30 OBS encode with dropped-frame and 720p inspection, eight-hour full-game soak with resource and clock measurements, five-viewer/five-second comprehension check. |

After G5 merges, the game-day phase table is complete. The earliest unfinished original milestone is M0. Follow the [production sign-off criteria](../../PHASED_PLAN.md#6-sign-off-on-the-production-host) for broadcast release.
