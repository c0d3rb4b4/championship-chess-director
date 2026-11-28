# G2 · Follow the selected game

## Review captures

These captures use an original four-ply fixture behind the normal server. They show the game selected in the operator, with its current player colours, actual move and final board. The two clips cover the first released move and a result arriving with the final move while both engines are unavailable.

| Programme state | 1920 × 1080 | 1280 × 720 |
|---|---|---|
| After 1.e4, with a late root-matched Stockfish line | [Live board](live-1080.jpg) | [Live board](live-720.jpg) |
| Confirmed draw after 2…Nc6 | [Final board](result-1080.jpg) | [Final board](result-720.jpg) |

[Waiting to first move · MP4](first-move-720p.mp4) · [Live board to confirmed result · MP4](confirmed-result-720p.mp4)

The PR/main screenshot job runs both delay scenarios and uploads the stills, 720p MP4s and paint measurements. The board uses Black above and White below. Federation flags follow the selected player's FIDE identity. [Gukesh](https://ratings.fide.com/profile/46616543) · [Sindarov](https://ratings.fide.com/profile/14205483)

## Local upstream verification

The browser scenarios drive the operator selector, two programme windows and its embedded preview, using real HTTP, SSE and SQLite and an injected server clock. At D=0 and D=60 seconds they cover empty PGN, first move, a late legal engine line, mid-game refresh, several moves, authority loss, a corrected suffix, final move with result and a subsequent result withdrawal. The 60-second run checks each prior state one millisecond before eligibility and restarts the same server with the result pending. Raw health in the control room can update ahead of its broadcast preview.

Each viewer uses a separate foreground Chromium process, and the test verifies document visibility on all three surfaces. The first board's paint measurement includes two animation frames after the DOM updates on each surface. At zero delay the measurement starts with the local authority response. With delay it starts at the eligibility tick. The test enforces a 500 ms ceiling for every surface. The locally inspected capture run measured 232/190/208 ms for 1080p, 720p and preview at zero delay, and 84/58/68 ms at 60 seconds. The artifact contains per-run values in `g2/paint-D0.json` and `g2/paint-D60.json`.

Node tests also exercise an explicit zero-ply result, conservative cold archive release, revalidation of a cached result, locked delay across restart and Leela chapter/colour/FEN binding with stale socket rejection. Accepted mainlines have a correction revision. Engine observations refer to a specific authority journal row, so replacing a suffix or result invalidates its previous analysis.

## Deployed source observations

On 28 November 2026 at 12:38:55 UTC, the built server selected Game 4 from the deployed Lichess chapter. It accepted zero plies and an open result and displayed the waiting slate. In the same process, selecting Game 3 returned a confirmed draw after 120 plies ending 60…Kf3. Its displayed board matched the verified final FEN. The deployed source observations remain private.

Game 4 was scheduled for 14:00 UTC. This smoke check establishes pre-play and archive behaviour. Live move latency, clocks against the broadcast, both engines on consecutive in-play roots, the Game 4 Sesse mapping, Leela field calibration, rights and required delay, encoded OBS output and the long rehearsal still need sign-off. See [provider checks](../../PROVIDER_CONTRACTS.md) and [the game-day plan](../../GAME_DAY_PLAN.md#implementation-phases).
