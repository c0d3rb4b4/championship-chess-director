import type { BoardFrame } from "../shared/types.js";
import { pieceDefinitions } from "./pieces.js";

export function escape(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

// Use deterministic strokes instead of procedural noise so the grain stays fixed on every frame.
const silverGrain = Array.from({ length: 48 }, (_, i) => {
  const x = i * 2.1 + ((i * 13) % 11) * 0.096;
  const stroke = i % 3 === 0 ? "#fff" : "#48505a";
  return `<path d="M${x.toFixed(2)} 0v100" stroke="${stroke}" opacity="${(0.055 + (i % 5) * 0.018).toFixed(3)}"/>`;
}).join("");
const graphiteGrain = Array.from({ length: 31 }, (_, i) => {
  const x = i * 7 - 102;
  return `<path d="M${x} 100l100-100" stroke="${i % 3 === 0 ? "#111519" : "#aeb5b9"}" opacity="${i % 4 === 0 ? 0.18 : 0.08}"/>`;
}).join("");
const fasteners = [[6, 6], [94, 6], [6, 94], [94, 94]].map(([x, y]) =>
  `<circle cx="${x}" cy="${y}" r="1.9" fill="#e9edf1" stroke="#788188" stroke-width="0.8"/>`,
).join("");

function materials(id: string): string {
  return `<linearGradient id="${id}-plate">
    <stop stop-color="#afb5ba"/><stop offset=".44" stop-color="#e2e5e7"/><stop offset="1" stop-color="#c2c8cc"/>
  </linearGradient>
  <pattern id="${id}-silver" width="100" height="100" patternUnits="userSpaceOnUse">
    <rect width="100" height="100" fill="#c9ced2"/>
    <rect class="plate-sheen" width="100" height="100" fill="url(#${id}-plate)"/>
    <g class="plate-grain">${silverGrain}</g>
    <rect x=".45" y=".45" width="99.1" height="99.1" fill="none" stroke="#878f96" stroke-width=".9"/>
    <g class="plate-fasteners">${fasteners}</g>
  </pattern>
  <pattern id="${id}-graphite" width="100" height="100" patternUnits="userSpaceOnUse">
    <rect width="100" height="100" fill="#565d62"/>
    <g class="plate-grain">${graphiteGrain}</g>
    <rect x=".45" y=".45" width="99.1" height="99.1" fill="none" stroke="#40474b" stroke-width=".9"/>
  </pattern>`;
}

export function board(frame: BoardFrame, id: "actual" | "analysis"): string {
  let cells = "";
  let highlights = "";
  let coordinates = "";
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const file = String.fromCharCode(97 + col);
      const rank = 8 - row;
      const square = file + rank;
      const x = col * 100;
      const y = row * 100;
      const dark = (row + col) % 2 === 1;
      const material = dark ? "graphite" : "silver";
      const coordinateInk = dark ? "#f2f5f7" : "#29363f";
      cells += `<rect x="${x}" y="${y}" width="100" height="100" fill="url(#${id}-${material})"/>`;
      if (square === frame.from || square === frame.to) {
        highlights += `<g data-last-move-square="${square}" data-material="${material}">
          <rect x="${x}" y="${y}" width="100" height="100" fill="${dark ? "#6f93ae" : "#7194af"}" opacity=".54"/>
          <rect x="${x + 1.5}" y="${y + 1.5}" width="97" height="97" fill="none" stroke="${dark ? "#a5bdd0" : "#526f84"}" stroke-width="2"/>
        </g>`;
      }
      if (col === 0)
        coordinates += `<text x="5" y="${y + 21}" class="coord" fill="${coordinateInk}">${rank}</text>`;
      if (row === 7)
        coordinates += `<text x="${x + 95}" y="794" text-anchor="end" class="coord" fill="${coordinateInk}">${file}</text>`;
    }
  }
  const pieces = frame.pieces.map((piece) => {
    const x = (piece.square.charCodeAt(0) - 97) * 100;
    const y = (8 - Number(piece.square[1])) * 100;
    return `<use href="#${id}-${piece.color}${escape(piece.type)}" transform="translate(${x + 4} ${y + 4}) scale(.92)"/>`;
  }).join("");
  return `<svg class="chessboard" data-testid="${id}-board" data-fen="${escape(frame.fen)}" viewBox="0 0 800 800" role="img" aria-label="${id === "actual" ? "Actual game" : "Hypothetical analysis"} board after ${escape(frame.moveLabel)}"><defs>${materials(id)}${pieceDefinitions(id)}</defs>${cells}${highlights}${pieces}${coordinates}</svg>`;
}
