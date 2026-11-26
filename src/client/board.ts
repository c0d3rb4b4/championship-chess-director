import type { BoardFrame } from "../shared/types.js";

export function escape(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
const glyphs: Record<string, string> = {
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};
export function board(frame: BoardFrame, id: "actual" | "analysis"): string {
  let cells = "";
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 8; col++) {
      const square = `${String.fromCharCode(97 + col)}${8 - row}`;
      const dark = (row + col) % 2 === 1;
      const highlighted = square === frame.from || square === frame.to;
      cells += `<rect x="${col * 100}" y="${row * 100}" width="100" height="100" fill="${highlighted ? (dark ? "#b5aa53" : "#e9dd83") : dark ? "#ae805e" : "#f0d9b5"}"/>`;
      if (col === 0)
        cells += `<text x="6" y="${row * 100 + 18}" class="coord" fill="${dark ? "#211a15" : "#4c3524"}">${8 - row}</text>`;
      if (row === 7)
        cells += `<text x="${col * 100 + 84}" y="794" class="coord" fill="${dark ? "#211a15" : "#4c3524"}">${String.fromCharCode(97 + col)}</text>`;
    }
  const pieces = frame.pieces
    .map((p) => {
      const col = p.square.charCodeAt(0) - 97;
      const row = 8 - Number(p.square[1]);
      return `<text x="${col * 100 + 50}" y="${row * 100 + 79}" text-anchor="middle" class="piece ${p.color === "w" ? "white-piece" : "black-piece"}">${glyphs[p.type]}</text>`;
    })
    .join("");
  return `<svg class="chessboard" data-testid="${id}-board" data-fen="${escape(frame.fen)}" viewBox="0 0 800 800" role="img" aria-label="${id === "actual" ? "Actual game" : "Hypothetical analysis"} board after ${escape(frame.moveLabel)}">${cells}${pieces}</svg>`;
}
