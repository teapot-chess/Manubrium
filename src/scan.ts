// The codes OpenPairings prints on result slips and place cards
// (`PairingsEngineWeb.PrintQr`, docs/printing.md "Scan codes"):
//
//   OP1:B:<tournament id>:<round>:<pairing id>   a result slip
//   OP1:P:<tournament id>:<player id>            a place card
//
// Anything else - a connect link, a web address, a supermarket loyalty
// card - is "not a slip", and the app says so instead of guessing.

import type { Round } from "./api";

export type Scanned =
  | { kind: "board"; tournament: number; round: number; pairing: number }
  | { kind: "player"; tournament: number; player: number };

export function parseScan(text: string | null | undefined): Scanned | null {
  const s = (text ?? "").trim().toUpperCase();
  let m = /^OP1:B:(\d{1,10}):(\d{1,4}):(\d{1,12})$/.exec(s);
  if (m) return { kind: "board", tournament: Number(m[1]), round: Number(m[2]), pairing: Number(m[3]) };
  m = /^OP1:P:(\d{1,10}):(\d{1,12})$/.exec(s);
  if (m) return { kind: "player", tournament: Number(m[1]), player: Number(m[2]) };
  return null;
}

/** The board a player sits at in `round`, or null (a bye, not paired, not in it). */
export function boardOf(round: Round, player: number) {
  return round.boards.find((b) => !b.bye && (b.white?.id === player || b.black?.id === player)) ?? null;
}
