# Phase 3 provider replay

Game 4 now has private in-play samples on two shared roots and recovery for all three transports. The current classical-round clock and root outcome contracts are described below. Candidate visit-share accounting remains open. [Game 4 private capture report](evidence/unattended/README.md#deployed-game-4-observations--28-november-2026-utc) Use the [deployment recorder](#record-a-deployed-round) to collect those observations. The [Game 3 deployment replay](#observed-deployment-replay--27-november-2026-utc) records verified identities and observed wire formats.

At the initial offline checkpoint on 26 November 2026 the deployment endpoints could not be reached for a packet capture from the development host. No event PGN endpoint or verified event-to-provider game mapping was configured. The checked-in example is original synthetic data. At that checkpoint the production event, round, deployed revisions, capture dates and redistribution permissions were unverified.

Run the offline replay from the repository root.

```sh
node --import tsx scripts/replay-providers.mjs fixtures/provider-replay.json
node --import tsx --test tests/providers.test.ts
```

The example reconstructs 1.e4, a Sesse principal line of 1…e5 with a +0.25 White evaluation and a work update from 320 to 555 nodes, and a Leela candidate of 1…c5. Each output line retains its source and local receipt time. The fixture programme continues to use its existing inputs.

| Input | Evidence used for this implementation | Limits until deployment replay |
|---|---|---|
| Event PGN | Explicit authority and provider game ID plus PGN Event, Round, WhiteFideId, BlackFideId, initial FEN and legally replayed moves. An explicit game result can end a game. | The Game 3 replay verified provider IDs, colour assignments and PGN dialect. The classical-round profile supplies the verified post-move convention and staged control. |
| Sesse | The public remoteglot mirror's client (blob d1457179), server (22bc20d3) and producer (52eae900) describe versioned long polls, JSON-delta stanzas, SAN PVs, individual line depths and White-oriented scores. | Verify wire dialect, bound markers and deployment version. The producer must verify the mapping to this event and round before replay. The decoder additionally compares player names, history and FEN. A missing base or invalid patch requires a full snapshot. |
| Leela | PRD S3/S4 at 1e4207ed and backend/ws_notifier.py define game subscriptions, position FEN and ply, evaluation IDs, and UCI variations. Some historical variations carry only nodes. | The Game 3 replay verified mapping, White-oriented per-mille WDL and the archived visit denominator. Unidentified historical variations supply no candidate. Candidate nodes are retained per evaluation. The programme now shows verified deep root WDL. Partial candidate visit accounting stays gated. |

[Remoteglot source mirror](https://github.com/madnight/remoteglot) · [Pinned Leela server](https://github.com/LeelaChessZero/lczero-live/blob/1e4207edb40a7b07079b20e8194f20e1a2a278ba/backend/ws_notifier.py)

## On-air championship fields

The fourteen classical rounds use the published 120 minutes for the first forty moves, a 30-minute addition after each player's 40th move, and a 30-second increment from move 41. The Lichess PGN attaches `%clk` to the mover. The programme reconstructs completed think times from each player's consecutive anchors and the stage boundary. Missing or invalid observations leave gaps. [FIDE regulations, section 4.2.2](https://handbook.fide.com/files/handbook/FWCM2026.pdf) · [PGN clock convention, section 4.2](https://www.enpassant.dk/chess/palview/enhancedpgn.htm)

For a cold take, the public Lichess round-status endpoint supplies both players' clocks in centiseconds and an elapsed `thinkTime` in seconds. The programme checks round and chapter, result, FEN, last UCI move, colours, FIDE IDs and both PGN clock anchors. A subsequent unchanged PGN confirms the reading. A delayed response, a move or a correction cannot activate a clock on a different root. PGN polling continues during this lookup. A bound running clock permits a settled long-think variation under the existing pressure and cooldown rules. [Public round status](https://lichess.org/api/broadcast/-/-/wIwJtPqz)

Leela's published deep position fields `scoreW`, `scoreD` and `scoreB` give White win, draw and Black win in per mille. The serving client displays each divided by ten. The programme presents that provider estimate after verifying the legal mainline, root and complete tuple. Exact backend calibration parameters are unnecessary to reproduce the displayed values. Candidate outcomes, the separate one-minute search, and candidate visit shares have different meanings. The championship enables only root WDL. [Provider explanation](https://lczero.org/blog/2026/11/lczero-live-analysis-for-wcc-2026/) · [Serving client](https://live.lczero.org/dist/main.js?98ff2cb0c3c0e80a83f87fa1eb90cb9e42dc191e)

## Production evidence to collect on the feed host

1. Record capture time in UTC, endpoint, revision or version header, event, round, authority ID, both players and colours, starting FEN and both analysis mappings. Confirm permission before committing provider payloads. Private captures can be replayed locally.
2. Save a full observation, ordinary update, idle traffic, transport close and recovery for each source. Preserve raw PGN, JSON bodies and Sesse request ims plus response X-RGLM. Keep Leela subscription requests and assign a distinct local connection generation to every reconnect or switch.
3. Wrap the chronological observations using the example envelope. For Sesse, base is the request's version and version is the response's X-RGLM. Record disconnect events for all three sources. An authority disconnect carries the same authority and gameId as the PGN packet, with event set to disconnect and no body. During that gap the replay skips engine packets. Recovery requires a bound authority PGN, a full Sesse snapshot and a fresh Leela connection generation with a matching position. Across an ordinary move, keep the Sesse delta chain intact and supply a new Leela subscription plus matching position. Sesse may lead or lag the authority. Its version advances in either case and analysis emits only when both the FEN and complete history match. On a missing delta base, the CLI reports the receipt timestamp on stderr and waits for a full snapshot. Retain original transport logs alongside the replay for timing and authority availability review.
4. Replay twice and compare the emitted observations with the captured game, both advertised analyses and the original transport log. Verify result and clock convention, Sesse score and depth per line, Leela WDL source and denominator, and delayed frames across reconnects. Record unsupported fields individually. M0 closes after successful observed replay. OBS and viewer gates belong to Phase 6.

## Record a deployed round

Run the recorder from a host with access to the three feeds. It polls a single Lichess round PGN every 15 seconds, follows the Sesse long-poll version chain and subscribes to the Leela socket. Lichess and Leela must advertise the same chapter and player IDs in the configured colours. A game switch requires a new recording and binding. Each authority root change starts a fresh Leela subscription. An authority gap also resets Sesse to a full read. The timestamps describe local receipt, so use the feed and broadcast clock as independent references when checking in-play timing.

For Game 4 the [Lichess round](https://lichess.org/broadcast/fide-world-chess-championship-2026/game-4/wIwJtPqz) uses round ID `wIwJtPqz` and chapter `IriXvwPw`. The 27 November preflight found an empty mainline with the expected chapter, round, players and colours. Its placeholder `TimeControl` header disagreed with the [FIDE regulations, §4.2.2](https://handbook.fide.com/files/handbook/FWCM2026.pdf#page=2). Use the official 120 minutes through move 40, then 30 extra minutes and a 30-second increment from move 41 when checking the live clocks. [FIDE schedules play for 28 November at 14:00 UTC](https://worldchampionship.fide.com/schedule). Save the following example as `data/game-4-capture-config.json`. Set `binding.event` to the current PGN `Event` header before recording. The scheduled placeholder and the live PGN may use different event strings. The Sesse names below come from the same players' Game 3 feed. Check the aliases against Game 4 when Sesse switches over.

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
node --import tsx scripts/capture-providers.ts data/game-4-capture-config.json data/game-4-capture.json 2700 --interactive
node --import tsx scripts/replay-providers.mjs data/game-4-capture.json > data/game-4-replay.jsonl
node --import tsx scripts/replay-providers.mjs data/game-4-capture.json > data/game-4-replay-repeat.jsonl
cmp data/game-4-replay.jsonl data/game-4-replay-repeat.jsonl
```

The duration is in seconds. In interactive mode, type `stop` to finalise the recording early. The recorder creates a new file with owner-only permissions. Keep provider payloads under the ignored `data/` directory until redistribution terms are verified. The file preserves the PGN clock comments, Sesse versions and Leela subscription generations. Provider failures appear on stderr. A Sesse read the decoder rejects is followed by a fresh snapshot request.

### Rehearse a disconnect during the recording

Start with ordinary play long enough to capture both engines before and after an actual move. Then, while the feeds are healthy, type one command at a time into the recorder started with `--interactive`. Let each source recover before requesting the next reconnect. Each command affects only the local recorder.

| Command | Expected capture sequence |
|---|---|
| `reconnect sesse` | The recorder skips the next versioned poll, records the gap and fetches a full snapshot without `ims`. |
| `reconnect leela` | On the next message on the subscribed socket, the recorder drops that message, closes the socket and starts a fresh connection and matching subscription. |
| `reconnect authority` | The recorder skips the next PGN poll and resets both engine sessions. After a fresh bound PGN, Sesse fetches a full snapshot and Leela subscribes in a fresh connection. |

Commands queue until the relevant source can exercise its reconnect path. Allow for the regular poll and heartbeat intervals. Watch stderr for the reconnect, and keep the recording running for subsequent snapshots. The capture and coverage report label a rehearsed gap with `initiatedBy: "operator"` so the evidence distinguishes it from a provider outage. The default recorder invocation works without a terminal.

For M0 evidence, use the normalised replay to find both engines on the same in-play root before and after a move. Confirm substantive search updates as well as idle traffic. Verify the PGN clock convention against the feed during the move. Collect recovery from each source and label any producer-induced close. Independently verify Leela calibration and candidate visit aggregation before enabling them. A byte-identical replay confirms determinism, and the coverage checks establish whether it contains the necessary live events.

### Check recording coverage

After replaying the capture twice, run the coverage report on the same file.

```sh
node --import tsx scripts/replay-providers.mjs data/game-4-capture.json --coverage
```

The report gives local receipt times for accepted snapshots, idle traffic, increasing search work and each source's recovery. It looks for both legal engine analyses on two consecutive authoritative in-play plies without an authority gap between them. An authority recovery requires a fresh bound PGN followed by both analyses. Sesse needs a matching full snapshot after its own disconnect. Leela needs a new connection generation with a matching position and candidate after its own disconnect. A socket recycled because the authority root changed does not count as a Leela disconnect.

A report exits with status 0 when it finds all of this packet evidence, or 2 when any item in `pending` remains. Malformed recordings fail replay. The synthetic provider simulation intentionally exits 2 because it lacks independent engine reconnects and some idle traffic. The recording tests add those events and verify that coverage then passes.

#### Compare broadcast clocks and Leela fields

Keep the capture binding's clock convention `unknown` during the recording. The coverage report's `observedClockedSharedMove` gives the two raw PGN clock strings and their seconds, plies, SAN, movers and local receipt times when it finds two adjacent shared roots with annotations. Compare each annotation with the named mover's stopped clock immediately after the corresponding move in the official broadcast. Record the plies, the broadcast reference and clock readings, and any difference or timing uncertainty. Set `clockConvention` to `post-move` in a private replay copy only after that comparison. Clock coverage under the declared convention is reported as `clockedSharedMove`.

The `leela.fieldSamples` entries report field changes on the accepted root and subscription generation. Position and evaluation observations stay distinct. The position sample reports the deep W/D/B tuple and node count. The evaluation sample reports the denominator sent with that evaluation ID, the subtotal of its named legal candidates, the remaining visits, and counts of valid, missing and invalid WDL tuples. Partial updates for the same ID can contribute to its subtotal. Candidate visits from earlier evaluations are excluded. A missing denominator, missing candidate nodes or a negative remainder leaves the share unverified. Compare the denominator and WDL scope with the served Leela client during in-play updates. Production calibration, provider usage and the independent clock comparison remain M0 checks even when packet coverage exits 0.

A repeat check beginning at 02:41 UTC on 27 November collected 13 packets from completed Game 3. Two replay runs each emitted the same 11 observations. The report found accepted snapshots and idle traffic for all three providers. It exited 2 with search growth, a shared move, adjacent clock samples and each provider's recovery still missing. Private capture SHA-256 is `c97f327035a52a6ce9d97674fb8396a552be78ee7d2f2adb89835d4950d49c34`.

### Operator reconnect rehearsal · 27 November 2026 UTC

A capture beginning at 05:57:56 UTC on the completed Game 3 collected 35 packets. Both replays emitted the same 25 observations. Coverage found a full snapshot, idle traffic and a labelled operator-induced disconnect and recovery for each provider on the final game position.

| Feed | Recovery observed | Time from recorded gap to accepted recovery |
|---|---|---|
| Sesse | Matching full snapshot without a delta base | 1.4 s |
| Leela | Candidate analysis on a fresh socket generation with the matching position | 9.7 s |
| Lichess authority | Bound PGN followed by both matching engine analyses | 23.8 s |

These measurements describe local recorder receipt times on a finished game. Coverage exited 2 with four packet checks outstanding. Game 4 must supply in-play search growth for both engines, matching analysis on both sides of one played move and adjacent clock annotations checked against the broadcast. Leela deployment calibration, visit aggregation and feed usage terms also remain open. Encoded OBS output and viewer comprehension remain Phase 6 checks. Private capture SHA-256 is `f389c5383b4157fa57aeabdc7abce77d2570da5053f4f8cc525516751f6b059f`.

### Recorder verification · 27 November 2026 UTC

A 70-second capture from 01:08 UTC collected 14 packets from the completed Game 3, including two empty versioned Sesse deltas and Leela status heartbeats. Two replays emitted the same 12 JSONL observations. The final 120-ply root matched all three sources, with a ½–½ result, Stockfish's Bg5 at depth 130 and nine Leela candidates in evaluation 2804473. The recording remains private. SHA-256 of the capture is `74ae93ad9ed7888f718e246155ae6a7f00bf0fa1be7f0e407da07d2a95963b1e`.

The offline recorder test exercises a move, an intact Sesse delta chain, a fresh Leela subscription at the new ply and recovery from an authority gap with a fresh Sesse snapshot. The browser simulation renders the pending and recovered states at 1920 × 1080 and 1280 × 720. A two-viewer fixture interruption took 204 ms from operator click to browser paint against the 500 ms target. Deployed in-play behaviour, encoded OBS output and viewer comprehension still require sign-off.

## Observed deployment replay · 27 November 2026 UTC

The selected game was Game 3 of the FIDE World Chess Championship in Geneva. The Lichess round ID was `fnmEB1kH`, chapter `RD8sbYw1`, PGN round `3.1`. White was Javokhir Sindarov (FIDE 14205483), Black was Gukesh D (46616543). The authority reported a draw after 60…Kf3 from the standard start. The replay matched all 120 plies and the final FEN. The provider PGN's Date header differs from the capture date.

| Source | Deployment observation | Replay check |
|---|---|---|
| [Lichess round PGN](https://lichess.org/api/broadcast/round/fnmEB1kH.pgn) | GameURL identifies both round and chapter. The exported PGN includes FIDE IDs, colours, clock annotations and result. | Strict legal replay from the standard position. Clock conversion stayed disabled pending in-play convention verification. |
| [Sesse](https://analysis.sesse.net/analysis.pl) | At 00:13 UTC the full response carried X-RGLM 1795738381508, engine Stockfish dev-20261115-m-18d93109-asn. Depth, candidate depths and nodes were decimal strings. A poll with that ims returned an empty delta and X-RGLM 1795738411509. | An explicit White alias `Sindarov` plus the exact Black name, history and FEN bound the snapshot. The principal move was Bg5 at depth 130 with a White score of 0.00 pawns and 1,367,603,783 nodes. Nine alternatives retained their individual depths. The idle delta preserved the analysis. |
| [Leela Live](https://live.lczero.org/) | The deployed client asset used the JavaScript SHA-1 fingerprint 98ff2cb0c3c0e80a83f87fa1eb90cb9e42dc191e. Its socket at `/api/ws` advertised game 483 with a feedUrl ending in `/fnmEB1kH/RD8sbYw1`. Subscribing to game 483, ply 120 returned positions, evaluations and a status heartbeat. | The final FEN matched. Evaluation 2804473 supplied nine legal UCI candidate lines, including Bg5 with 233,833 visits. Both position and variation records carried W/D/B fields. Perspective, calibration and the search-share denominator still need independent verification. |

The checked-in tests use original examples. See [provider terms](#provider-terms-and-attribution) before publishing a capture or airing the live programme. The finished game supplied a final mainline and archived analysis. In-play move and clock changes, substantive Sesse deltas and evolving Leela evaluations on a common live root still require a capture during play.

The private recording `game-3-provider-replay.json` contains 16 timestamped packets including a client-initiated close, fresh HTTP reads and a second WebSocket subscription. Both generations reconstructed the same final Leela evaluation. Replaying twice with the command above emitted 11 byte-identical JSONL observations per run. Recording SHA-256: `a2c77f860bba6922310de086feb0acfe845eb3937c6de2bf70bae431551d903f`. Output SHA-256: `d73277fc2ab150c3cc8a4edc830d7d6cb1c87db6ceff18cd1635bc84eb2f4cb6`.

### Follow-up deployment field check

The Game 3 archive still returned a completed game. Both colours' archived clock annotations jump at their own 40th move, consistent with a 30-minute period bonus and post-move clocks. Check packet ordering and clock updates against a live move before enabling production clocks.

The [served Leela client](https://live.lczero.org/dist/main.js?98ff2cb0c3c0e80a83f87fa1eb90cb9e42dc191e) labels the outcomes White, Draw and Black, divides their values by ten for percentages, and divides candidate visits by the enclosing evaluation's node total. The socket's `jsHash` was the MD5 of those same served bytes. Both hashes identify the JavaScript. The [public analyzer](https://github.com/LeelaChessZero/lczero-live/blob/1e4207edb40a7b07079b20e8194f20e1a2a278ba/backend/analyzer.py) computes root WDL from visit-weighted candidates, emits White-oriented values and retains only a subset of candidates for display. The [LCZero launch announcement](https://lczero.org/blog/2026/11/lczero-live-analysis-for-wcc-2026/) describes outcomes calibrated to time control and player ratings using the BT6-6000000 network. The deployed backend revision and exact per-game calibration settings remain unverified. Position fields suffixed `1m` describe a separate search and are excluded from the deep WDL audit.

#### Archived Leela denominator check · 27 November 2026 UTC

A 70-second Game 3 recording beginning at 06:51 UTC collected 14 packets. Two replays emitted the same 12 observations. Coverage matched the final position and reported the deep root tuple 7 / 983 / 10, nine complete candidate tuples and a 1,022,491-visit denominator. Separate archived subscriptions tested earlier roots as well.

| Ply | Evaluation | Evaluation visits | Named candidate visits | Remainder |
|---:|---:|---:|---:|---:|
| 79 | 2803674 | 15,405,234 | 15,401,568 | 3,666 |
| 80 | 2803705 | 21,961,238 | 21,955,608 | 5,630 |
| 119 | 2804474 | 1,126,635 | 1,126,635 | 0 |
| 120 | 2804473 | 1,022,491 | 1,022,491 | 0 |

On plies 119 and 120, weighting the candidate WDL by visits reproduced the root tuple after rounding. Plies 79 and 80 establish that the display can omit visits while retaining the larger evaluation denominator. These are archive observations. In-play updates across a shared move, clock comparison, and same-evaluation aggregation on live partial frames remain open. The archive recorder retains its original field gates. See the current on-air championship contract above for live root WDL.

Private SHA-256 digests. Three-feed recording `e438fa980a3bcfe48cd37356e7bfbddb565757aac171cef23ef7b3d66e4d9356`. Archived Leela subscriptions `ab7339d15f9b129ea126de3fd59add993b93fe2d007c372beb596d9adc62d80e`.

## Provider terms and attribution

| Source | Documented use | Verify before launch or raw publication |
|---|---|---|
| FIDE | The 2026 match regulations reserve commercial and media rights and exclusive internet live game transmission rights. [Regulations, §7.1–7.3](https://handbook.fide.com/files/handbook/FWCM2026.pdf#page=9) | Confirm coverage rights for this move-by-move programme and any required delay with the event rights holder. |
| Lichess | Subject to applicable licences and rate limits, Lichess permits personal and commercial service use. Published monthly official broadcast archives are CC BY-SA 4.0. The recorder makes serial PGN requests and waits a minute on HTTP 429. [Terms](https://lichess.org/terms-of-service) · [Broadcast archive](https://database.lichess.org/#broadcasts) · [API tips](https://lichess.org/page/api-tips) | Confirm the live round PGN's redistribution terms with the [broadcast team](https://lichess.org/broadcast/help). |
| Sesse | The deployed site credits Steinar H. Gunderson and Stockfish. The programme credits Sesse as the analysis source. [Sesse](https://analysis.sesse.net/) | Confirm on-air use, credit wording and raw packet redistribution with the maintainer. |
| Leela | LCZero permits use of the website's analysis results and graphics for livestream commentary, recaps and post-game analysis with credit to both the website and project. Include `LCZero · live.lczero.org` in the stream credits. [LCZero commentary grant](https://lczero.org/blog/2026/11/wcc-2026-game-1-lczero-live-analysis/) | Confirm ongoing automated socket use and raw packet redistribution. |

Keep deployed recordings private until the relevant redistribution terms are confirmed.

## Finished-game evidence

The recap uses the accepted mainline, a sourced PGN Opening tag when present, and eligible exact-root engine observations recorded during the selection. An analysis at the final root alone cannot produce a historical chart. Eligible historical Leela samples use the same verified deep root probabilities as the live picture.

A round whose source has verified per-move elapsed-time annotations can set `binding.elapsedTime` to `"pgn-emt"`. This requests PGN comments and reads one `[%emt H:MM:SS]` annotation per mainline position. The checked-in championship bindings leave it unset. The classical profile derives durations from recorded `%clk` anchors and the official time control.

## In-play screenshot simulation

Run `npm ci`, `npx playwright install --with-deps --no-shell chromium`, then `npm run screenshots:providers`. The browser test runs the replay CLI on the synthetic recording in `fixtures/provider-simulation.json` and feeds the decoded states to the programme renderer. The simulation uses ten-minute starting clocks and post-move clock annotations. Packet timestamps establish event order.

The seven numbered stages cover the bound position after 1.e4, independent search updates, both engines pending after 1…e5, Sesse returning first on a delta, both engines returning, the authority reconnecting and analysis recovering. The test checks that an intervening old-root Sesse delta advances the wire version without emitting analysis. It also checks stale Leela frames, SAN, clocks, per-source candidates and absence of unverified WDL. Node replay tests additionally cover a future-root Sesse update before the authority and a lost base during recovery.

**Provider simulation screenshots** runs on PRs targeting main, after merges to main, and on manual dispatch. Download the commit-labelled artifact from a successful workflow run. It contains fourteen provider-replay PNGs plus the stage snapshots in `stages.json`. The `statistics/` folder holds 24 [ordinary programme panel captures](evidence/phase-2/README.md) from the synthetic director fixture. Completed move time, evaluation history, Leela outcomes and search progress each have typical, missing-data and long-value views. The `scorecards/` folder shows the fixture programme with both evaluation bars and the player rows at full size and during a spotlight. The provider replay omits Leela WDL because its production calibration and aggregation remain unverified. All stills cover 1920 × 1080 and 1280 × 720. Artifacts are retained for 30 days. Local output is in `test-results/provider-screenshots/`. The deployed in-play checks above remain open.

The `videos/` folder contains five silent 1280 × 720 MP4 clips from the demo director. Clips 01 and 02 show the statistics rotation and full-game graphs. Their opening history and clocks are synthetic demo data. Clip 03 shows the synchronized spotlight entrance and exit with hypothetical moves two seconds apart. Clips 04 and 05 show a played move interrupting the spotlight and the time-used panel respectively. Both show one move reveal followed by engine recovery. The rehearsal compresses waits between cues and plays the programme's animations at normal speed. The local screenshot command saves the recordings as WebM. OBS sign-off remains a separate production check.
