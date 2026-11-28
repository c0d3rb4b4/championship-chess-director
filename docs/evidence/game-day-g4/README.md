# G4 waiting programme review

From `/operator`, take a verified future round. The selected game and countdown appear on the right. The latest earlier completed game with an eligible result plays its mainline on the left, under a persistent **REPLAY** label. Its player rows follow its own colours. At zero, a healthy zero-ply feed reads **Awaiting first move**. When the first move releases, one update replaces the replay with the actual board. Refreshed viewers and the same-port server restart join the shared replay cursor. The reduced-motion output cuts directly to the actual board.

## Deterministic verification

The Playwright scenario drives two programme windows and the operator iframe through the actual selector, HTTP, SQLite and SSE. The upstream uses an original four-ply composition with the real round identities and opposite colours. It exercises two consecutive verified replay frames and SAN, countdown zero, Game 1, an unknown start, rescheduling, a restart with a pending reschedule, and a switch away during replay. Archive facts and a reschedule wait for release at a 60-second delay. The first move takes precedence over a replay deadline, paints the actual board on all three surfaces within 500 ms, and fires one opening transition where motion is enabled.

The Node tests cover an illegal archive, a newer open record, the newest earlier completed game changing, a confirmed result with zero moves and a late archive response after a switch.

## Capture files

Find these under `g4/` and `videos/` in the commit-labelled Provider simulation screenshots artifact attached to the PR checks.

| Evidence | File |
|---|---|
| Game 4 countdown with Game 3's opposite colours and consecutive replay plies | `g4/waiting-ply-{1,2}-{1080,720}.jpg` |
| Countdown zero, reschedule and opening move | `g4/{awaiting-first-move,rescheduled,first-move}-{1080,720}.jpg` |
| Game 1 without a predecessor and an unknown start | `g4/{game-1-no-predecessor,unknown-start}-{1080,720}.jpg` |
| Operator preview | `g4/operator-1080.jpg` |
| Silent full-frame 720p clips | `videos/g4-countdown-zero-720p.mp4` and `videos/g4-opening-takeover-720p.mp4` |
| Release-to-paint timing on both viewers and the iframe | `g4/paint-D{0,60}.json` |

## Private Lichess check · 28 November 2026 UTC

At 14:16:17 the normal server accepted Game 4 in progress with nine plies and last SAN `Be2` from the bound chapter. At 14:16:20, taking the scheduled Game 5 showed its verified 29 November 14:00 UTC start and replayed completed Game 3 from the initial position to `1.e4`. The archive showed the draw and the correct White Sindarov and Black Gukesh rows. Game 4 was still open and was skipped as an archive. This check used the running programme API and kept the provider payload private.

Game 4's opening had already happened. The countdown-to-live takeover measurement comes from fixtures. Production clock and common-root engine verification, provider rights and delay, OBS encoding and the long rehearsal remain open.
