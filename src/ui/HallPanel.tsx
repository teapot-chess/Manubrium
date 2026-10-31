// The hall apps (Polis prints, Nunki announces): which stations are online,
// and four things to tell them - print the round again, start or stop the
// countdown, say a canned line, say something free. Every command goes to
// the server and from there to the stations that are online; nothing is
// queued for later, because a countdown that arrives an hour late is worse
// than none. The answer says how many stations it reached, and zero is said
// as zero.

import { useEffect, useState } from "preact/hooks";
import {
  ApiError,
  HALL_CANNED,
  HALL_MINUTES,
  HALL_PRINT_WHATS,
  HALL_TEXT_MAX,
  type Hall,
  type HallCanned,
  type HallPrintWhat,
  type HallSent,
  type Tournament,
} from "../api";
import type { Ctx } from "./App";
import { describeError, Empty, Loading, Notice } from "./common";
import { dateLocale, t as tr } from "../i18n";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(dateLocale(), { dateStyle: "short", timeStyle: "short" }) : null);

const HALL_CODES = ["hall_off", "hall_no_round", "hall_failed", "bad_request"] as const;

/** A refusal in this app's words when it is one the hall knows; the server's own sentence otherwise. */
export function hallError(error: unknown): string {
  if (error instanceof ApiError && (HALL_CODES as readonly string[]).includes(error.code)) return tr(`hall.err.${error.code}` as never);
  return describeError(error);
}

export function HallPanel(props: { ctx: Ctx; t: Tournament }) {
  const { ctx, t } = props;
  const [hall, setHall] = useState<Hall | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [what, setWhat] = useState<HallPrintWhat>("pairings");
  const [minutes, setMinutes] = useState<number>(5);
  const [text, setText] = useState("");

  const load = () =>
    ctx.api.hall(t.id).then(
      (h) => {
        setHall(h);
        setError(null);
      },
      (e) => setError(hallError(e)),
    );

  useEffect(() => {
    load();
  }, [t.id]);

  async function send(command: () => Promise<HallSent>, after?: () => void) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const sent = await command();
      if (sent.sent_to === 0) setNote({ kind: "info", text: tr("hall.sent_none") });
      else setNote({ kind: "ok", text: sent.sent_to === 1 ? tr("hall.sent_one") : tr("hall.sent_other", { n: sent.sent_to }) });
      after?.();
      await load();
    } catch (e) {
      setError(hallError(e));
    } finally {
      setBusy(false);
    }
  }

  const off = hall !== null && hall.apps.length === 0;
  const hasRound = hall?.round != null;
  const idle = busy || t.read_only;

  return (
    <section id="hall-section">
      <h2>{tr("hall.title")}</h2>
      {error && (
        <Notice kind="error" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}
      {note && (
        <Notice kind={note.kind} onClose={() => setNote(null)}>
          {note.text}
        </Notice>
      )}
      {!hall && !error && <Loading />}
      {off && <Empty>{tr("hall.off")}</Empty>}
      {hall && !off && (
        <>
          {hall.devices.length === 0 && <Empty>{tr("hall.none")}</Empty>}
          {hall.devices.length > 0 && (
            <ul class="list compact" id="hall-devices">
              {hall.devices.map((d) => (
                <li key={`${d.app}-${d.id}`} class="row" id={`hall-device-${d.app}-${d.id}`}>
                  <span class="row-main static">
                    <span class="row-title">
                      {d.name}
                      <span class="tag">{tr(`hall.app.${d.app}` as never)}</span>
                      <span class={`tag ${d.online ? "ok" : ""}`}>{d.online ? tr("hall.online") : tr("hall.offline")}</span>
                    </span>
                    <span class="row-sub">
                      {[d.room, d.last_seen_at ? tr("hall.last_seen", { when: when(d.last_seen_at) ?? "" }) : tr("hall.not_seen")].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p class="fine" id="hall-round">
            {hasRound ? tr("hall.round", { n: hall.round! }) : tr("hall.no_round")}
          </p>

          {hasRound && (
            <>
              <h3>{tr("hall.print_title")}</h3>
              <select id="hall-print-what" value={what} onChange={(e) => setWhat((e.target as HTMLSelectElement).value as HallPrintWhat)}>
                {HALL_PRINT_WHATS.map((w) => (
                  <option key={w} value={w}>
                    {tr(`hall.what.${w}` as never)}
                  </option>
                ))}
              </select>
              <button type="button" class="btn block" id="hall-print" disabled={idle} onClick={() => send(() => ctx.api.hallPrint(t.id, what))}>
                {tr("hall.print_go")}
              </button>

              <h3>{tr("hall.countdown_title")}</h3>
              {hall.countdown && (
                <p id="hall-countdown-running">
                  {tr("hall.countdown_running", { round: hall.countdown.round, minutes: Math.max(1, Math.ceil(hall.countdown.seconds_left / 60)) })}
                </p>
              )}
              <select id="hall-minutes" value={String(minutes)} onChange={(e) => setMinutes(Number((e.target as HTMLSelectElement).value))}>
                {HALL_MINUTES.map((m) => (
                  <option key={m} value={String(m)}>
                    {tr("hall.minutes", { n: m })}
                  </option>
                ))}
              </select>
              <button type="button" class="btn block" id="hall-countdown-start" disabled={idle} onClick={() => send(() => ctx.api.hallCountdown(t.id, minutes))}>
                {tr("hall.countdown_start")}
              </button>
              {hall.countdown && (
                <button type="button" class="btn block" id="hall-countdown-cancel" disabled={idle} onClick={() => send(() => ctx.api.hallCancelCountdown(t.id))}>
                  {tr("hall.countdown_cancel")}
                </button>
              )}
            </>
          )}

          <h3>{tr("hall.announce_title")}</h3>
          <div class="chips" id="hall-canned">
            {HALL_CANNED.map((c: HallCanned) => (
              <button key={c} type="button" class="chip" id={`hall-canned-${c}`} disabled={idle} onClick={() => send(() => ctx.api.hallAnnounce(t.id, { canned: c }))}>
                {tr(`hall.canned.${c}` as never)}
              </button>
            ))}
          </div>
          <form
            class="form"
            id="hall-announce-form"
            onSubmit={(e) => {
              e.preventDefault();
              const words = text.trim();
              if (words) send(() => ctx.api.hallAnnounce(t.id, { text: words }), () => setText(""));
            }}
          >
            <label for="hall-text">{tr("hall.text_label")}</label>
            <textarea id="hall-text" rows={2} maxLength={HALL_TEXT_MAX} value={text} placeholder={tr("hall.text_placeholder")} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
            <button type="submit" class="btn primary block" id="hall-announce" disabled={idle || text.trim() === ""}>
              {tr("hall.text_send")}
            </button>
          </form>
          <p class="fine">{tr("hall.fine")}</p>
        </>
      )}
    </section>
  );
}
