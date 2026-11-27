# Phase 3 provider replay

M0 is open for in-play updates and field verification. Use the [deployment recorder](#record-a-deployed-round) to collect those observations. The [Game 3 deployment replay](#observed-deployment-replay--27-november-2026-utc) records verified identities and observed wire formats.

At the initial offline checkpoint on 26 November 2026 the deployment endpoints could not be reached for a packet capture from the development host. No event PGN endpoint or verified event-to-provider game mapping was configured. The checked-in example is original synthetic data. At that checkpoint the production event, round, deployed revisions, capture dates and redistribution permissions were unverified.

Run the offline replay from the repository root.

```sh
node --import tsx scripts/replay-providers.mjs fixtures/provider-replay.json
node --import tsx --test tests/providers.test.ts
```

The example reconstructs 1.e4, a Sesse principal line of 1…e5 with a +0.25 White evaluation and a work update from 320 to 555 nodes, and a Leela candidate of 1…c5. Each output line retains its source and local receipt time. The fixture programme continues to use its existing inputs.

| Input | Evidence used for this implementation | Limits until deployment replay |
|---|---|---|
| Event PGN | Explicit authority and provider game ID plus PGN Event, Round, WhiteFideId, BlackFideId, initial FEN and legally replayed moves. An explicit game result can end a game. | Verify provider IDs, colour assignments and PGN dialect. Enable clock annotations only after confirming post-move convention. |
| Sesse | The public remoteglot mirror's client (blob d1457179), server (22bc20d3) and producer (52eae900) describe versioned long polls, JSON-delta stanzas, SAN PVs, individual line depths and White-oriented scores. | Verify wire dialect, bound markers and deployment version. The producer must verify the mapping to this event and round before replay. The decoder additionally compares player names, history and FEN. A missing base or invalid patch requires a full snapshot. |
| Leela | PRD S3/S4 at 1e4207ed and backend/ws_notifier.py define game subscriptions, position FEN and ply, evaluation IDs, and UCI variations. Some historical variations carry only nodes. | Verify selected game mapping and deployed schema. Unidentified historical variations supply no candidate. Candidate node counts are retained per evaluation. WDL scope, scale, perspective, calibration and search-share denominator await observed traffic. Percentages stay disabled. |

[Remoteglot source mirror](https://github.com/madnight/remoteglot) · [Pinned Leela server](https://github.com/LeelaChessZero/lczero-live/blob/1e4207edb40a7b07079b20e8194f20e1a2a278ba/backend/ws_notifier.py)

## Production evidence to collect on the feed host

1. Record capture time in UTC, endpoint, revision or version header, event, round, authority ID, both players and colours, starting FEN and both analysis mappings. Confirm permission before committing provider payloads. Private captures can be replayed locally.
2. Save a full observation, ordinary update, idle traffic, transport close and recovery for each source. Preserve raw PGN, JSON bodies and Sesse request ims plus response X-RGLM. Keep Leela subscription requests and assign a distinct local connection generation to every reconnect or switch.
3. Wrap the chronological observations using the example envelope. For Sesse, base is the request's version and version is the response's X-RGLM. Record disconnect events for all three sources. An authority disconnect carries the same authority and gameId as the PGN packet, with event set to disconnect and no body. During that gap the replay skips engine packets. Recovery requires a bound authority PGN, a full Sesse snapshot and a fresh Leela connection generation with a matching position. Across an ordinary move, keep the Sesse delta chain intact and supply a new Leela subscription plus matching position. Sesse may lead or lag the authority. Its version advances in either case and analysis emits only when both the FEN and complete history match. On a missing delta base, the CLI reports the receipt timestamp on stderr and waits for a full snapshot. Retain original transport logs alongside the replay for timing and authority availability review.
4. Replay twice and compare the emitted observations with the captured game, both advertised analyses and the original transport log. Verify result and clock convention, Sesse score and depth per line, Leela WDL source and denominator, and delayed frames across reconnects. Record unsupported fields individually. M0 closes after successful observed replay. OBS and viewer gates belong to Phase 6.

## Record a deployed round

Run the recorder from a host with access to the three feeds. It polls a single Lichess round PGN every 15 seconds, follows the Sesse long-poll version chain and subscribes to the Leela socket. Lichess and Leela must advertise the same chapter and player IDs in the configured colours. A game switch requires a new recording and binding. Each authority root change starts a fresh Leela subscription. An authority gap also resets Sesse to a full read. The timestamps describe local receipt, so use the feed and broadcast clock as independent references when checking in-play timing.

For Game 4 the [Lichess round](https://lichess.org/broadcast/fide-world-chess-championship-2026/game-4/wIwJtPqz) uses round ID `wIwJtPqz` and chapter `IriXvwPw`. Save the following example as `data/game-4-capture-config.json`. Set `binding.event` to the current PGN `Event` header before recording. The scheduled placeholder and the live PGN may use different event strings. The Sesse names below come from the same players' Game 3 feed. Check the aliases against Game 4 when Sesse switches over.

```json
{
  "roundId": "wIwJtPqz",
  "binding": {
    "authority": "lichess",
    "gameId": "IriXvwPw",
    "event": "Salesforce FIDE World Championship 2026",
    "round": "4.1",
    "whiteId": "46616543",
    "blackId": "14205483",
    "startFen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "sessePlayers": { "white": "Gukesh D", "black": "Sindarov" },
    "clockConvention": "unknown"
  }
}
```

```sh
npm ci
mkdir -p data
curl -fsS 'https://lichess.org/api/broadcast/round/wIwJtPqz.pgn?clocks=true&comments=false' | sed -n '1,/^$/p'
node --import tsx scripts/capture-providers.ts data/game-4-capture-config.json data/game-4-capture.json 2700
node --import tsx scripts/replay-providers.mjs data/game-4-capture.json > data/game-4-replay.jsonl
node --import tsx scripts/replay-providers.mjs data/game-4-capture.json > data/game-4-replay-repeat.jsonl
cmp data/game-4-replay.jsonl data/game-4-replay-repeat.jsonl
```

The duration is in seconds. Ctrl-C finalises the recording early. The recorder creates a new file with owner-only permissions. Keep provider payloads under the ignored `data/` directory until redistribution terms are verified. The file preserves the PGN clock comments, Sesse versions and Leela subscription generations. Provider failures appear on stderr. A Sesse read the decoder rejects is followed by a fresh snapshot request.

For M0 evidence, use the normalised replay to find both engines on the same in-play root before and after a move. Confirm substantive search updates as well as idle traffic. Verify the PGN clock convention against the feed during the move. Collect recovery from each source and label any producer-induced close. Independently verify Leela calibration and candidate visit aggregation before enabling them. A byte-identical replay confirms determinism, and the coverage checks establish whether it contains the necessary live events.

### Recorder verification · 27 November 2026 UTC

A 70-second capture from 01:08 UTC collected 14 packets from the completed Game 3, including two empty versioned Sesse deltas and Leela status heartbeats. Two replays emitted the same 12 JSONL observations. The final 120-ply root matched all three sources, with a ½–½ result, Stockfish's Bg5 at depth 130 and nine Leela candidates in evaluation 2804473. The recording remains private. SHA-256 of the capture is `74ae93ad9ed7888f718e246155ae6a7f00bf0fa1be7f0e407da07d2a95963b1e`.

The offline recorder test exercises a move, an intact Sesse delta chain, a fresh Leela subscription at the new ply and recovery from an authority gap with a fresh Sesse snapshot. The browser simulation renders the pending and recovered states at 1920 × 1080 and 1280 × 720. A two-viewer fixture interruption took 204 ms from operator click to browser paint against the 500 ms target. Deployed in-play behaviour, encoded OBS output and viewer comprehension still require sign-off.

## Observed deployment replay · 27 November 2026 UTC

The selected game was Game 3 of the FIDE World Chess Championship in Geneva. The Lichess round ID was `fnmEB1kH`, chapter `RD8sbYw1`, PGN round `3.1`. White was Javokhir Sindarov (FIDE 14205483), Black was Gukesh D (46616543). The authority reported a draw after 60…Kf3 from the standard start. The replay matched all 120 plies and the final FEN. The provider PGN's Date header differs from the capture date.

| Source | Deployment observation | Replay check |
|---|---|---|
| [Lichess round PGN](https://lichess.org/api/broadcast/round/fnmEB1kH.pgn) | GameURL identifies both round and chapter. The exported PGN includes FIDE IDs, colours, clock annotations and result. | Strict legal replay from the standard position. Clock conversion stayed disabled pending in-play convention verification. |
| [Sesse](https://analysis.sesse.net/analysis.pl) | At 00:13 UTC the full response carried X-RGLM 1795738381508, engine Stockfish dev-20261115-m-18d93109-asn. Depth, candidate depths and nodes were decimal strings. A poll with that ims returned an empty delta and X-RGLM 1795738411509. | An explicit White alias `Sindarov` plus the exact Black name, history and FEN bound the snapshot. The principal move was Bg5 at depth 130 with a White score of 0.00 pawns and 1,367,603,783 nodes. Nine alternatives retained their individual depths. The idle delta preserved the analysis. |
| [Leela Live](https://live.lczero.org/) | The deployed client asset referenced revision 98ff2cb0c3c0e80a83f87fa1eb90cb9e42dc191e. Its socket at `/api/ws` advertised game 483 with a feedUrl ending in `/fnmEB1kH/RD8sbYw1`. Subscribing to game 483, ply 120 returned positions, evaluations and a status heartbeat. | The final FEN matched. Evaluation 2804473 supplied nine legal UCI candidate lines, including Bg5 with 233,833 visits. Both position and variation records carried W/D/B fields. Perspective, calibration and the search-share denominator still need independent verification. |

The checked-in tests use original examples. Provider payload redistribution terms have yet to be verified. The finished game supplied a final mainline and archived analysis. In-play move and clock changes, substantive Sesse deltas and evolving Leela evaluations on a common live root still require a capture during play.

The private recording `game-3-provider-replay.json` contains 16 timestamped packets including a client-initiated close, fresh HTTP reads and a second WebSocket subscription. Both generations reconstructed the same final Leela evaluation. Replaying twice with the command above emitted 11 byte-identical JSONL observations per run. Recording SHA-256: `a2c77f860bba6922310de086feb0acfe845eb3937c6de2bf70bae431551d903f`. Output SHA-256: `d73277fc2ab150c3cc8a4edc830d7d6cb1c87db6ceff18cd1635bc84eb2f4cb6`.

### Follow-up deployment field check

The Game 3 archive still returned a completed game. Both colours' archived clock annotations jump at their own 40th move, consistent with a 30-minute period bonus and post-move clocks. Check packet ordering and clock updates against a live move before enabling production clocks.

The [served Leela client](https://live.lczero.org/dist/main.js?98ff2cb0c3c0e80a83f87fa1eb90cb9e42dc191e) labels its outcome fields White, Draw and Black and divides each by ten for percentages. The candidate tooltip describes visits as a percentage and divides candidate nodes by the enclosing evaluation's node count. This agrees with White perspective, per-mille WDL and an evaluation-node denominator on the client. The [public analyzer revision](https://github.com/LeelaChessZero/lczero-live/blob/1e4207edb40a7b07079b20e8194f20e1a2a278ba/backend/analyzer.py) additionally distinguishes candidate WDL from a visit-weighted position aggregate. The public source revision and served asset identifier differ. Deployment calibration, the producer's aggregation of the total, and the relationship between candidate visits and that total across live partial updates still require verification. The replay continues to omit WDL and search share.

## In-play screenshot simulation

Run `npm ci`, `npx playwright install --with-deps --no-shell chromium`, then `npm run screenshots:providers`. The browser test runs the replay CLI on the synthetic recording in `fixtures/provider-simulation.json` and feeds the decoded states to the programme renderer. The simulation uses ten-minute starting clocks and post-move clock annotations. Packet timestamps establish event order.

The seven numbered stages cover the bound position after 1.e4, independent search updates, both engines pending after 1…e5, Sesse returning first on a delta, both engines returning, the authority reconnecting and analysis recovering. The test checks that an intervening old-root Sesse delta advances the wire version without emitting analysis. It also checks stale Leela frames, SAN, clocks, per-source candidates and absence of unverified WDL. Node replay tests additionally cover a future-root Sesse update before the authority and a lost base during recovery.

**Provider simulation screenshots** runs on PRs targeting main, after merges to main, and on manual dispatch. Download the commit-labelled artifact from a successful workflow run. It contains fourteen provider-replay PNGs plus the stage snapshots in `stages.json`. The `statistics/` folder holds 24 [ordinary programme panel captures](evidence/phase-2/README.md) from the synthetic director fixture. Completed move time, evaluation history, Leela outcomes and search progress each have typical, missing-data and long-value views. Both sets cover 1920 × 1080 and 1280 × 720. Artifacts are retained for 30 days. Local output is in `test-results/provider-screenshots/`. The deployed in-play checks above remain open.

The `videos/` folder contains four silent 1280 × 720 MP4 clips from the demo director. They cover statistics rotation, the entrance into evaluation history, the analysis spotlight and its first hypothetical move, and the actual move that interrupts the spotlight before both engines return. The rehearsal jumps between fixture times and plays the programme's entrance animations at their normal speed. The local screenshot command saves the same recordings as WebM. OBS sign-off remains a separate production check.
