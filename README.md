# Championship Chess Director

A silent, OBS-ready chess programme with a separate local control room. Select a championship round in the control room to put its actual board, played moves and verified result on air. A separate **DEMO** rehearsal includes animated boards, clocks and engine statistics.

## Run locally

Use Node.js 24 LTS (minimum 22.13, for built-in SQLite), then run from this directory:

```sh
npm ci
npm run dev
```

- Programme: **http://127.0.0.1:3000/programme** — fixed 1920 × 1080 composition, uniformly scaled, no controls or audio.
- Operator: **http://127.0.0.1:3000/operator** — game selector, shared programme preview, authority status and rehearsal controls.

The server binds to loopback only. Keep it running while using OBS. `npm run dev` builds both bundles and starts the persistent server; rerun it after code changes. For a built checkout, `npm start` starts without rebuilding. `PORT=3100 npm run dev` selects another port.

## Select a championship game

A fresh install opens on **Awaiting game selection**. On `/operator`, choose a round and click **Take Game N to programme**. Browsing the list leaves the current programme on air. Both viewers and the preview receive the same switch. The selector uses the browser’s local timezone and the programme uses the event timezone.

The server polls the selected Lichess chapter every 15 seconds, backs off after failures, and retries after a result to pick up amendments. Both viewers and the preview share one connection to each enabled source. A move or explicit result updates the actual board independently of the engines. An authority interruption retains the last verified board. **Clear selection** returns every viewer to the neutral slate.

A finished selection shows the final position for 30 seconds, then loops Game in numbers, any supported time and evaluation pages, and a labelled replay of the accepted moves. Cold archives and games that finish on air share this rundown. Viewers who join or reconnect see the current page and replay position.

Set `PROGRAMME_DELAY_SECONDS=60` for a one-minute delay (default zero). The selected session keeps its delay across restarts. To change delay, clear the selection, restart with the new value and take the game again. A cold result waits in the buffer. A freshly validated previously released final can rejoin immediately when it covers the configured delay. PGN header dates and HTTP server dates do not establish move or result times.

The control room shows the latest upstream read, engine status and the delayed programme preview. Enable Sesse for a verified round with `binding.sessePlayers` in the catalogue. The checked-in Game 3 aliases were verified on its archive. Game 4 still requires a producer to verify the Sesse mapping and names. Leela matches the advertised chapter and both FIDE IDs, then validates the subscribed ply, FEN and legal candidate. Clock conventions, Leela WDL and visit shares await in-play verification. The [provider contracts](docs/PROVIDER_CONTRACTS.md) track source checks and broadcast permissions.

The [championship catalogue](config/championship.json) contains the published rounds, verified pairings, UTC starts and round/chapter bindings. Edit a round's verified UTC start in that file to reschedule a pinned pairing. The programme adopts the update on its configured delay. Restart to load changes to the published rounds or provider bindings, or set `CHAMPIONSHIP_CATALOGUE` to use another catalogue. Use `null` for an unknown start or pending binding. An invalid or missing configuration falls back to the last validated catalogue when available. The control room reports binding mismatches and authority failures. The schedule comes from [FIDE](https://worldchampionship.fide.com/schedule) and colour assignments from its [pairings](https://worldchampionship.fide.com/games).

SQLite stores the selection, receipt and release times, accepted mainlines and revisions, authority interruptions and matching analysis. Restart reconstructs the currently eligible position from the journal. Keep this database private because it includes source payloads. Set `BROADCAST_DB` to choose the database path. The default remains `data/demo.sqlite` so existing installations keep their rehearsal checkpoint. A legacy rehearsal database opens on the neutral slate until the operator makes a selection.

Before play, the selected pairing and countdown share the programme with the latest earlier completed round whose score is eligible. At zero, the programme waits for a verified first move. A round without a playable predecessor keeps the static waiting layout. A confirmed first move or result takes over on the same timeline used by the operator preview and OBS.

The target live programme runs unattended after one game selection. At the G5 revision, in-play graphics rotation and automatic engine spotlights still run only in demo. The remaining work and [one prompt to implement it](docs/AUTOMATED_PROGRAMME.md#one-prompt-for-all-remaining-development) cover the real programme.

## Match-day runbook

1. For a private rehearsal, start a separate local instance with its own database and port. For example, run `PORT=3100 BROADCAST_DB=data/rehearsal.sqlite npm run dev`. Open that port's `/operator` and `/programme`. For a public take, first confirm the source permissions, required delay and production-host checks in the [release record](docs/evidence/game-day-g5/README.md#public-broadcast-readiness).
2. Confirm the round, start time, White/Black assignments and authority binding. Check the configured delay before taking the game. Browse a round, then click **Take Game N to programme**. Check the embedded preview against the OBS programme source. Demo cues require **Enter demo rehearsal**.
3. Before play, identify the selected pairing and countdown on the right. The previous replay carries its own round, result and colours on the left. Game 1 has no previous board. At zero, wait for the first eligible move. If the feed is unavailable, check the control-room diagnostic and retain the last verified position.
4. During play, compare the actual board and move list with the selected chapter on the delayed timeline. The control room can report a newer upstream read. Let coverage continue on the move authority when either engine lacks a verified matching root. Check an unexpected colour, chapter or result against the binding before taking another game.
5. At the confirmed result, check the final position and the 30-second hold. Watch Game in numbers, available charts and the labelled replay. Selecting a completed round cold follows the same rundown after its result becomes eligible. To leave the recap, explicitly take the next round or **Clear selection**.
6. To repeat the fixture rehearsal locally, run `npm ci`, `npx playwright install --with-deps --no-shell chromium` and `npm run screenshots:providers`. For encoded clips, use the PR/main **Provider simulation screenshots** artifact and open `MATCH-DAY.md`. Record the tested SHA when signing off. For a deployed check, keep the source recording under ignored `data/` and use the [capture and replay instructions](docs/PROVIDER_CONTRACTS.md#record-a-deployed-round).

## Watch the demo

Open both routes. Click **Enter demo rehearsal** in the operator view, then **Restart demo**. The fixture follows this sequence.

1. White thinks in the Italian Game after `9...h6`. The actual board is 768 pixels square. Three fixture analysis revisions settle over six seconds.
2. At **1:15**, a frozen Stockfish line takes focus. The 416-pixel actual board, clocks and turn remain visible. The separate 768-pixel board carries **ANALYSIS LINE NOT PLAYED** throughout. It holds the root for two seconds and advances one hypothetical ply every two seconds.
3. At **1:23**, the authoritative **DEMO move `10.d4`** interrupts playback, including a coincident PV deadline. The large actual board returns, the old scene is discarded, and both engines show an updating state. The move is emphasised for six seconds; Black’s clock runs from the move anchor.
4. At **1:30**, Stockfish returns with +0.18. A late Leela update for the old position at **1:32** leaves its sheet pending. At **1:36**, Leela returns with 26% White win, 54% draw and 20% Black win. At **1:50**, Black plays **10...exd4**, both sheets clear and White’s clock starts.

For a quick walkthrough, click **Cue variation**, watch a few hypothetical plies, then **Play actual move**. These cues advance the shared presentation clock; the automatic sequence uses the same state machine. **Return to actual board** cancels the variation without playing a move. Restart to repeat. The demo does not silently loop.

All programme windows, the operator preview and OBS share one server-owned scene. A browser refresh resnapshots the current state. SQLite checkpoints and command IDs are stored in `data/demo.sqlite`; after a server restart the demo resumes from the saved presentation time, pausing during downtime. Use `START_IN_DEMO=1 BROADCAST_DB=:memory: npm run dev` for an ephemeral rehearsal. The startup flag can start a fresh rehearsal or restore a selected demo. A normal restart takes rehearsal off air and retains its checkpoint for explicit re-entry. A saved real selection takes precedence over the flag. **Leave demo rehearsal** returns to the neutral slate. Taking a championship game switches directly from the demo.

## Add the programme to OBS

Run the app on the same machine as OBS, then:

1. In the scene's **Sources**, add a **Browser** source named “Chess programme”.
2. Leave **Local file** off. Set **URL** to `http://127.0.0.1:3000/programme`.
3. Set **Width** to **1920**, **Height** to **1080**, enable **Use custom frame rate**, and set **FPS** to **30**.
4. Leave **Shutdown source when not visible** and **Refresh browser source when scene becomes active** unchecked. These settings preserve continuity when changing scenes.
5. Fit the source to the scene. Keep `/operator` open in your normal browser and rehearse an interruption. Check a 1080p capture and a 720p preview. Mix any music separately; the application is silent.

The property names and their effects are documented in [OBS Browser Source](https://obsproject.com/kb/browser-source). The application needs no OBS control permissions. Actual OBS capture performance has not yet been benchmarked.

## Repeatable verification

```sh
npm run check
npm test
npx playwright install --no-shell chromium
npm run test:e2e
```

The deterministic Node tests use an injected presentation clock: no 83-second wait. They check interruption at the root and several playback plies, equal-time move priority, stale-scene cancellation, engine invalidation, exact-history binding, legal PVs, idempotent commands and SQLite recovery. The HTTP test measures command-to-SSE release against 500 ms.

The Chromium tests drive the actual operator buttons and two programme viewers. They verify board sizes, the persistent hypothetical label, the unchanged actual position during playback, return within 500 ms, browser refresh, offline clock freeze and 720p scaling without scrolling. They regenerate screenshots and the local timing measurement in [docs/evidence](docs/evidence/README.md). CI runs both suites.

## Implementation and scope

The persistent Node/TypeScript server owns chess rules, a deterministic director, a SQLite WAL checkpoint/command journal and a shared ordered SSE stream. The browser renders validated board frames; it schedules no variation timers. Fixture score meanings and full history bindings are explicit. See [slice architecture and limits](docs/DEMO_SLICE.md) and [fixture contract](fixtures/README.md).

The real selector, continuous delayed feed, finished-game rundown, and pre-game countdown and replay implement game-day G1 through G4. G5 adds the [match-day rehearsal and release record](docs/evidence/game-day-g5/README.md). Producer profiles, remote authentication and the eight-hour/OBS performance gates remain open. Leela production WDL is disabled pending in-play verification.

- [Phased development plan and next implementation tasks](docs/PHASED_PLAN.md)
- [Game-day implementation plan and repeatable prompt](docs/GAME_DAY_PLAN.md) for choosing real championship games, countdowns, replays and post-game statistics.
- [Technical design](docs/DESIGN.md)
- [Product requirements](docs/Live_Chess_Broadcast_UI_PRD.docx)

## Where to make a change

| Change | Start here | Check |
|---|---|---|
| On-air labels, score layout or transitions | `src/client/app.ts`, `src/client/styles.css` | Compare the three scenes in the browser evidence. Confirm the opponent’s clock, actual move list and board identity at 720p. |
| Board rendering or highlighting | `src/client/board.ts` | Verify both actual and hypothetical boards against their own FEN and from/to squares. |
| Engine fixture or score meaning | `fixtures/`, `src/server/fixtures.ts`, `src/server/director.ts` | Replay every PV from its bound root. Check candidate depths and the order and units of the outcome tuple. |
| Scene timing or interruption | `src/server/director.ts` and `tests/director.test.ts` | Drive the injected clock either side of the boundary; an authoritative move wins a tie with a PV step. |

The product requirements define what the audience sees. The design records the data and timing contracts. The plan breaks remaining work into reviewable changes. The [demo guide](docs/DEMO_SLICE.md) describes what this checkout can demonstrate today.
