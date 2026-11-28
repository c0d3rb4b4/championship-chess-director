# G1 round selection

The operator highlighted Game 3 while Game 4 remained on air. Taking Game 3 changed the two programme windows and the operator preview to the same round, players, colours and result. The test refreshed all three surfaces and kept them open during a server restart. All three reconnected to the saved SQLite selection and showed the updated last move from a fresh authority read. Explicitly entering and leaving rehearsal returned the programme to the unselected slate.

| Scene | 1920 × 1080 | 1280 × 720 |
|---|---|---|
| Fresh installation | [Unselected](unselected-1080.jpg) | [Unselected](unselected-720.jpg) |
| Game 4 with a bound empty scoresheet | [Waiting](game-4-1080.jpg) | [Waiting](game-4-720.jpg) |
| Game 3 with a confirmed result | [Result summary](game-3-1080.jpg) | [Result summary](game-3-720.jpg) |

[Control room while browsing Game 3](operator.jpg) · [Game 4 to Game 3 selection clip, 720p](game-switch-720p.mp4)

The inputs are local test records using the configured round identities. The four-ply Game 3 scoresheet in these pictures is an original test example. The actual Game 3 archive ends after 120 plies. The test also enters and leaves the demo explicitly. Browsing, opening viewers and refreshing browsers make no additional upstream requests.

Run `npx playwright test tests/browser/game-selection.spec.ts` to reproduce this scenario through HTTP, SQLite and SSE. `npm run screenshots:providers` includes it in the existing capture workflow. The workflow artifact contains the JPEGs in `g1/` and the encoded switch in `videos/`.

## Live authority checks · 28 November 2026 UTC

At 12:21:33 UTC the running server took Game 4 and then Game 3 through the operator command endpoint using its default Lichess transport. The operator and programme APIs returned matching summaries.

| Selected round | Bound round / chapter | Observed record |
|---|---|---|
| Game 4 | `wIwJtPqz` / `IriXvwPw` | Gukesh D with White, Javokhir Sindarov with Black. Zero plies and an open result. Scheduled for 15:00 Geneva / 14:00 London. |
| Game 3 | `fnmEB1kH` / `RD8sbYw1` | Javokhir Sindarov with White, Gukesh D with Black. Draw after 60…Kf3, 120 plies. |

From 12:22:02 to 12:22:07 UTC the production summary decoder verified all 14 configured Lichess rounds. Games 1–3 had confirmed draws. Games 4–14 had empty mainlines and open results. The FIDE schedule and pairings supply the published start times and colours. [Schedule](https://worldchampionship.fide.com/schedule) · [Pairings](https://worldchampionship.fide.com/games) · [Game 4 authority](https://lichess.org/broadcast/fide-world-chess-championship-2026/game-4/wIwJtPqz/IriXvwPw) · [Game 3 archive](https://lichess.org/broadcast/fide-world-chess-championship-2026/game-3/fnmEB1kH/RD8sbYw1)

Continuous in-play release and corrections belong to G2. In-play clock convention, shared-root engine evidence, provider permissions, required broadcast delay, OBS performance and the eight-hour rehearsal remain outstanding. [Provider checks](../../PROVIDER_CONTRACTS.md)
