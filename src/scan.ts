// The codes OpenPairings prints on result slips and place cards
// (`PairingsEngineWeb.PrintQr`, docs/printing.md "Scan codes"):
//
//   OP1:B:<tournament id>:<round>:<pairing id>    a result slip
//   OP1:P:<tournament id>:<player id>             a place card
//   OP2:B:<tournament id>:<round>:<pairing uid>   the same, rows by uid
//   OP2:P:<tournament id>:<player uid>            (a relayed tournament)
//
// A uid is 24 lowercase hex, the same row on every copy of a tournament.
// An id belongs to one database, and a relayed tournament has two: the
// cloud's and the laptop's, with different ids for the same board. So on a
// relayed tournament an OP1 slip opens nothing - the round on screen may be
// either copy's, and a board opened by the wrong copy's id is somebody
// else's game. The arbiter reprints, or picks the board by hand.
//
// A team match slip or match sheet (OpenPairings' `PairingsEngineWeb.MatchLink`,
// printed for an account with "Scan team match slips" on) carries a link
// instead, because a phone's own camera is meant to open it too:
//
//   <base>/t/<tournament id>/scan/<round>/<match id>[?m=<match uid>]
//   <base>/t/<tournament id>/pairings/<round>/matches/<match id>   (the page itself)
//
// Only the path counts: the address in front is whichever one the slip was
// printed on, and a desktop copy prints its loopback. The uid came later and
// is what a relayed tournament needs, for the reason above; a link without
// one opens nothing there.
//
// Anything else - a connect link, a web address, a supermarket loyalty
// card - is "not a slip", and the app says so instead of guessing.

import { sameRow, type Match, type Ref, type Round } from "./api";

export type Scanned =
  | { kind: "board"; tournament: number; round: number; pairing: Ref }
  | { kind: "player"; tournament: number; player: Ref }
  | { kind: "match"; tournament: number; round: number; match: number; uid: string | null };

const MATCH_LINK = /\/t\/(\d{1,9})\/(?:scan\/(\d{1,4})|pairings\/(\d{1,4})\/matches)\/(\d{1,9})\/?(?:[?#](.*))?$/i;

function matchLink(s: string): Scanned | null {
  if (!/^https?:\/\//i.test(s)) return null;
  const m = MATCH_LINK.exec(s);
  if (!m) return null;
  const uid = /(?:^|[?&#])m=([0-9a-f]{24})(?:[&#]|$)/i.exec(m[5] ?? "");
  return {
    kind: "match",
    tournament: Number(m[1]),
    round: Number(m[2] ?? m[3]),
    match: Number(m[4]),
    uid: uid ? uid[1].toLowerCase() : null,
  };
}

export function parseScan(text: string | null | undefined): Scanned | null {
  const s = (text ?? "").trim();
  let m = /^OP1:B:(\d{1,10}):(\d{1,4}):(\d{1,12})$/i.exec(s);
  if (m) return { kind: "board", tournament: Number(m[1]), round: Number(m[2]), pairing: Number(m[3]) };
  m = /^OP1:P:(\d{1,10}):(\d{1,12})$/i.exec(s);
  if (m) return { kind: "player", tournament: Number(m[1]), player: Number(m[2]) };
  // A scanner may hand the text back in capitals; a uid is compared in lower case.
  m = /^OP2:B:(\d{1,10}):(\d{1,4}):([0-9a-f]{24})$/i.exec(s);
  if (m) return { kind: "board", tournament: Number(m[1]), round: Number(m[2]), pairing: m[3].toLowerCase() };
  m = /^OP2:P:(\d{1,10}):([0-9a-f]{24})$/i.exec(s);
  if (m) return { kind: "player", tournament: Number(m[1]), player: m[2].toLowerCase() };
  return matchLink(s);
}

/** What a scanned code opens in this tournament, or why it opens nothing. */
export type SlipTarget =
  | { kind: "board"; round: number; pairing: Ref }
  | { kind: "player"; player: Ref }
  /** A team match: by uid where the link has one, by id only where ids are safe (`byId`: not relayed). */
  | { kind: "match"; round: number; match: number; uid: string | null; byId: boolean }
  | { kind: "refused"; reason: "not_a_slip" | "other_tournament" | "old_print" };

/**
 * Whose slip it is. `t.id` is the cloud's id for the tournament; a relayed
 * tournament's laptop prints its own (`relay.hall.tournament_id`), and
 * either is this tournament.
 */
export function slipTarget(
  code: Scanned | null,
  t: { id: number; relay?: { hall?: { tournament_id: number } | null } | null },
): SlipTarget {
  if (!code) return { kind: "refused", reason: "not_a_slip" };
  const relayed = !!t.relay;
  const laptopId = t.relay?.hall?.tournament_id ?? null;
  const ref = code.kind === "board" ? code.pairing : code.kind === "player" ? code.player : (code.uid ?? code.match);
  // A relayed tournament whose laptop has not said its own id (no hall path
  // right now): a uid slip may still be the laptop's, and a uid cannot open
  // another tournament's board - it is in this round or it is not.
  const unsure = relayed && laptopId === null && typeof ref === "string";
  if (code.tournament !== t.id && code.tournament !== laptopId && !unsure) return { kind: "refused", reason: "other_tournament" };
  if (relayed && typeof ref === "number") return { kind: "refused", reason: "old_print" };
  if (code.kind === "match") return { kind: "match", round: code.round, match: code.match, uid: code.uid, byId: !relayed };
  return code.kind === "board" ? { kind: "board", round: code.round, pairing: code.pairing } : { kind: "player", player: code.player };
}

/** The board a slip names in `round`, by id or uid; null when it is not there. */
export function boardIn(round: Round, pairing: Ref) {
  return round.boards.find((b) => sameRow(pairing, b)) ?? null;
}

/** The board a player sits at in `round`, or null (a bye, not paired, not in it). */
export function boardOf(round: Round, player: Ref) {
  return round.boards.find((b) => !b.bye && (sameRow(player, b.white) || sameRow(player, b.black))) ?? null;
}

/**
 * The match a scanned match link names in `round`, or null. By uid first;
 * by id only where the slip's ids are this copy's (`byId`), which also
 * covers a server too old to send match uids.
 */
export function matchIn(round: Round, target: { match: number; uid: string | null; byId: boolean }): Match | null {
  const matches = round.matches ?? [];
  if (target.uid) {
    const found = matches.find((m) => m.uid === target.uid);
    if (found || matches.some((m) => m.uid)) return found ?? null;
  }
  return target.byId ? (matches.find((m) => m.id === target.match) ?? null) : null;
}
