// A player's requested byes. Rounds already paired are history and only
// shown; the rest can be asked for, changed or dropped. Which kind of bye
// counts for what is the server's business - it names the kinds, this only
// keeps the list straight.

import type { Bye, Player, Tournament } from "./api";
import { t as tr } from "./i18n";

const BYE_LABELS = {
  absent: "pe.bye.absent",
  "requested-half": "pe.bye.requested-half",
  "requested-zero": "pe.bye.requested-zero",
  "full-point": "pe.bye.full-point",
} as const;

/** A bye's kind as the server spells it, in the app's language; a kind we do not know stays as the server wrote it. */
export function byeLabel(kind: string): string {
  return Object.hasOwn(BYE_LABELS, kind) ? tr(BYE_LABELS[kind as keyof typeof BYE_LABELS]) : kind;
}

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

/**
 * The next round to be paired, or null when there is none: every round is
 * paired (a round robin pairs them all at once) or the tournament does not
 * say how many it has.
 */
export function nextRound(t: Pick<Tournament, "paired_rounds" | "rounds_count">): number | null {
  const next = t.paired_rounds + 1;
  return t.rounds_count != null && next <= t.rounds_count ? next : null;
}

/**
 * Whether this phone may offer "will not play the next round" for a player:
 * an account that changes players, a tournament that can still change, a
 * server that names its bye kinds, a player still in the event. Whether the
 * bye is then given is the server's decision, not this function's.
 */
export function canSitOut(t: Pick<Tournament, "can" | "read_only" | "bye_kinds" | "paired_rounds" | "rounds_count">, player: Pick<Player, "status" | "byes">): boolean {
  return (
    t.can.includes("players") &&
    !t.read_only &&
    (t.bye_kinds?.length ?? 0) > 0 &&
    Array.isArray(player.byes) &&
    player.status === "active" &&
    nextRound(t) !== null
  );
}
