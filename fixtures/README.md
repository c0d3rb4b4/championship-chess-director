# Synthetic fixture contract

These are hand-authored `synthetic-demo-v1` inputs, **not captured provider wire payloads**. No network request is made to Sesse or Leela. Player names and engine numbers are illustrative. This does not pass the production M0 feed-validation gate.

Both fixtures include the full standard-start move history and a bound game ID. The server replays every actual and candidate move with chess.js and derives the complete root key from the initial FEN, ordered UCI history, resulting FEN, game epoch and revision. Candidates retain their own depth. Three advancing work samples across six seconds establish demonstration readiness; repeated versions do not count.

Sesse uses a typed White-oriented pawn score. Leela explicitly declares a synthetic root WDL, White perspective, per-thousand scale: 300/500/200 is shown as 30%/50%/20%. It is an illustrative engine estimate, not calibrated odds for the players. No candidate search shares or combined engine score are invented.

Timeline: 0 s White thinking; 0/3/6 s substantive engine revisions; 75 s frozen Stockfish spotlight; 77/79/81 s three hypothetical plies; 83 s authoritative DEMO move `10.d4` takes priority over the next playback deadline; 89 s move emphasis ends. The actual game remains at ply 18 throughout the hypothetical line. After the real move both engines are marked “Updating for this position”. The sequence ends on the new board and does not loop silently.
