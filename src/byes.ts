// A player's requested byes. Rounds already paired are history and only
// shown; the rest can be asked for, changed or dropped. Which kind of bye
// counts for what is the server's business - it names the kinds, this only
// keeps the list straight.

import type { Bye } from "./api";

export interface ByeRow {
  round: number;
  /** The kind asked for, or null for "plays". */
  kind: string | null;
  /** Paired already: shown, not changed. */
  locked: boolean;
}

/** One row per round of the tournament, the paired ones locked. */
export function byeRows(roundsCount: number, pairedRounds: number, byes: Bye[]): ByeRow[] {
  const byRound = new Map(byes.map((b) => [b.round, b.kind]));
  const last = Math.max(roundsCount, ...byes.map((b) => b.round), 0);
  return Array.from({ length: last }, (_, i) => {
    const round = i + 1;
    return { round, kind: byRound.get(round) ?? null, locked: round <= pairedRounds };
  });
}

/** The list with `round` set to `kind`, or dropped when `kind` is null. Paired rounds do not move. */
export function setBye(byes: Bye[], round: number, kind: string | null, pairedRounds: number): Bye[] {
  if (round <= pairedRounds) return byes;
  const rest = byes.filter((b) => b.round !== round);
  return (kind ? [...rest, { round, kind }] : rest).sort((a, b) => a.round - b.round);
}

/** What `PUT /byes` gets: the requested byes for the rounds not paired yet. */
export function byesToSend(byes: Bye[], pairedRounds: number): Bye[] {
  return byes.filter((b) => b.round > pairedRounds).sort((a, b) => a.round - b.round);
}

/** Whether the unpaired rounds' byes differ from what the server has. */
export function byesChanged(before: Bye[], after: Bye[], pairedRounds: number): boolean {
  const key = (list: Bye[]) => JSON.stringify(byesToSend(list, pairedRounds).map((b) => [b.round, b.kind]));
  return key(before) !== key(after);
}
