# Phase 0 board and piece review

The programme and operator captures use synthetic game data. The starting-position and sparse-endgame cases supply review snapshots to the same programme renderer. The contact sheet uses the same piece paths, materials and compact styles.

| Capture | 1080p | 720p | What to inspect |
| --- | --- | --- | --- |
| Starting position | [1080p](programme-starting-1080.png) | [720p](programme-starting-720.png) | Full back ranks and pawn banks against the [opening reference](../reference/metal-board-and-pieces.png). |
| Opening, thinking | [1080p](programme-thinking-1080.png) | [720p](programme-thinking-720.png) | Full actual board after 9...h6. The h7 silver plate and h6 graphite plate both carry muted blue-grey tints. |
| Opening, spotlight | [1080p](programme-variation-1080.png) | [720p](programme-variation-720.png) | The nominal 416 px actual board holds 9...h6 while the nominal 768 px analysis board highlights d3–d4. Check the miniature’s softened grain and the two board labels. |
| Actual move released | [1080p](programme-interrupted-1080.png) | [720p](programme-interrupted-720.png) | Actual 10.d4, restored large board, removed variation and cleared old engine claims. The played strip gains one move. |
| Sparse endgame | [1080p](programme-endgame-1080.png) | [720p](programme-endgame-720.png) | Read c3–d5 without adjacent pieces and follow both sets of edge coordinates. |
| Sparse endgame, spotlight | [1080p](programme-endgame-spotlight-1080.png) | [720p](programme-endgame-spotlight-720.png) | Compact actual board holds Nd5 while the analysis board shows the legal rook reply b6–b1. |

[Piece comparison](metal-piece-comparison.png) shows each of twelve original vectors on both silver and graphite. The left grid gives 24 combinations at 96 px per square. The right repeats them at about 35 px per square. Compare the king’s cross, queen’s five points, bishop’s mitre and knight’s eye and mane at both sizes. The [operator capture](operator.png) shows the same artwork in the programme preview.

## Local verification

- **A01 and A30** — [The two-viewer interruption sample](interruption.json) measures the operator click through both DOM updates plus two animation frames against 500 ms. Node tests cover a coincident PV deadline and five release points. Browser tests cover spotlight interruption, refresh and reduced motion.
- **A27 and A29** — Reviewed both viewport sizes. Actual and hypothetical board labels, clocks and source labels remained legible. The browser checks board geometry and the absence of scrollbars.
- **A31** — The reduced-motion browser case verifies a clock tick without an entrance animation and an anchored clock strip across scene cuts.
- **A32 and A33** — Reviewed programme and operator content. Browser checks cover the connection warning and frozen clocks, a PV step and manual return with no played move, and one actual move across release and refresh.
- **A36** — Reviewed all 24 piece and plate combinations, full and compact opening and endgame views, edge coordinates and move tints on both plate colours. The browser checks that a PV step only changes the hypothetical tint and that the played move updates the actual tint.

Typecheck, build, 11 Node tests and 6 Playwright tests passed. The Node suite ran via `node --import tsx --test tests/*.test.ts` because the `tsx` CLI could not open its local IPC socket. Playwright used Chromium 158 because the bundled browser download was unavailable.

## Production checks

Live provider contracts and release timing remain for the live-feed phases. Phase 6 retains encoded OBS review for grain shimmer, dropped frames and production interruption timing, the full-game soak and the five-viewer comprehension check.

## Phase 1 analysis cycle

These captures follow the same programme viewer across the first move and both independent engine returns.

| Actual position | Programme state | 1080p | 720p |
| --- | --- | --- | --- |
| Ply 18 · White after 9...h6 | Stockfish +0.35 and Leela 30 / 50 / 20% | [Frame](programme-thinking-1080.png) | [Frame](programme-thinking-720.png) |
| Ply 19 · Black after 10.d4 | Both engines pending. The variation disappears and the move enters the played strip. | [Frame](programme-interrupted-1080.png) | [Frame](programme-interrupted-720.png) |
| Ply 19 · Black after 10.d4 | Stockfish +0.18 with legal Black candidates. Leela remains pending through its late ply-18 revision. | [Frame](programme-stockfish-return-1080.png) | [Frame](programme-stockfish-return-720.png) |
| Ply 19 · Black after 10.d4 | Leela returns with 26 / 54 / 20%. The actual position and running clock owner stay fixed. | [Frame](programme-both-return-1080.png) | [Frame](programme-both-return-720.png) |

The two-viewer browser rehearsal continues through 10...exd4 and the change to White's clock. The fake-clock test compares two complete replays one millisecond before, at and after each boundary, including the late ply-18 packet. See the [fixture guide](../../fixtures/README.md) for the time, ply and turn at each step and the [interruption measurement](interruption.json) for local click-to-paint timing. Live provider semantics and timing, encoded OBS output, the eight-hour soak and viewer comprehension remain production checks.
