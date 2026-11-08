// Live board control, the parts that are not a screen: how healthy a board's
// link is, how long ago is "ago", the clocks counted down between two
// reports, the guessed moves grouped into runs, and what to tell the arbiter
// about a command and about a refusal. All pure, all tested on their own.

import { ApiError, type BoardCommand, type LiveSide, type LiveTable } from "./api";
import { t, type Key } from "./i18n";
// As ui/common's resultLabel; repeated so this file pulls in no UI.
const resultLabel = (code: string) => code.replace(/1\/2/g, "½");

export type Health = "connected" | "lost" | "stale";

/** Stale wins: a box that stopped reporting cannot vouch for "connected". */
export function health(table: Pick<LiveTable, "connected" | "stale">): Health {
  if (table.stale) return "stale";
  return table.connected ? "connected" : "lost";
}

/** "just now", "12 s ago", "3 min ago", "2 h ago"; null for no time at all. */
export function ago(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 5) return t("live.ago.now");
  if (s < 60) return t("live.ago.seconds", { n: s });
  if (s < 3600) return t("live.ago.minutes", { n: Math.floor(s / 60) });
  if (s < 86400) return t("live.ago.hours", { n: Math.floor(s / 3600) });
  return t("live.ago.days", { n: Math.floor(s / 86400) });
}

/**
 * What a clock shows now: the reported time, less what has passed since the
 * report arrived if it is the one running. Never below zero. Null when the
 * board reported no clock.
 */
export function clockNow(
  table: Pick<LiveTable, "white_ms" | "black_ms" | "running" | "clock_at">,
  side: "white" | "black",
  now: number = Date.now(),
): number | null {
  const ms = side === "white" ? table.white_ms : table.black_ms;
  if (ms === null || ms === undefined) return null;
  if (table.running !== side || !table.clock_at) return ms;
  const at = Date.parse(table.clock_at);
  if (Number.isNaN(at)) return ms;
  return Math.max(0, ms - Math.max(0, now - at));
}

/** 1:23:45 or 4:05, the way a chess clock shows it. */
export function formatClock(ms: number | null): string {
  if (ms === null) return "–";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

export const isRunning = (running: LiveSide | null | undefined, side: "white" | "black") => running === side;

/** Consecutive guessed plies, as runs: [3,4,5,9] is [[3,5],[9,9]]. */
export function guessedRuns(plies: number[]): [number, number][] {
  const sorted = [...new Set(plies)].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const p of sorted) {
    const last = runs.at(-1);
    if (last && p === last[1] + 1) last[1] = p;
    else runs.push([p, p]);
  }
  return runs;
}

/** Ply 23 is "12. …" ; ply 24 is "12… " - how a ply is named to a person: move 12, White or Black. */
export function plyName(ply: number): string {
  const move = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${move}.` : `${move}…`;
}

export function runName([from, to]: [number, number]): string {
  return from === to ? plyName(from) : `${plyName(from)}–${plyName(to)}`;
}

// --- words for the box's own vocabulary -----------------------------------

const KNOWN_STATES = ["live", "waiting", "finished", "no_signal", "unlinked", "out_of_sync", "clock_alarm", "recovered", "guessed", "paused"];
const KNOWN_ALARMS = ["out_of_turn", "illegal_move", "out_of_sync", "clock", "setup", "pieces_unseen", "pairing_changed"];

/** The board's state in words; a state this version does not know is shown as the box sent it. */
export function stateLabel(state: string): string {
  return KNOWN_STATES.includes(state) ? t(`live.state.${state}` as Key) : state;
}

/** How loud a state is: red for guessed moves and alarms, orange for reconstructed ones. */
export function stateTone(state: string): "bad" | "warn" | "ok" | "plain" {
  if (state === "guessed" || state === "out_of_sync" || state === "clock_alarm" || state === "no_signal") return "bad";
  if (state === "recovered" || state === "paused") return "warn";
  if (state === "live") return "ok";
  return "plain";
}

export function alarmLabel(alarm: string): string {
  return KNOWN_ALARMS.includes(alarm) ? t(`live.alarm.${alarm}` as Key) : alarm;
}

// --- commands ----------------------------------------------------------------

export const FINAL_STATES = ["done", "failed", "expired"];
export const isFinal = (c: Pick<BoardCommand, "state">) => FINAL_STATES.includes(c.state);

const BOX_ERRORS = [
  "no_board",
  "not_running",
  "no_game",
  "wrong_game",
  "no_draft",
  "not_guessed",
  "not_last",
  "bad_position",
  "bad_args",
  "refused",
  "other_tournament",
  "unknown_kind",
  "failed",
];

/** The box's refusal in a sentence; the box's own detail follows where it has one. */
export function boxErrorText(error: string | null, detail: string | null): string {
  const base = error && BOX_ERRORS.includes(error) ? t(`live.box_error.${error}` as Key) : t("live.box_error.unknown", { code: error ?? "?" });
  return detail ? `${base} (${detail})` : base;
}

/** Where a command stands, in a sentence for the arbiter. */
export function commandStateText(c: Pick<BoardCommand, "state" | "error" | "detail" | "kind">): string {
  switch (c.state) {
    case "pending":
      return t("live.cmd.pending");
    case "sent":
      return t("live.cmd.sent");
    case "done":
      return c.kind === "accept_result" ? t("live.cmd.done_result") : t("live.cmd.done");
    case "failed":
      return t("live.cmd.failed", { why: boxErrorText(c.error, c.detail) });
    case "expired":
      return t("live.cmd.expired");
    default:
      return c.state;
  }
}

export function commandKindLabel(kind: string): string {
  const known = ["accept_result", "confirm_guess", "reject_guess", "accept_draft", "dismiss_draft", "set_position", "takeback", "flip", "link", "unlink", "restart", "resync", "finish"];
  return known.includes(kind) ? t(`live.kind.${kind}` as Key) : kind;
}

const API_ERRORS = ["no_board_result", "result_entered", "invalid_command", "board_not_found", "game_not_found", "command_not_found"];

/** A refused request in a sentence: the codes this screen knows, else the server's own words. */
export function liveErrorText(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "invalid_command") {
    const detail = typeof error.body.detail === "string" ? error.body.detail : null;
    return detail ? `${t("live.err.invalid_command")} (${detail})` : t("live.err.invalid_command");
  }
  if (API_ERRORS.includes(error.code)) return t(`live.err.${error.code}` as Key);
  return null;
}

/** "1-0" to "1-0", "1/2-1/2" to "½-½", "*" to "unfinished". */
export function finishLabel(result: string): string {
  return result === "*" ? t("live.finish.unfinished") : resultLabel(result);
}
