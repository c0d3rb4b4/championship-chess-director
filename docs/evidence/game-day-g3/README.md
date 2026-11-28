# G3 · Replay and statistics for finished games

## Fixture review

The browser scenario takes a completed archive and a live game through `/operator`. Two programme windows and the embedded preview follow one release clock over HTTP and SSE. The pictures use an original test position with castling, captures and promotions. The same scenario checks a cold take, a full loop, refresh and restart during replay, switching games, reduced motion, a withdrawn result, a 60-second delayed result and an explicit zero-ply result.

Open the **Provider simulation screenshots** run under [PR #22 checks](https://github.com/c0d3rb4b4/championship-chess-director/pull/22/checks), then download the commit-labelled artifact. The G3 stills are in `g3/`.

| Programme page | 1920 × 1080 | 1280 × 720 |
|---|---|---|
| Final result | `result-1080.jpg` | `result-720.jpg` |
| Game in numbers | `numbers-1080.jpg` | `numbers-720.jpg` |
| Time used | `time-1080.jpg` | `time-720.jpg` |
| Evaluation history | `evaluation-1080.jpg` | `evaluation-720.jpg` |
| Replay · 2.bxa8=Q | `replay-1080.jpg` | `replay-720.jpg` |

The `videos/` folder contains `g3-result-to-recap-720p.mp4` and `g3-replay-to-result-720p.mp4`.

The fixture records three moves and two captures per side. White has 12 seconds over two of three moves and Black has 43 seconds over all three. A missing duration breaks the line. A recorded zero counts as timed. A matching Stockfish observation appears at its actual ply. The Node tests additionally cover two separately scaled series, a final-root-only sample, en passant from a Black-to-move FEN, an obsolete score after a correction, and FEN, SAN, mover and highlighted squares at every replay frame.

The conclusion holds for 30 seconds. Game in numbers runs for 12 seconds and each eligible chart runs for 15 seconds. Replay holds the start for two seconds, advances one ply every two seconds and holds the final frame for four seconds. The delay journal preserves the result anchor across process restarts. A fresh result or corrected mainline starts a new conclusion at its eligible release.

## Private deployed archive check

On 28 November 2026 at 13:42:54 UTC the normal server took Game 3 from Lichess round `fnmEB1kH` and chapter `RD8sbYw1`. Javokhir Sindarov was White and Gukesh D was Black. The bound PGN reported a draw after 60…Kf3. The rundown recorded 60 moves per side, 11 White captures and 12 Black captures. A private check advanced the presentation clock through all 121 frames, matched each replay FEN and SAN, verified the final FEN and returned to the result. Raw feed data stays private.

The Game 3 archive did not supply a verified elapsed-time or historical engine series for this session. The archive loop selected Final result, Game in numbers and Replay. The schedule for Game 4 came from the catalogue. The match score needs released results for all earlier rounds of the matchup.

Production in-play delay and clock comparison, shared-root engine coverage, Game 4 Sesse mapping, Leela WDL calibration, rights and required delay, encoded OBS output and the long rehearsal remain open. See [provider checks](../../PROVIDER_CONTRACTS.md) and [the game-day plan](../../GAME_DAY_PLAN.md#implementation-phases).
