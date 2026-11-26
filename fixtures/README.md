# Synthetic fixture contract

These are hand-authored `synthetic-demo-v1` inputs, **not captured provider wire payloads**. No network request is made to Sesse or Leela. Player names and engine numbers are illustrative. This does not pass the production M0 feed-validation gate.

Both fixtures include the full standard-start move history and a bound game ID. The server replays every actual and candidate move with chess.js and derives the complete root key from the initial FEN, ordered UCI history, resulting FEN, game epoch and revision. Candidates retain their own depth. Three advancing work samples across six seconds establish demonstration readiness; repeated versions do not count.

Sesse uses a typed White-oriented pawn score. Leela explicitly declares a synthetic root WDL, White perspective, per-thousand scale: 300/500/200 is shown as 30%/50%/20%. It is an illustrative engine estimate, not calibrated odds for the players. No candidate search shares or combined engine score are invented.

## Rehearsal timeline

Times use the shared presentation clock. Each row gives the actual position after the event.

| Seconds | Ply | Turn | Last actual move | Programme |
| --- | --- | --- | --- | --- |
| 0 / 3 / 6 | 18 | White | 9...h6 | Both sources advance. WDL is 30 / 50 / 20%. |
| 75 / 77 / 79 / 81 | 18 | White | 9...h6 | Spotlight holds its root, then plays three hypothetical plies. |
| 83 | 19 | Black | 10.d4 | Real move preempts the next PV frame. Both sources clear immediately. |
| 89 | 19 | Black | 10.d4 | Six-second emphasis ends. |
| 90 | 19 | Black | 10.d4 | Stockfish returns at +0.18 pawns. Leela stays pending. |
| 92 | 19 | Black | 10.d4 | Late Leela revision for ply 18 has no visible effect. |
| 93 | 19 | Black | 10.d4 | Second Stockfish sample. |
| 96 | 19 | Black | 10.d4 | Stockfish settles. First matching Leela sample gives 26 / 54 / 20%. |
| 99 / 102 | 19 | Black | 10.d4 | Leela advances, then settles. |
| 110 / 116 | 20 | White | 10...exd4 | Both sheets clear. Move emphasis ends six seconds later. |

Black thinks for 27 seconds and receives a 30-second increment. At the reply the clock anchors are White 3,127,000 ms and Black 4,863,000 ms. White's clock runs from there.

## Change a fixture without breaking its meaning

| Input | Example | Downstream check |
|---|---|---|
| `demo-game.json` | Eighteen plies through `9...h6`; `events[0].san` is `d4` | Replay the entire move sequence. Each provider position must bind the game and its complete accepted history. A PV can never append to the actual history. |
| `sesse.json` | White-oriented `pawns` value `0.35` | Render the sign and two decimal places. Candidate depths 31, 27 and 25 belong to three separate rows. |
| `leela.json` | `scope=root`, `perspective=white`, `scale=1000` | Label each outcome. The three values cover the current fixture position; the first candidate’s search allocation would be a different statistic. |
| Both `revisions` lists | Three samples at 0, 3 and 6 seconds | The increasing version and work counters establish readiness within this fixture. Repeated samples are insufficient. |

To rehearse a different opening, edit the mainline and both root histories together. Supply legal continuations at that position, check both clocks and change the interruption deadlines in the tests if the scenario calls for different timing. An edited fixture is still synthetic. Production captures, their provenance and their protocol versions belong to the adapter validation phase.

The current replay starts at the standard initial position. The post-move White anchor is 3,127,000 ms: 3,180,000 ms initial time minus an 83-second think plus the 30-second increment. Playback of the engine line consumes none of either player’s recorded time.

## Phase 2 statistics rehearsal

The initial comparison runs from 0–20 s, Leela outcomes from 20–38 s, time investment from 38–58 s and search from 58–74 s. History appears at 74 s, followed by the existing variation cue at 75 s. At 156 s the history panel contains two frozen positions and a gap at Black’s reply.

All work counters are synthetic. Stockfish reports nodes and Leela reports visits. The repeated Leela packet at 1.5 s carries no new work. At 6 s the displayed candidates account for 68,400 of 95,000 visits. The remaining 26,600 appear as Other (28%). The second root supplies a side-to-move tuple on Black’s turn.

The clock records are the mover’s post-move readings in milliseconds, including any increment, period addition and signed clock adjustment. Missing readings interrupt that player’s series. The initial partial history supports completed durations beginning at move 6. Historical points retain source observation time and version, position identity, game revision and the cutoff used for analysis age.
