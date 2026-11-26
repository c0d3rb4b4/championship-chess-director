# Synthetic fixture contract

These are hand-authored `synthetic-demo-v1` inputs, **not captured provider wire payloads**. No network request is made to Sesse or Leela. Player names and engine numbers are illustrative. This does not pass the production M0 feed-validation gate.

Both fixtures include the full standard-start move history and a bound game ID. The server replays every actual and candidate move with chess.js and derives the complete root key from the initial FEN, ordered UCI history, resulting FEN, game epoch and revision. Candidates retain their own depth. Three advancing work samples across six seconds establish demonstration readiness; repeated versions do not count.

Sesse uses a typed White-oriented pawn score. Leela explicitly declares a synthetic root WDL, White perspective, per-thousand scale: 300/500/200 is shown as 30%/50%/20%. It is an illustrative engine estimate, not calibrated odds for the players. No candidate search shares or combined engine score are invented.

Timeline: 0 s White thinking; 0/3/6 s substantive engine revisions; 75 s frozen Stockfish spotlight; 77/79/81 s three hypothetical plies; 83 s authoritative DEMO move `10.d4` takes priority over the next playback deadline; 89 s move emphasis ends. The actual game remains at ply 18 throughout the hypothetical line. After the real move both engines are marked “Updating for this position”. The sequence ends on the new board and does not loop silently.

## Change a fixture without breaking its meaning

| Input | Example | Downstream check |
|---|---|---|
| `demo-game.json` | Eighteen plies through `9...h6`; `realMove.san` is `d4` | Replay the entire move sequence. Both providers must bind the same `gameId` and `rootMoves`. A PV can never append to the actual history. |
| `sesse.json` | White-oriented `pawns` value `0.35` | Render the sign and two decimal places. Candidate depths 31, 27 and 25 belong to three separate rows. |
| `leela.json` | `scope=root`, `perspective=white`, `scale=1000` | Label each outcome. The three values cover the current fixture position; the first candidate’s search allocation would be a different statistic. |
| Both `revisions` lists | Three samples at 0, 3 and 6 seconds | The increasing version and work counters establish readiness within this fixture. Repeated samples are insufficient. |

To rehearse a different opening, edit the mainline and both root histories together. Supply legal continuations at that position, check both clocks and change the interruption deadlines in the tests if the scenario calls for different timing. An edited fixture is still synthetic. Production captures, their provenance and their protocol versions belong to the adapter validation phase.

The current replay starts at the standard initial position. The post-move White anchor is 3,127,000 ms: 3,180,000 ms initial time minus an 83-second think plus the 30-second increment. Playback of the engine line consumes none of either player’s recorded time.
