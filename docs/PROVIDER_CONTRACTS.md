# Phase 3 provider replay

M0 is open. On 26 November 2026 the deployment endpoints could not be reached for a packet capture from the development host. No event PGN endpoint or verified event-to-provider game mapping was configured. The checked-in example is original synthetic data. The production event, round, deployed revisions, capture dates and redistribution permissions remain unverified.

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
3. Wrap the chronological observations using the example envelope. For Sesse, base is the request's version and version is the response's X-RGLM. Record disconnect events for Sesse and Leela. After an authority move prefix changes, supply a fresh Sesse snapshot and a new Leela subscription plus matching position. Retain original transport logs alongside the replay for timing and authority availability review.
4. Replay twice and compare the emitted observations with the captured game, both advertised analyses and the original transport log. Verify result and clock convention, Sesse score and depth per line, Leela WDL source and denominator, and delayed frames across reconnects. Record unsupported fields individually. M0 closes after successful observed replay. OBS and viewer gates belong to Phase 6.
