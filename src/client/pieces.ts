// Original artwork drawn for this project on a 100 × 100 square.
// Both colours share the silhouette; the ink and interior cuts change with the side.
const artwork = {
  p: {
    body: '<path d="M22 86C20 71 27 59 40 53C30 49 28 34 44 28C35 21 40 11 50 11C60 11 65 21 56 28C72 34 70 49 60 53C73 59 80 71 78 86Z"/>',
    detail: "",
  },
  n: {
    body: '<path d="M23 21L20 9Q29 10 37 20L43 9Q51 12 54 22C73 24 89 46 90 86H33C33 73 41 63 52 53Q43 63 31 64L25 71Q20 73 12 66L9 60Q11 53 18 43L21 32Z"/>',
    detail: '<path d="M56 28C75 36 82 59 83 83M53 44Q53 51 49 55M26 38C26 36 28 34 30 35C30 37 28 39 26 38ZM17 60L18 57"/>',
  },
  b: {
    body: '<circle cx="50" cy="13" r="5.5"/><path d="M50 20C40 28 27 34 28 46Q28 54 36 61L32 72Q50 78 68 72L64 61Q72 54 72 46C73 34 60 28 50 20Z"/><path d="M50 74C45 82 33 80 26 79Q18 78 12 82L17 90C25 84 41 94 50 81C59 94 75 84 83 90L88 82Q82 78 74 79C67 80 55 82 50 74Z"/>',
    detail: '<path d="M50 35V51M42 43H58M36 61Q50 57 64 61M34 69Q50 66 66 69"/>',
  },
  r: {
    body: '<path d="M23 19H36V26H44V19H56V26H64V19H77V33L68 42V63L76 70V78H82V87H18V78H24V70L32 63V42L23 33Z"/>',
    detail: '<path d="M24 33H76M32 42H68M32 63H68M25 71H75M24 78H76"/>',
  },
  q: {
    body: '<path d="M14 33L31 55L31 24L43 52L50 21L57 52L69 24L69 55L86 33L78 63Q74 68 73 75L78 85Q50 93 22 85L27 75Q26 68 22 63Z"/><circle cx="13" cy="29" r="4.5"/><circle cx="30" cy="20" r="4.5"/><circle cx="50" cy="16" r="4.5"/><circle cx="70" cy="20" r="4.5"/><circle cx="87" cy="29" r="4.5"/>',
    detail: '<path d="M22 63Q50 55 78 63M26 71Q50 64 74 71M26 79Q50 72 74 79"/>',
  },
  k: {
    body: '<path d="M50 53C37 25 15 31 12 46C9 57 19 63 26 68L28 76L24 85Q50 93 76 85L72 76L74 68C81 63 91 57 88 46C85 31 63 25 50 53Z"/><path d="M43 39C35 26 44 21 50 22C56 21 65 26 57 39L50 53Z"/>',
    detail: '<path d="M26 68Q50 59 74 68M28 76Q50 68 72 76M26 83Q50 75 74 83"/>',
    cross: '<path d="M50 7V23M44 13H56"/>',
  },
};

export function pieceDefinitions(prefix: string): string {
  return Object.entries(artwork).map(([type, piece]) =>
    (["w", "b"] as const).map((side) => {
      const white = side === "w";
      const ink = white ? "#131619" : "#f3f5f7";
      const body = white ? "#fff" : "#121416";
      const outline = white ? ink : "#a5aeb4";
      const cross = "cross" in piece
        ? `<g stroke="${white ? ink : outline}" stroke-width="${white ? 4 : 6}">${piece.cross}</g>${white ? "" : `<g stroke="${body}" stroke-width="3.6">${piece.cross}</g>`}`
        : "";
      return `<g id="${prefix}-${side}${type}" stroke-linecap="round" stroke-linejoin="round">
        ${cross}
        <g fill="${body}" stroke="${outline}" stroke-width="${white ? 4 : 1.6}">${piece.body}</g>
        <g fill="none" stroke="${ink}" stroke-width="${white ? 3 : 3.6}">${piece.detail}</g>
      </g>`;
    }).join(""),
  ).join("");
}
