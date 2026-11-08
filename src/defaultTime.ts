// The default time (FIDE Laws 6.7): how long a player may be late before
// the game is lost. The server does not know it - OpenPairings keeps the rate
// of play, not the default time, and the Laws make it zero unless the
// event's regulations say otherwise - so the arbiter enters it, once per
// tournament, and the phone remembers it.
//
// The list: the boards of the current round where somebody has not turned
// up. A board is on it while it has no result and nothing says the game
// began (a hall board seeing moves or a finished game), and either a player
// on it is not checked in, or the hall board reports it still set up.
// Boards the arbiter has seen running can be taken off by hand.

import type { Board, Round } from "./api";
import type { KeyValue } from "./queue";

export const DEFAULT_MINUTES = 30;
export const MINUTES_MAX = 240;

export type Side = "white" | "black";

export interface Waiting {
  board: Board;
  /** The sides not checked in. Empty when only the hall board says nothing has moved. */
  missing: Side[];
}

/** Whether something says the game on `b` is under way or over. */
export function started(b: Board): boolean {
  if (b.result) return true;
  const r = b.board_report;
  if (!r) return false;
  return r.status === "live" || r.status === "finished" || !!r.result || (r.moves_count ?? 0) > 0;
}

/**
 * The boards still waiting for somebody. `present` is the check-in by
 * player id (null when the server could not say); `cleared` the boards the
 * arbiter took off the list by hand.
 */
export function waitingBoards(round: Round, present: Map<number, boolean> | null, cleared: ReadonlySet<number> = new Set()): Waiting[] {
  const out: Waiting[] = [];
  for (const b of round.boards) {
    if (b.bye || b.vacant || b.empty || !b.white || !b.black) continue;
    if (started(b) || cleared.has(b.id)) continue;
    const missing: Side[] = [];
    if (present?.get(b.white.id) === false) missing.push("white");
    if (present?.get(b.black.id) === false) missing.push("black");
    if (missing.length > 0 || b.board_report?.status === "waiting") out.push({ board: b, missing });
  }
  return out;
}

/**
 * The forfeit result for the sides missing, if the server takes it: White
 * missing loses (0-1FF), Black missing loses (1-0FF), both is 0-0FF. Null
 * when nobody is known to be missing - the arbiter picks then.
 */
export function forfeitFor(missing: Side[], codes: string[]): string | null {
  const w = missing.includes("white");
  const b = missing.includes("black");
  const code = w && b ? "0-0FF" : w ? "0-1FF" : b ? "1-0FF" : null;
  return code && codes.includes(code) ? code : null;
}

/** The forfeits the arbiter may pick from when the list cannot say who is missing. */
export function forfeitChoices(codes: string[]): string[] {
  return ["1-0FF", "0-1FF", "0-0FF"].filter((c) => codes.includes(c));
}

/** One round's clock: when the round began, and the default time that applies. */
export interface RoundClock {
  start: number;
  minutes: number;
}

/** Milliseconds left until the default time; 0 once it is reached. */
export function remaining(clock: RoundClock, now: number): number {
  return Math.max(0, clock.start + clock.minutes * 60_000 - now);
}

/** "12:05" or "1:02:30": what is left, to the second. */
export function formatLeft(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Whole minutes from 0 to MINUTES_MAX, or null. */
export function parseMinutes(text: string): number | null {
  if (!/^\s*\d{1,3}\s*$/.test(text)) return null;
  const n = Number(text);
  return n <= MINUTES_MAX ? n : null;
}

/** "HH:MM" today, as epoch ms; a time later than now is taken as yesterday's (a round past midnight). */
export function startAt(hhmm: string, now: number): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  let t = d.getTime();
  if (t > now + 60_000) t -= 24 * 3600_000;
  return t;
}

const tournamentKey = (base: string, id: number) => `manubrium.defaulttime.v1.${base}#${id}`;
const roundKey = (base: string, id: number, round: number) => `${tournamentKey(base, id)}#${round}`;

/** The stored per-tournament minutes and this round's clock and cleared boards. */
export interface DefaultTimeState {
  minutes: number;
  clock: RoundClock | null;
  cleared: number[];
}

export async function loadDefaultTime(store: KeyValue, base: string, id: number, round: number): Promise<DefaultTimeState> {
  let minutes = DEFAULT_MINUTES;
  let clock: RoundClock | null = null;
  let cleared: number[] = [];
  try {
    const rawMinutes = await store.get(tournamentKey(base, id));
    const m = Number(rawMinutes);
    if (rawMinutes !== null && rawMinutes !== "" && Number.isInteger(m) && m >= 0 && m <= MINUTES_MAX) minutes = m;
    const raw = await store.get(roundKey(base, id, round));
    if (raw) {
      const v = JSON.parse(raw) as { start?: unknown; minutes?: unknown; cleared?: unknown };
      if (typeof v.start === "number" && typeof v.minutes === "number") clock = { start: v.start, minutes: v.minutes };
      if (Array.isArray(v.cleared)) cleared = v.cleared.filter((x): x is number => typeof x === "number");
    }
  } catch {
    // Unreadable is "nothing set": the arbiter starts the clock again.
  }
  return { minutes, clock, cleared };
}

export async function saveDefaultTime(store: KeyValue, base: string, id: number, round: number, state: DefaultTimeState): Promise<void> {
  await store.set(tournamentKey(base, id), String(state.minutes));
  await store.set(roundKey(base, id, round), JSON.stringify({ ...(state.clock ?? {}), cleared: state.cleared }));
}

/**
 * The reminder the Notifications card should offer first, from the default
 * time this phone already keeps: the moment the clock on the Default time
 * card runs out when the clocks are running (and that moment is still ahead),
 * otherwise the phone's minutes counted from now. One default time, two ways
 * to be told about it - the arbiter types it once.
 */
export interface DefaultReminder {
  at: Date;
  /** The whole minutes from now; what the button says when there is no running clock. */
  minutes: number;
  /** True when it is the running clock's moment rather than "minutes from now". */
  fromClock: boolean;
}

export function defaultReminder(state: Pick<DefaultTimeState, "minutes" | "clock">, now: number): DefaultReminder | null {
  if (state.clock) {
    const end = state.clock.start + state.clock.minutes * 60_000;
    if (end > now + 60_000) return { at: new Date(end), minutes: Math.round((end - now) / 60_000), fromClock: true };
  }
  if (state.minutes < 1) return null;
  return { at: new Date(now + state.minutes * 60_000), minutes: state.minutes, fromClock: false };
}

/** A stable notification id for a tournament's round (Android wants a 32-bit int). */
export function notificationId(base: string, id: number, round: number): number {
  let h = 0;
  for (const c of `${base}#${id}#${round}`) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return Math.abs(h) % 2_000_000_000 || 1;
}
