import { count, line, list, object, type Game } from "./game.js";

// JSON-delta stanzas are [path, replacement] or [path] (deletion).
function patch(document: unknown, delta: unknown[]) {
  let copy = structuredClone(document);
  for (const stanza of delta) {
    const [path, replacement] = list(stanza);
    if (!Array.isArray(path) || ![1, 2].includes(list(stanza).length)) throw Error("Invalid stanza");
    const remove = list(stanza).length === 1;
    if (!path.length) {
      if (remove) throw Error("Missing replacement");
      copy = replacement;
      continue;
    }
    let parent = copy;
    for (const [index, key] of path.entries()) {
      const last = index === path.length - 1;
      if (Array.isArray(parent)) {
        if (count(key) === undefined || key >= parent.length + Number(last && !remove))
          throw Error("Invalid array index");
        if (!last) parent = parent[key];
        else if (remove) parent.splice(key, 1);
        else parent[key] = replacement;
      } else {
        const record = object(parent);
        if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key) ||
            ((!last || remove) && !Object.hasOwn(record, key))) throw Error("Invalid member");
        if (!last) parent = record[key];
        else if (remove) delete record[key];
        else record[key] = replacement;
      }
    }
  }
  return copy;
}

function score(value: unknown) {
  if (!Array.isArray(value)) return;
  const [kind, n, bound] = value;
  if (kind === "d" && n === null) return { unit: "tablebase-draw" as const };
  if (!Number.isSafeInteger(n) || ![undefined, "≥", "≤", ">=", "<="].includes(bound)) return;
  if (kind === "cp") return { unit: "pawns" as const, value: n / 100, bound };
  if (kind === "m") return { unit: "mate" as const, value: n, bound };
}

function searchCount(value: unknown) {
  return count(typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value);
}

function decode(raw: unknown, game: Game) {
  const data = object(raw), position = object(data.position);
  if (!game.white || !game.black || game.white === "?" || game.black === "?" ||
      position.player_w !== (game.binding.sessePlayers?.white ?? game.white) ||
      position.player_b !== (game.binding.sessePlayers?.black ?? game.black))
    throw Error("Unbound Sesse players");
  if (position.fen !== game.fen || JSON.stringify(position.history) !== JSON.stringify(game.moves))
    return;
  const candidate = (entry: Record<string, unknown>) => ({
    pv: line(game, list(entry.pv)), depth: searchCount(entry.depth), score: score(entry.score)
  });
  const alternatives = Object.values(object(data.refutation_lines ?? {})).map(v => candidate(object(v)));
  return { fen: game.fen, perspective: "white" as const, principal: candidate(data), alternatives, nodes: searchCount(data.nodes) };
}

export class SesseFullSnapshotRequired extends Error {}

// One instance per operator-verified game mapping. The transport version can
// advance while the provider and the authority are on different roots.
export class SesseReplay {
  private raw: unknown;
  private version?: string;
  lastWorkMs?: number;
  private fingerprint?: string;
  constructor(private game: Game) {}
  setGame(game: Game) {
    this.game = game;
    this.fingerprint = this.lastWorkMs = undefined;
  }
  disconnect() {
    this.raw = this.version = undefined;
  }
  receive(version: string, base: string | undefined, body: unknown, receivedMs: number) {
    try {
      const delta = Array.isArray(body);
      const duplicate = version === this.version;
      if (delta && !duplicate && (this.version === undefined || base !== this.version))
        throw new SesseFullSnapshotRequired("Full snapshot required");
      const raw = duplicate ? this.raw : delta ? patch(this.raw, body) : structuredClone(body);
      const observation = decode(raw, this.game);
      this.raw = raw;
      this.version = version;
      if (observation) {
        const fingerprint = JSON.stringify(observation);
        if (this.fingerprint !== fingerprint) this.lastWorkMs = receivedMs;
        this.fingerprint = fingerprint;
      }
      return observation;
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }
}
