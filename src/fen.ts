// FEN, as far as a phone needs it: the 64 squares to draw, and whether a
// position typed by an arbiter is worth sending to a box at all. Not a move
// generator; the box's tracker is the one that says yes or no to a position.

export type Piece = "K" | "Q" | "R" | "B" | "N" | "P" | "k" | "q" | "r" | "b" | "n" | "p";

/** 64 squares, a8 first, h1 last (the FEN's own order); null for an empty square. */
export type Squares = (Piece | null)[];

const PIECES = "KQRBNPkqrbnp";

/** The squares of a FEN's first field; null when it is not eight ranks of eight. */
export function parseFen(fen: string | null | undefined): Squares | null {
  if (!fen) return null;
  const placement = fen.trim().split(/\s+/)[0];
  const ranks = placement.split("/");
  if (ranks.length !== 8) return null;
  const out: Squares = [];
  for (const rank of ranks) {
    let width = 0;
    for (const ch of rank) {
      if (ch >= "1" && ch <= "8") {
        const n = Number(ch);
        for (let i = 0; i < n; i++) out.push(null);
        width += n;
      } else if (PIECES.includes(ch)) {
        out.push(ch as Piece);
        width += 1;
      } else {
        return null;
      }
    }
    if (width !== 8) return null;
  }
  return out;
}

/** "e4" to its index in Squares (a8 = 0). */
export function squareIndex(square: string): number {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  return (8 - rank) * 8 + file;
}

/** The name of a square by index ("a8" for 0). */
export function squareName(index: number): string {
  return `${String.fromCharCode(97 + (index % 8))}${8 - Math.floor(index / 8)}`;
}

/** The two squares of a from-to move ("e7e5", "e7e8q"); null for anything else. */
export function moveSquares(move: string | null | undefined): [number, number] | null {
  if (!move || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return null;
  return [squareIndex(move.slice(0, 2)), squareIndex(move.slice(2, 4))];
}

export type FenProblem = "empty" | "fields" | "placement" | "kings" | "pawns" | "side" | "castling" | "en_passant" | "counters";

/**
 * What is wrong with a typed FEN, or null when it looks like a position.
 * Only the placement is required; the other fields, when given, must be
 * well formed. One king a side, no pawn on the first or last rank.
 */
export function fenProblem(fen: string): FenProblem | null {
  const text = fen.trim();
  if (!text) return "empty";
  const fields = text.split(/\s+/);
  if (fields.length > 6) return "fields";
  const squares = parseFen(fields[0]);
  if (!squares) return "placement";
  if (squares.filter((p) => p === "K").length !== 1 || squares.filter((p) => p === "k").length !== 1) return "kings";
  if ([...squares.slice(0, 8), ...squares.slice(56)].some((p) => p === "P" || p === "p")) return "pawns";
  const [, side, castling, ep, half, full] = fields;
  if (side !== undefined && side !== "w" && side !== "b") return "side";
  if (castling !== undefined && !/^(-|K?Q?k?q?)$/.test(castling)) return "castling";
  if (castling === "") return "castling";
  if (ep !== undefined && !/^(-|[a-h][36])$/.test(ep)) return "en_passant";
  if (half !== undefined && !/^\d+$/.test(half)) return "counters";
  if (full !== undefined && !/^[1-9]\d*$/.test(full)) return "counters";
  return null;
}

/** A typed FEN completed to six fields, as a box wants it ("w - - 0 1" filled in). */
export function completeFen(fen: string): string {
  const fields = fen.trim().split(/\s+/);
  const defaults = ["", "w", "-", "-", "0", "1"];
  return defaults.map((d, i) => fields[i] ?? d).join(" ");
}

// The filled glyphs for both sides, coloured by CSS, with U+FE0E so no phone
// turns the black pawn into an emoji.
const GLYPH: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

export function pieceGlyph(piece: Piece): string {
  return `${GLYPH[piece.toLowerCase()]}︎`;
}

export const isWhite = (piece: Piece) => piece === piece.toUpperCase();
