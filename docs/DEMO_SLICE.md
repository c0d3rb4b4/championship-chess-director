# First runnable vertical slice

This slice follows the composition and interruption contract in DESIGN.md and the PRD, using only a hand-authored DEMO fixture. It does not claim the M0, M1, M2 or full P0 release gates.

## Data path

```text
synthetic Sesse + Leela fixtures
             ↓
chess.js legal replay + full-history root verification
             ↓
one Node director ← monotonic presentation clock / validated local cues
             ↓                          ↕
versioned full snapshots          SQLite WAL checkpoint + command IDs
             ↓
ordered SSE → /programme, /operator preview, additional OBS windows
```

`src/server/fixtures.ts` validates game identity, initial position, ordered legal moves and every candidate PV. A SHA-256 root key includes the bound game ID, epoch, revision, starting FEN, complete UCI history and resulting FEN. Readiness uses three advancing fixture work samples over six seconds. Candidate depth remains per candidate. Leela's explicitly synthetic root WDL has White perspective and a per-thousand scale; no human-move probabilities or combined engine score are emitted.

`src/server/director.ts` owns elapsed presentation time and scene selection. Its injectable clock makes the automatic sequence repeatable. The chosen PV is fixed by immutable fixture input, with at most eight legal plies and a 22-second uninterrupted budget (2-second root, 16-second playback, 4-second final hold). In this sequence the real move preempts that budget at 83 seconds. The move predicate runs before the spotlight predicate. One snapshot changes the actual board, root, turn, clocks, scene instance and all old-position engine claims. The frontend has no queued PV animation callbacks to survive the replacement.

Each scene instance identifies epoch, revision, root ply and scene generation. Restart creates a new epoch. Return to actual board suppresses the current spotlight without changing the mainline. The 75-second threshold and 83-second authoritative move are deliberate fixture timings, not provider arrival timestamps.

`src/server/http.ts` serialises commands and the 100 ms director ticks in one Node process. Snapshot reads return the latest released state. SSE carries sequence IDs and full snapshots; clients resnapshot after a sequence gap or reconnect. Slow clients are disconnected rather than buffered indefinitely. Clocks are derived from authoritative fixture anchors and server presentation time; the client does not extrapolate when disconnected. An offline event, failed stream or three-second silent-stream timeout marks the retained output interrupted and freezes the displayed clocks.

`src/server/store.ts` stores one current checkpoint and a durable command journal. A command and its checkpoint commit in one SQLite transaction. The command UUID and expected epoch/revision prevent duplicate effects and stale writes. Each presentation second also saves a checkpoint. A server restart resumes the saved presentation time, with up to one second of lost progress after a crash; downtime does not advance this demo. An operator restart begins a fresh fixture epoch while retaining the audit history.

## HTTP boundaries

| Route | Purpose |
| --- | --- |
| `GET /programme` | Control-free 1920 × 1080 programme, uniformly scaled |
| `GET /api/programme` | Current on-air snapshot only |
| `GET /api/programme/events` | Shared ordered snapshot stream |
| `GET /operator` | Loopback-protected control room with the actual programme iframe |
| `GET /api/operator` | Fixture timing, root digest, binding, time control and command count |
| `POST /api/operator/command` | Validated `restart`, `cue-spotlight`, `release-move`, `return-live` |

The server listens only on `127.0.0.1`, validates loopback peers and Host, and checks Origin, JSON content type, command IDs and game revision on writes. There are no secrets in the programme URL. Remote use is unsupported; do not expose this rehearsal server through a proxy. This is a local protection boundary, not a remote authentication implementation.

## Coverage and limits

The fixture exercises the core A01 interruption path, part of A04/A06 legal/history validation, A07 explicit WDL units, A20 browser refresh, A25 epoch invalidation and A27 geometry. The tests also cover idempotent local commands, checkpoint recovery, multiple viewers and client connection loss. These are bounded tests of the slice, not acceptance of all scenarios in those cases.

The automatic sequence contains one spotlight and one actual move. The fixture starts with clocks well above time trouble and enough large-board time before that spotlight. General cooldown/rolling-share/rapid-play policy, additional scene panels, live transport health, source correction, provider delta and subscription handling, confirmed results, HOLD, delayed upstream release, raw-versus-delayed previews, editable profiles and ticker provenance are not implemented. DEMO captions are static fixture descriptions, not a factual trivia service.

Production requires recorded Sesse full/delta payloads and a verified current Leela handshake/schema, score perspective, WDL calibration and usage terms. Restart recovery of a delayed observation buffer, eight-hour rehearsal, independent viewer comprehension tests and actual OBS 30 fps/frame-loss measurements remain release gates.
