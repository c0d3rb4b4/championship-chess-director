# Championship Chess Director

A silent, OBS-ready chess programme with a separate local control room. This first runnable slice uses a deterministic, continuously labelled **DEMO** game with synthetic Sesse and Leela fixtures. It makes no provider connections.

## Run locally

Use Node.js 24 LTS (minimum 22.13, for built-in SQLite), then run from this directory:

```sh
npm ci
npm run dev
```

- Programme: **http://127.0.0.1:3000/programme** — fixed 1920 × 1080 composition, uniformly scaled, no controls or audio.
- Operator: **http://127.0.0.1:3000/operator** — shared programme preview, fixture status, rehearsal cues and diagnostics.

The server binds to loopback only. Keep it running while using OBS. `npm run dev` builds both bundles and starts the persistent server; rerun it after code changes. For a built checkout, `npm start` starts without rebuilding. `PORT=3100 npm run dev` selects another port.

## Rehearse the complete sequence

Open both routes and click **Restart demo** in the operator view. Presentation time starts at zero:

1. White thinks in the Italian Game after `9...h6`. The actual board is 768 pixels square. Three fixture analysis revisions settle over six seconds.
2. At **1:15**, a frozen Stockfish line takes focus. The 416-pixel actual board, clocks and turn remain visible. The separate 768-pixel board carries **ANALYSIS LINE NOT PLAYED** throughout. It holds the root for two seconds and advances one hypothetical ply every two seconds.
3. At **1:23**, the authoritative **DEMO move `10.d4`** interrupts playback, including a coincident PV deadline. The large actual board returns, the old scene is discarded, and both engines show **Updating for this position**. The move is emphasised for six seconds; the game then remains on the new board with Black thinking.

For a quick walkthrough, click **Cue variation**, watch a few hypothetical plies, then **Play actual move**. These cues advance the shared presentation clock; the automatic sequence uses the same state machine. **Return to actual board** cancels the variation without playing a move. Restart to repeat. The demo does not silently loop.

All programme windows, the operator preview and OBS share one server-owned scene. A browser refresh resnapshots the current state. SQLite checkpoints and command IDs are stored in `data/demo.sqlite`; after a server restart the demo resumes from the saved presentation time, pausing during downtime. Use `DEMO_DB=:memory: npm run dev` for an ephemeral rehearsal.

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

This implements the first demo sequence, not the complete P0 release. Production adapters and captures, results/corrections, programme delay, the full scene rotation, editorial/profile editing, remote authentication and eight-hour/OBS performance gates remain future work. Leela production semantics are deliberately unverified; no live dual-engine launch is implied.

- [Technical design](docs/DESIGN.md)
- [Product requirements](docs/Live_Chess_Broadcast_UI_PRD.docx)
