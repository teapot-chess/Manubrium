// A team event's round, as matches: which boards belong to which match,
// who sits on which side of a board, and how a result reads between them.
//
// The server says all of it (`round.matches`, the tournament's
// `team_board_layout`); nothing here decides a rule. A server that predates
// matches sends none, and the round stays the flat list it always was.
//
// The one sum the phone does itself is the running score of a match while
// results wait in the outbox: the server cannot count what it has not been
// sent. It is marked as waiting on screen, and the server's own figure
// replaces it the moment the results arrive.

import type { Board, BoardPlayer, Match, MatchSide, Round, TeamBoardLayout, Tournament } from "./api";

/** A board of a match: the round's board, its number within the match, and the first-named team's colour on it. */
export interface MatchRow {
  board: Board;
  number: number;
  aWhite: boolean;
}

export interface MatchCard {
  match: Match;
  rows: MatchRow[];
}

/** The round as matches, and the boards no match claims. */
export interface MatchView {
  cards: MatchCard[];
  loose: Board[];
}

/** The layout the tournament asks for; a server that does not say gets each team on its own side. */
export function layoutOf(t: Pick<Tournament, "team_board_layout">): TeamBoardLayout {
  return t.team_board_layout === "white_left" ? "white_left" : "teams";
}

/**
 * The round's boards grouped by match, or null when the server sent no
 * matches (an individual event, or a server from before it knew how). A
 * board a match names that the round does not list is skipped; a board no
 * match names is `loose`.
 */
export function matchView(round: Round): MatchView | null {
  if (!Array.isArray(round.matches) || round.matches.length === 0) return null;
  const byId = new Map(round.boards.map((b) => [b.id, b]));
  const claimed = new Set<number>();
  const cards = round.matches.map((match) => ({
    match,
    rows: match.boards.flatMap((mb) => {
      const board = byId.get(mb.id);
      if (!board || claimed.has(mb.id)) return [];
      claimed.add(mb.id);
      return [{ board, number: mb.number, aWhite: mb.a_white }];
    }),
  }));
  return { cards, loose: round.boards.filter((b) => !claimed.has(b.id)) };
}

export interface Seat {
  player: BoardPlayer | null;
  colour: "w" | "b";
  team: MatchSide;
}

/**
 * Who is on the left and who on the right of a board. "teams": the
 * first-named team on the left on every board, so the colours down a
 * column alternate. "white_left": White on the left on every board, so the
 * teams do.
 */
export function seats(row: MatchRow, layout: TeamBoardLayout): { left: Seat; right: Seat } {
  const white: Seat = { player: row.board.white, colour: "w", team: row.aWhite ? "a" : "b" };
  const black: Seat = { player: row.board.black, colour: "b", team: row.aWhite ? "b" : "a" };
  return layout === "white_left" || row.aWhite ? { left: white, right: black } : { left: black, right: white };
}

/** One team's line-up, board 1 first: who sits where, and with which colour. */
export function lineup(card: MatchCard, side: MatchSide): { number: number; colour: "w" | "b"; player: BoardPlayer | null }[] {
  return card.rows.map((row) => {
    const white = (side === "a") === row.aWhite;
    return { number: row.number, colour: white ? "w" : "b", player: white ? row.board.white : row.board.black };
  });
}

const HALF = /^(1\/2|1|0|\+|-)-(1\/2|1|0|\+|-)(FF|U)?$/;

/**
 * A result code with its two halves changed places: "1-0" is "0-1" read
 * from Black's side of the board. A code that is not two scores (a
 * postponed game, something newer) is returned as it came.
 */
export function mirrorResult(code: string): string {
  const m = HALF.exec(code);
  return m ? `${m[2]}-${m[1]}${m[3] ?? ""}` : code;
}

/** The result as it reads between the two seats shown: the left seat's score first. */
export function resultBetween(code: string, leftIsWhite: boolean): string {
  return leftIsWhite ? code : mirrorResult(code);
}

export interface PointValues {
  win: number;
  draw: number;
  loss: number;
}

/** What a game is worth here, from the tournament's own settings; 1, ½, 0 when it does not say. */
export function pointValues(t: Pick<Tournament, "settings">): PointValues {
  const p = (t.settings?.points ?? {}) as Partial<Record<keyof PointValues, unknown>>;
  const n = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  return { win: n(p.win, 1), draw: n(p.draw, 0.5), loss: n(p.loss, 0) };
}

/** What a result gives White and Black; nothing for no result or a code that is not a score. */
export function boardPoints(code: string, values: PointValues): { white: number; black: number } {
  // A postponed game stands for a draw until it is played, as on the server.
  if (code.startsWith("*")) return { white: values.draw, black: values.draw };
  const m = HALF.exec(code);
  if (!m) return { white: 0, black: 0 };
  const worth = (half: string) => (half === "1" || half === "+" ? values.win : half === "1/2" ? values.draw : values.loss);
  return { white: worth(m[1]), black: worth(m[2]) };
}

export interface MatchScore {
  a: number;
  b: number;
  /** Null until every board has a result, and while a result of this match waits on the phone. */
  matchPoints: { a: number | null; b: number | null } | null;
  /** How many of this match's results are on the phone, not yet on the server. */
  waiting: number;
}

/**
 * The score a match card shows. The server's own, unless results of this
 * match wait in the outbox (`pending`: pairing id to the result waiting):
 * then each of them is counted in place of what the server holds for that
 * board, and the match points are held back until the server has spoken.
 */
export function matchScore(card: MatchCard, pending: Map<number, string>, values: PointValues): MatchScore {
  let { a, b } = card.match.game_points;
  let waiting = 0;
  for (const row of card.rows) {
    const next = pending.get(row.board.id);
    if (next === undefined || next === row.board.result) continue;
    waiting++;
    const before = boardPoints(row.board.result, values);
    const after = boardPoints(next, values);
    const white = after.white - before.white;
    const black = after.black - before.black;
    a += row.aWhite ? white : black;
    b += row.aWhite ? black : white;
  }
  return { a, b, matchPoints: waiting > 0 ? null : card.match.match_points, waiting };
}

/** Points as a scoresheet writes them: 1½, ½, 2. */
export function points(n: number): string {
  const whole = Math.trunc(n);
  const rest = Math.round((n - whole) * 100) / 100;
  if (rest === 0.5) return whole === 0 ? "½" : `${whole}½`;
  return String(Math.round(n * 100) / 100);
}

/** The matches whose line-ups still wait for somebody's word. */
export function unconfirmed(view: MatchView): MatchCard[] {
  return view.cards.filter((c) => !c.match.bye && !c.match.lineups.confirmed);
}
