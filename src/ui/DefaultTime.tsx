// The default-time card on the current round: the boards where somebody
// has not turned up, a countdown from when the clocks started, and when it
// runs out a forfeit per board - the ordinary result entry with the forfeit
// code, after a question. The list and the arithmetic are src/defaultTime.ts.

import { useEffect, useState } from "preact/hooks";
import type { Board, Round, Tournament } from "../api";
import {
  forfeitChoices,
  forfeitFor,
  formatLeft,
  loadDefaultTime,
  notificationId,
  parseMinutes,
  remaining,
  saveDefaultTime,
  startAt,
  waitingBoards,
  type DefaultTimeState,
  type Side,
} from "../defaultTime";
import { cancelReminder, remindAt, storage } from "../platform";
import { loadPhoneSettings } from "../phoneSettings";
import type { Ctx } from "./App";
import { resultLabel, Sheet } from "./common";
import { t as tr } from "../i18n";

const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function DefaultTimeCard(props: {
  ctx: Ctx;
  t: Tournament;
  round: Round;
  /** Enters `code` for `board`, as tapping it in the result sheet would. */
  onForfeit: (board: Board, code: string) => void;
  onPlayer: (id: number) => void;
}) {
  const { ctx, t, round } = props;
  const base = ctx.server.base;
  const [state, setState] = useState<DefaultTimeState | null>(null);
  const [present, setPresent] = useState<Map<number, boolean> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<{ board: Board; codes: string[] } | null>(null);
  const [minutesText, setMinutesText] = useState("");
  const [startText, setStartText] = useState("");
  const [bad, setBad] = useState(false);

  useEffect(() => {
    let gone = false;
    loadDefaultTime(storage, base, t.id, round.number).then((s) => {
      if (gone) return;
      setState(s);
      setMinutesText(String(s.minutes));
    });
    return () => {
      gone = true;
    };
  }, [base, t.id, round.number]);

  // Who is checked in: read with the round, so a late arrival leaves the
  // list on the next look. An older server has no such route; then only
  // the hall boards speak.
  useEffect(() => {
    let gone = false;
    Promise.resolve()
      .then(() => ctx.api.arrivals(t.id))
      .then(
        (list) => !gone && setPresent(new Map(list.map((a) => [a.id, a.present]))),
        () => undefined,
      );
    return () => {
      gone = true;
    };
  }, [ctx.api, t.id, round]);

  const running = state?.clock ?? null;
  const left = running ? remaining(running, now) : null;
  const up = left === 0;

  useEffect(() => {
    if (!running || up) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, up]);

  if (!state) return null;
  const waiting = waitingBoards(round, present, new Set(state.cleared));
  const allIn = round.boards.every((b) => b.bye || b.vacant || b.empty || !!b.result);
  if (allIn && !running) return null;

  async function save(next: DefaultTimeState) {
    setState(next);
    await saveDefaultTime(storage, base, t.id, round.number, next).catch(() => undefined);
    const id = notificationId(base, t.id, round.number);
    if (next.clock && (await loadPhoneSettings(storage)).remindDefaultTime) {
      const at = new Date(next.clock.start + next.clock.minutes * 60_000);
      await remindAt(id, at, tr("dt.notify_title", { name: t.name }), tr("dt.notify_body", { n: round.number }));
    } else {
      await cancelReminder(id);
    }
  }

  function startClock() {
    if (!state) return;
    const minutes = parseMinutes(minutesText);
    const at = startText.trim() ? startAt(startText, Date.now()) : Date.now();
    if (minutes === null || at === null) {
      setBad(true);
      return;
    }
    setBad(false);
    setNow(Date.now());
    void save({ ...state, minutes, clock: { start: at, minutes } });
  }

  const clearBoard = (b: Board) => state && void save({ ...state, cleared: [...state.cleared, b.id] });
  const missingNames = (b: Board, missing: Side[]) =>
    missing.map((s) => (s === "white" ? b.white?.name : b.black?.name)).filter(Boolean).join(", ");

  const status = !running
    ? tr("dt.not_started")
    : up
      ? tr("dt.up")
      : tr("dt.left", { time: formatLeft(left ?? 0) });

  return (
    <>
      <button type="button" class={`dt-card ${up ? "up" : ""} ${running && !up ? "running" : ""}`} id="default-time" onClick={() => setOpen(true)}>
        <span class="dt-title">{tr("dt.title")}</span>
        <span class="dt-status" id="default-time-status">
          {status}
        </span>
        <span class="dt-count">
          {waiting.length === 1 ? tr("dt.waiting_one") : tr("dt.waiting_other", { n: waiting.length })}
        </span>
      </button>

      {open && !asking && (
        <Sheet title={tr("dt.sheet_title", { n: round.number })} onClose={() => setOpen(false)}>
          {running ? (
            <div class={`dt-clock ${up ? "up" : ""}`}>
              <strong id="default-time-left">{up ? tr("dt.up") : formatLeft(left ?? 0)}</strong>
              <span>{tr("dt.clock_line", { start: clockTime(running.start), minutes: running.minutes })}</span>
              <button type="button" class="chip" id="default-time-reset" onClick={() => void save({ ...state, clock: null })}>
                {tr("dt.reset")}
              </button>
            </div>
          ) : (
            <form
              class="form dt-start"
              id="default-time-form"
              onSubmit={(e) => {
                e.preventDefault();
                startClock();
              }}
            >
              <div class="two">
                <div>
                  <label for="default-time-minutes">{tr("dt.minutes")}</label>
                  <input id="default-time-minutes" inputMode="numeric" value={minutesText} onInput={(e) => setMinutesText((e.target as HTMLInputElement).value)} />
                </div>
                <div>
                  <label for="default-time-start">{tr("dt.started_at")}</label>
                  <input id="default-time-start" type="time" value={startText} placeholder={tr("dt.now")} onInput={(e) => setStartText((e.target as HTMLInputElement).value)} />
                </div>
              </div>
              {t.settings.time_control ? <p class="fine">{tr("dt.rate_hint", { rate: String(t.settings.time_control) })}</p> : <p class="fine">{tr("dt.hint")}</p>}
              {bad && <p class="fine dt-bad">{tr("dt.bad_input")}</p>}
              <button type="submit" class="btn primary block" id="default-time-go">
                {tr("dt.start")}
              </button>
            </form>
          )}

          <h3>{tr("dt.list_title")}</h3>
          {waiting.length === 0 ? (
            <p class="empty">{present === null && !round.boards.some((b) => b.board_report) ? tr("dt.no_signals") : tr("dt.nobody_missing")}</p>
          ) : (
            <ul class="list compact" id="default-time-list">
              {waiting.map(({ board: b, missing }) => {
                const code = forfeitFor(missing, round.results);
                return (
                  <li key={b.id} class="row" id={`dt-board-${b.id}`}>
                    <span class="row-main static">
                      <span class="row-title">
                        {tr("round.board", { label: b.label })}:{" "}
                        <button type="button" class="link" onClick={() => b.white && props.onPlayer(b.white.id)}>
                          {b.white?.name}
                        </button>{" "}
                        –{" "}
                        <button type="button" class="link" onClick={() => b.black && props.onPlayer(b.black.id)}>
                          {b.black?.name}
                        </button>
                      </span>
                      <span class="row-sub">{missing.length ? tr("dt.not_here", { names: missingNames(b, missing) }) : tr("dt.board_untouched")}</span>
                    </span>
                    {up && !t.read_only ? (
                      <button
                        type="button"
                        class="chip danger"
                        id={`dt-forfeit-${b.id}`}
                        onClick={() => setAsking({ board: b, codes: code ? [code] : forfeitChoices(round.results) })}
                      >
                        {code ? tr("dt.forfeit_code", { code: resultLabel(code) }) : tr("dt.forfeit")}
                      </button>
                    ) : (
                      <button type="button" class="chip" id={`dt-clear-${b.id}`} onClick={() => clearBoard(b)}>
                        {tr("dt.playing")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Sheet>
      )}

      {asking && (
        <Sheet title={tr("dt.forfeit_title", { label: asking.board.label })} onClose={() => setAsking(null)}>
          <p class="sheet-sub">
            {asking.board.white?.name} – {asking.board.black?.name}
          </p>
          <p>{tr("dt.forfeit_text")}</p>
          <div class="sheet-actions">
            {asking.codes.map((c) => (
              <button
                type="button"
                key={c}
                class="btn danger block"
                id={`dt-forfeit-confirm-${c}`}
                onClick={() => {
                  const b = asking.board;
                  setAsking(null);
                  props.onForfeit(b, c);
                }}
              >
                {tr("dt.enter_code", { code: resultLabel(c) })}
              </button>
            ))}
            <button type="button" class="btn block" id="dt-forfeit-keep" onClick={() => setAsking(null)}>
              {tr("common.keep")}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
