// Collect timing evidence from accepted replay packets without copying provider payloads.
export class ProviderCoverage {
  current;
  previous;
  pending = {};
  evidence = {
    authority: { snapshotAt: null, idleAt: null, recovered: null },
    sesse: { snapshotAt: null, idleAt: null, workAt: null, recovered: null },
    leela: { snapshotAt: null, idleAt: null, workAt: null, recovered: null },
    sharedMove: null,
    clockedSharedMove: null,
  };

  disconnect({ source, receivedMs, initiatedBy }) {
    this.pending[source] ??= {
      disconnectedAt: receivedMs,
      ...(initiatedBy === "operator" ? { initiatedBy } : {}),
    };
    if (source === "authority") this.current = this.previous = undefined;
    else this.clearEngine(source);
  }

  clearEngine(source) {
    if (source === "sesse") {
      this.current.sesseAt = null;
      this.current.sesseNodes = undefined;
    } else {
      this.current.leelaAt = null;
      this.current.leelaNodes.clear();
    }
  }

  authority(game, at) {
    this.evidence.authority.snapshotAt ??= at;
    const current = this.current;
    const sameHistory = current && sameMoves(current.game.moves, game.moves);
    const extendsByOne = current && game.moves.length === current.game.moves.length + 1 &&
      sameMoves(current.game.moves, game.moves.slice(0, -1));

    if (sameHistory && game.result === current.game.result) {
      if (at > current.at) this.evidence.authority.idleAt ??= at;
      current.game = game;
      current.clock ??= clockEvidence(game, at);
    } else {
      this.previous = extendsByOne && !current.game.result && !game.result ? current : undefined;
      this.current = {
        game, at, clock: clockEvidence(game, at), sesseAt: null, leelaAt: null,
        sesseNodes: undefined, leelaNodes: new Map(),
      };
    }
    this.checkSharedRoot();
  }

  sesse(packet, observation) {
    const { receivedMs: at, body } = packet;
    if (Array.isArray(body) && body.length === 0) this.evidence.sesse.idleAt ??= at;
    if (!observation) return;
    if (!Array.isArray(body)) {
      this.evidence.sesse.snapshotAt ??= at;
      this.recover("sesse", at);
    }
    if (!this.current.game.result &&
        observation.nodes !== undefined && this.current.sesseNodes !== undefined &&
        observation.nodes > this.current.sesseNodes) this.evidence.sesse.workAt ??= at;
    this.current.sesseNodes = observation.nodes;
    this.current.sesseAt ??= at;
    this.checkSharedRoot();
  }

  leela(packet, observation) {
    const { receivedMs: at, body } = packet;
    if (observation && body.status && !body.positions?.length && !body.evaluations?.length)
      this.evidence.leela.idleAt ??= at;
    if (!observation) {
      this.clearEngine("leela");
      return;
    }
    if (!observation.candidates.length) return;
    this.evidence.leela.snapshotAt ??= at;
    this.recover("leela", at);
    for (const candidate of observation.candidates) {
      const firstMove = candidate.pv[0];
      const previousNodes = this.current.leelaNodes.get(firstMove);
      if (!this.current.game.result && previousNodes !== undefined && candidate.nodes > previousNodes)
        this.evidence.leela.workAt ??= at;
      this.current.leelaNodes.set(firstMove, candidate.nodes);
    }
    this.current.leelaAt ??= at;
    this.checkSharedRoot();
  }

  recover(source, at) {
    if (this.pending[source] === undefined) return;
    this.evidence[source].recovered ??= { ...this.pending[source], recoveredAt: at };
    delete this.pending[source];
  }

  checkSharedRoot() {
    const after = this.current;
    if (!hasBothEngines(after)) return;
    this.recover("authority", Math.max(after.at, after.sesseAt, after.leelaAt));
    const before = this.previous;
    if (!hasBothEngines(before)) return;
    const move = {
      before: rootEvidence(before),
      after: rootEvidence(after),
    };
    this.evidence.sharedMove ??= move;
    if (before.clock && after.clock) this.evidence.clockedSharedMove ??= {
      before: { ...move.before, clock: before.clock },
      after: { ...move.after, clock: after.clock },
    };
  }

  report() {
    const { authority, sesse, leela, sharedMove, clockedSharedMove } = this.evidence;
    const pending = [];
    for (const [source, evidence] of Object.entries({ authority, sesse, leela })) {
      if (evidence.snapshotAt === null) pending.push(`${source}: full snapshot`);
      if (evidence.idleAt === null) pending.push(`${source}: idle traffic`);
      if (evidence.workAt === null) pending.push(`${source}: in-play search work update`);
      if (evidence.recovered === null) pending.push(`${source}: disconnect and recovery`);
    }
    if (!sharedMove) pending.push("both engines before and after one in-play move");
    if (!clockedSharedMove) pending.push("post-move clock samples on both sides of a shared move");
    return { evidence: this.evidence, pending };
  }
}

function sameMoves(a, b) {
  return a.length === b.length && a.every((move, i) => move === b[i]);
}

function hasBothEngines(root) {
  return root && root.sesseAt !== null && root.leelaAt !== null;
}

function clockEvidence(game, at) {
  const clock = game.clocks.find(clock => clock.fen === game.fen);
  return clock && { receivedMs: at, seconds: clock.seconds };
}

function rootEvidence({ game, at, sesseAt, leelaAt }) {
  return { ply: game.moves.length, authorityAt: at, sesseAt, leelaAt };
}
