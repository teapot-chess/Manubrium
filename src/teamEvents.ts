// What the phone works out for itself in a team event, and nothing else:
// the line-up editor's preview of who ends up on which board, the choice
// of rounds a team may still be changed in, and the scores a match can end
// on. The server decides every rule; these only draw what a tick or a
// choice will do before it is sent, and the server's own answer replaces
// the preview.

import type { EventTeam, LineupFinding, LineupRosterPlayer, LineupsBody, MatchLineup, Seats, Tournament } from "./api";

/**
 * The line-up that follows from who sits out: the roster in board order,
 * minus `out` and anyone not available, cut to the match size and padded
 * with empty seats. The server does the same sum (`lineup_without`) and has
 * the last word.
 */
export function seatsFromOut(roster: LineupRosterPlayer[], out: ReadonlySet<number>, boards: number): Seats {
  const ids = roster
    .filter((p) => p.available && !out.has(p.id))
    .slice(0, boards)
    .map((p) => p.id);
  return Array.from({ length: boards }, (_, i) => ids[i] ?? null);
}

/** Who sits out of a line-up as it stands: the available players it does not seat. */
export function outFromSeats(roster: LineupRosterPlayer[], seated: Seats): Set<number> {
  const playing = new Set(seated.filter((s): s is number => s !== null));
  return new Set(roster.filter((p) => p.available && !playing.has(p.id)).map((p) => p.id));
}

/** The editor's two drafts as the body the server takes, for either mode. */
export function lineupBody(mode: MatchLineup["mode"], draft: { a: Seats; b: Seats; outA: ReadonlySet<number>; outB: ReadonlySet<number> }): LineupsBody {
  return mode === "ticks" ? { out: { a: [...draft.outA], b: [...draft.outB] } } : { a: draft.a, b: draft.b };
}

/** Whether a draft differs from the saved line-up, in either mode. */
export function lineupChanged(lineup: MatchLineup, draft: { a: Seats; b: Seats; outA: ReadonlySet<number>; outB: ReadonlySet<number> }): boolean {
  const a = lineup.mode === "ticks" ? seatsFromOut(lineup.roster_a, draft.outA, lineup.boards) : draft.a;
  const b = lineup.mode === "ticks" ? seatsFromOut(lineup.roster_b, draft.outB, lineup.boards) : draft.b;
  const same = (x: Seats, y: Seats) => x.length === y.length && x.every((v, i) => v === y[i]);
  return !same(a, lineup.a) || !same(b, lineup.b);
}

/** Findings with the violations first, in the order the plug-in gave them otherwise. */
export function sortFindings(findings: LineupFinding[]): LineupFinding[] {
  const rank = (f: LineupFinding) => (f.severity === "violation" ? 0 : 1);
  return findings.map((f, i) => ({ f, i })).sort((x, y) => rank(x.f) - rank(y.f) || x.i - y.i).map((x) => x.f);
}

/**
 * The rounds a team can still be withdrawn from: the round in play and the
 * next one to pair, within the event. The server refuses what is out of
 * reach; this is the sensible short list.
 */
export function withdrawRounds(t: Pick<Tournament, "paired_rounds" | "rounds_count">): number[] {
  const next = t.paired_rounds + 1;
  const last = t.rounds_count ? Math.min(next, t.rounds_count) : next;
  const first = Math.max(1, Math.min(t.paired_rounds, last));
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

/** The rounds not yet paired, which a team may sit out. */
export function futureRounds(t: Pick<Tournament, "paired_rounds" | "rounds_count">): number[] {
  const last = t.rounds_count ?? t.paired_rounds + 1;
  return Array.from({ length: Math.max(0, last - t.paired_rounds) }, (_, i) => t.paired_rounds + 1 + i);
}

/** A team's status in a round it has not played yet. */
export function roundStatus(team: Pick<EventTeam, "rounds">, round: number): "plays" | "absent" | "half_bye" {
  return team.rounds.find((r) => r.round === round)?.status ?? "plays";
}

/** What a team's match score can be in `boards`: 0 to the boards, in halves. */
export function scoreChoices(boards: number): number[] {
  return Array.from({ length: boards * 2 + 1 }, (_, i) => i / 2);
}

/** The other side's share of a match score: the two must add up to the boards. */
export function otherScore(boards: number, score: number): number {
  return Math.max(0, boards - score);
}
