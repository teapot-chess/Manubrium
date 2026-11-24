// A relayed tournament's writes, where they stand: sent to the laptop and
// waiting for the desk, done, refused with the desk's sentence, or the
// desk's question to answer. Shown above every tab of the tournament, and
// asked about (src/relay.ts: soon, then less often; at once on resume)
// until the laptop has answered.

import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, type Tournament } from "../api";
import { onResume } from "../platform";
import { hallRoutes, laptopSilentSince, type HallRoutes } from "../hall";
import { acknowledgedRequest, actionLabel, commandQuestion, commandSentence, RelayedWrite, type KeptCommand } from "../relay";
import { dateLocale, t as tr } from "../i18n";
import type { Ctx } from "./App";
import { describeError, Notice } from "./common";

/** How long a plain "done" stays on screen before it goes by itself. */
const DONE_MS = 6000;

/**
 * The banner a relayed tournament carries at the top, and which way this
 * phone's requests go: straight to the laptop on the hall's network, or
 * through the cloud (src/hall.ts). The road changes by itself; the banner
 * follows the last request.
 *
 * A laptop not heard from for ten minutes (by the cloud, or by this phone
 * directly) is said to be quiet, with what still works: results wait on
 * the phone, and the organiser can take the tournament back on the website
 * without it. `site` is where (the server's name); `now` is for the tests.
 */
export function RelayBanner(props: { t: Tournament; base: string; routes?: HallRoutes; site?: string; now?: () => number }) {
  const routes = props.routes ?? hallRoutes;
  const now = props.now ?? Date.now;
  const [, redraw] = useState(0);
  useEffect(() => routes.subscribe(() => redraw((n) => n + 1)), [routes]);
  // Silence is a matter of time passing, not of anything arriving.
  useEffect(() => {
    const timer = setInterval(() => redraw((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  const relay = props.t.relay;
  if (!relay) return null;
  const hall = routes.pathOf(props.base, props.t.id) === "hall";
  const seen = relay.last_seen_at ? new Date(relay.last_seen_at) : null;
  const silent = laptopSilentSince(relay, routes.lastReached(props.base, props.t.id), now());
  const time = (d: Date) => d.toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });
  return (
    <div
      class={["notice info relay-banner", silent ? "relay-silent" : "", hall ? "relay-hall" : "relay-cloud"].filter(Boolean).join(" ")}
      id="relay-banner"
      role="status"
      data-path={hall ? "hall" : "cloud"}
    >
      <span>
        {tr("relay.banner", { label: relay.label })} <strong id="relay-path">{tr(hall ? "relay.path_hall" : "relay.path_cloud")}</strong>
        {!silent && !hall && seen && !Number.isNaN(seen.getTime()) && <> {tr("relay.banner_seen", { time: time(seen) })}</>}
        {silent && (
          <span class="relay-silence" id="relay-silent">
            {tr("relay.laptop_silent", { time: time(silent) })}{" "}
            <span id="relay-take-back">
              {props.t.role === "owner" && props.site ? tr("relay.take_back_owner", { site: props.site }) : tr("relay.take_back_other")}
            </span>
          </span>
        )}
      </span>
    </div>
  );
}

export function RelayCommands(props: { ctx: Ctx; t: Tournament; onAnswered: () => void }) {
  const { ctx, t } = props;
  const base = ctx.server.base;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answered = useRef(props.onAnswered);
  answered.current = props.onAnswered;
  const asking = useRef(false);

  const kept = ctx.commands.list(base, t.id);

  async function ask() {
    if (asking.current) return;
    asking.current = true;
    let changed = false;
    try {
      for (const k of ctx.commands.due(base, t.id)) {
        try {
          const command = await ctx.api.relayCommand(t.id, k.command.cid);
          await ctx.commands.answered(base, command);
          if (command.state !== "pending") changed = true;
        } catch (e) {
          // No network or a busy server: ask later. A command the server no
          // longer knows (404) is not going to be answered either; say so
          // once and stop asking.
          if (!(e instanceof ApiError && e.status === 404)) await ctx.commands.askFailed(base, k.command.cid);
          else {
            await ctx.commands.answered(base, {
              ...k.command,
              state: "refused",
              error: "not_found",
              message: describeError(e),
            });
            changed = true;
          }
        }
      }
    } finally {
      asking.current = false;
    }
    if (changed) answered.current();
    ctx.bump();
    schedule();
  }

  function schedule() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const delay = ctx.commands.nextDelay(base, t.id);
    if (delay === null) return;
    timer.current = setTimeout(() => void ask(), delay);
  }

  // Asks when the tournament opens, whenever something new was sent, and at
  // once on coming back to the app.
  const pendingKey = kept
    .filter((k) => k.command.state === "pending")
    .map((k) => k.command.cid)
    .join(" ");
  useEffect(() => {
    schedule();
  }, [pendingKey]);
  useEffect(() => {
    void ctx.commands.wake(base, t.id).then(ask);
    const undo = onResume(() => void ctx.commands.wake(base, t.id).then(ask));
    return () => {
      undo();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [base, t.id]);

  // A plain "done" goes by itself; one that carries something to read (a
  // board's code, shown once) stays until it is dismissed.
  const doneKey = kept
    .filter((k) => k.command.state === "accepted" && !codeOf(k))
    .map((k) => k.command.cid)
    .join(" ");
  useEffect(() => {
    if (!doneKey) return;
    const id = setTimeout(() => {
      void Promise.all(doneKey.split(" ").map((cid) => ctx.commands.dismiss(base, cid))).then(ctx.bump);
    }, DONE_MS);
    return () => clearTimeout(id);
  }, [doneKey]);

  async function dismiss(k: KeptCommand) {
    await ctx.commands.dismiss(base, k.command.cid);
    ctx.bump();
  }

  // The desk's question answered: the same write again with `acknowledged`,
  // under a NEW key. On a tournament still relayed it comes back as a new
  // command (kept by the client); one that is not any more answers at once.
  async function goAhead(k: KeptCommand, confirm: string[]) {
    setBusy(k.command.cid);
    setError(null);
    try {
      await ctx.api.resend(acknowledgedRequest(k.request, confirm));
      await ctx.commands.dismiss(base, k.command.cid);
      answered.current();
    } catch (e) {
      if (e instanceof RelayedWrite) await ctx.commands.dismiss(base, k.command.cid);
      else setError(describeError(e));
    } finally {
      setBusy(null);
      ctx.bump();
    }
  }

  if (kept.length === 0 && !error) return null;

  return (
    <section class="relay-commands" id="relay-commands" aria-label={tr("relay.title")}>
      {error && (
        <Notice kind="error" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}
      {kept.map((k) => {
        const c = k.command;
        const what = actionLabel(c.action);
        const question = commandQuestion(c);
        if (question)
          return (
            <div key={c.cid} class="confirm relay-ask" id={`relay-ask-${c.cid}`} role="alertdialog" aria-label={tr("relay.ask_title")}>
              <p>
                <strong>{tr("relay.ask_title")}</strong> {what}. {question.summary ?? c.message ?? ""}
              </p>
              {question.warnings.length > 0 && (
                <ul class="warnings">
                  {question.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                class="btn primary block"
                id={`relay-ask-yes-${c.cid}`}
                disabled={busy === c.cid}
                onClick={() => void goAhead(k, question.confirm)}
              >
                {tr("relay.ask_yes")}
              </button>
              <button type="button" class="btn block" id={`relay-ask-no-${c.cid}`} disabled={busy === c.cid} onClick={() => void dismiss(k)}>
                {tr("relay.ask_no")}
              </button>
            </div>
          );
        if (c.state === "pending")
          return (
            <div key={c.cid} class="notice info relay-pending" id={`relay-pending-${c.cid}`} role="status">
              <span>
                {what}: {tr("relay.row_waiting").toLowerCase()}…
              </span>
            </div>
          );
        if (c.state === "accepted") {
          const code = codeOf(k);
          return (
            <Notice key={c.cid} kind="ok" onClose={() => void dismiss(k)}>
              {what}: {tr("relay.row_done").toLowerCase()}.{code ? ` ${tr("relay.board_code", { code })}` : ""}
            </Notice>
          );
        }
        return (
          <Notice key={c.cid} kind="error" onClose={() => void dismiss(k)}>
            {what}: {commandSentence(c)}
          </Notice>
        );
      })}
    </section>
  );
}

/** A board code made through the laptop: its `response` carries the code, shown once. */
function codeOf(k: KeptCommand): string | null {
  if (k.command.action !== "board_link.create") return null;
  const code = k.command.response?.code;
  return typeof code === "string" ? code : null;
}
