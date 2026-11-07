// Notifications in the app: the switches on the Servers screen, and the
// round screen's offer, default-time reminder and lock-screen progress.

import { useEffect, useState } from "preact/hooks";
import { client, type Client, type PushEvent, type PushStatus, type Round, type Tournament } from "../api";
import { t as tr, type Key } from "../i18n";
import { liveActivities, progress } from "../liveActivity";
import { nativePushBackend } from "../pushNative";
import { PushManager, serverCanPush, shouldOffer, withEvent, type Permission } from "../push";
import { storage } from "../platform";
import type { SavedServer } from "../servers";
import type { Ctx } from "./App";
import { describeError, Sheet } from "./common";

export const pushManager = new PushManager(nativePushBackend(), storage, (s) => client(s.base, s.token));

const EVENT_LABEL: Record<PushEvent, Key> = {
  round_paired: "push.event.round_paired",
  round_published: "push.event.round_published",
  phone_result: "push.event.phone_result",
  incident: "push.event.incident",
  coarbiter_result: "push.event.coarbiter_result",
  default_time: "push.event.default_time",
};

/** The minutes a default-time reminder can be set for. */
export const REMINDER_MINUTES = [15, 30, 45, 60, 90] as const;

// One status per server for the app's lifetime: it changes when the server
// gets keys, which is a restart on its side and a fresh start on ours.
const statuses = new Map<string, Promise<PushStatus | null>>();

function statusOf(base: string, api: Client, fresh = false): Promise<PushStatus | null> {
  if (fresh || !statuses.has(base)) statuses.set(base, Promise.resolve().then(() => api.pushStatus()).catch(() => null));
  return statuses.get(base)!;
}

/** The Notifications section on the Servers screen, for the server in use. */
export function NotificationSettings(props: { server: SavedServer; servers: SavedServer[]; manager?: PushManager }) {
  const manager = props.manager ?? pushManager;
  const { server } = props;
  const [status, setStatus] = useState<PushStatus | null | undefined>(undefined);
  const [permission, setPermission] = useState<Permission | null>(null);
  const [live, setLive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    const api = client(server.base, server.token);
    Promise.all([statusOf(server.base, api, true), manager.permission(), liveActivities.supported(), manager.liveActivities()]).then(
      ([s, p, supported, on]) => {
        if (gone) return;
        setStatus(s);
        setPermission(p);
        setLive(supported ? on : null);
      },
    );
    return () => {
      gone = true;
    };
  }, [server.base]);

  const platform = manager.platform;
  let body;
  if (!platform) body = <p class="fine">{tr("push.unsupported")}</p>;
  else if (status === undefined || permission === null) body = <p class="fine">…</p>;
  else if (status === null) body = <p class="fine">{tr("push.unreachable")}</p>;
  else if (!serverCanPush(status, platform)) body = <p class="fine" id="push-server-off">{tr("push.server_off", { label: server.label })}</p>;
  else if (permission === "denied") body = <p class="fine">{tr("push.denied")}</p>;
  else if (permission === "prompt" || !status.registration)
    body = (
      <button
        type="button"
        class="btn block"
        id="push-enable"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const p = await manager.enable(props.servers);
          setPermission(p);
          setStatus(await statusOf(server.base, client(server.base, server.token), true));
          setBusy(false);
        }}
      >
        {tr("push.turn_on")}
      </button>
    );
  else {
    const chosen = status.registration.events;
    body = (
      <div class="push-events" id="push-events">
        {status.events.map((e) => (
          <label class="check" key={e} for={`push-${e}`}>
            <input
              id={`push-${e}`}
              type="checkbox"
              checked={chosen.includes(e)}
              disabled={busy}
              onChange={async (ev) => {
                setBusy(true);
                setError(null);
                try {
                  const next = await manager.setEvents(server, withEvent(status.events, chosen, e, (ev.target as HTMLInputElement).checked));
                  if (next) setStatus(next);
                } catch {
                  setError(tr("push.save_failed"));
                }
                setBusy(false);
              }}
            />
            {tr(EVENT_LABEL[e])}
          </label>
        ))}
      </div>
    );
  }

  return (
    <section class="form push-settings" id="push-settings">
      <h2>{tr("push.title")}</h2>
      <p class="fine">{tr("push.for_server", { label: server.label })}</p>
      {body}
      {error && <p class="fine error">{error}</p>}
      {live !== null && (
        <label class="check" for="push-live">
          <input
            id="push-live"
            type="checkbox"
            checked={live}
            onChange={async (ev) => {
              const on = (ev.target as HTMLInputElement).checked;
              await manager.setLiveActivities(on);
              setLive(on);
            }}
          />
          {tr("push.live")}
        </label>
      )}
    </section>
  );
}

/** Pending reminders, by server, tournament and round: the time it goes off. */
const REMINDERS_KEY = "manubrium.push.reminders.v1";

async function reminders(): Promise<Record<string, string>> {
  try {
    const all = JSON.parse((await storage.get(REMINDERS_KEY)) ?? "{}") as Record<string, string>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(all).filter(([, at]) => Date.parse(at) > now));
  } catch {
    return {};
  }
}

async function saveReminder(key: string, at: string | null) {
  const all = await reminders();
  if (at) all[key] = at;
  else delete all[key];
  await storage.set(REMINDERS_KEY, JSON.stringify(all));
}

/**
 * Under the round's boards: the one-time offer to turn notifications on, the
 * default-time reminder, and the lock-screen progress kept in step.
 */
export function RoundPush(props: { ctx: Ctx; t: Tournament; round: Round; manager?: PushManager }) {
  const manager = props.manager ?? pushManager;
  const { ctx, t, round } = props;
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [permission, setPermission] = useState<Permission>("denied");
  const [asked, setAsked] = useState(true);
  const [reminder, setReminder] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const reminderKey = `${ctx.server.base}#${t.id}#${round.number}`;

  useEffect(() => {
    let gone = false;
    Promise.all([statusOf(ctx.server.base, ctx.api), manager.permission(), manager.asked(), reminders()]).then(([s, p, a, r]) => {
      if (gone) return;
      setStatus(s);
      setPermission(p);
      setAsked(a);
      setReminder(r[reminderKey] ?? null);
    });
    return () => {
      gone = true;
    };
  }, [ctx.server.base, reminderKey]);

  // The lock screen follows the round on screen.
  const { done, total } = progress(round);
  useEffect(() => {
    manager.liveActivities().then((on) =>
      liveActivities.sync({
        base: ctx.server.base,
        api: ctx.api,
        tournament: t.id,
        name: t.name,
        round,
        title: tr("live.title", { n: round.number }),
        format: tr("live.format"),
        on,
      }),
    );
  }, [ctx.server.base, t.id, round.number, round.latest, done, total]);

  const offer = shouldOffer({ platform: manager.platform, permission, asked, status });
  const canRemind = permission === "granted" && serverCanPush(status, manager.platform) && round.latest && done < total;

  return (
    <>
      {offer && (
        <div class="push-offer" id="push-offer">
          <p>{tr("push.offer")}</p>
          <div class="row-actions">
            <button
              type="button"
              class="btn primary"
              id="push-offer-yes"
              onClick={async () => {
                setAsked(true);
                setPermission(await manager.enable([ctx.server]));
              }}
            >
              {tr("push.turn_on")}
            </button>
            <button
              type="button"
              class="btn"
              id="push-offer-no"
              onClick={async () => {
                setAsked(true);
                await manager.decline();
              }}
            >
              {tr("push.not_now")}
            </button>
          </div>
        </div>
      )}
      {canRemind && (
        <div class="push-reminder" id="push-reminder">
          {reminder ? (
            <>
              <span>{tr("push.reminder_set", { time: new Date(reminder).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })}</span>
              <button
                type="button"
                class="btn subtle"
                id="push-reminder-cancel"
                onClick={async () => {
                  try {
                    await ctx.api.cancelDefaultTime(t.id, round.number);
                    await saveReminder(reminderKey, null);
                    setReminder(null);
                  } catch (e) {
                    setNote(describeError(e));
                  }
                }}
              >
                {tr("push.reminder_cancel")}
              </button>
            </>
          ) : (
            <button type="button" class="btn block" id="push-reminder-set" onClick={() => setChoosing(true)}>
              {tr("push.reminder")}
            </button>
          )}
          {note && <p class="fine">{note}</p>}
        </div>
      )}
      {choosing && (
        <Sheet title={tr("push.reminder")} onClose={() => setChoosing(false)}>
          <p>{tr("push.reminder_text")}</p>
          <div class="sheet-actions">
            {REMINDER_MINUTES.map((m) => (
              <button
                type="button"
                key={m}
                class="btn block"
                id={`push-reminder-${m}`}
                onClick={async () => {
                  const at = new Date(Date.now() + m * 60_000).toISOString();
                  setChoosing(false);
                  try {
                    await ctx.api.setDefaultTime(t.id, round.number, at);
                    await saveReminder(reminderKey, at);
                    setReminder(at);
                    setNote(null);
                  } catch (e) {
                    setNote(describeError(e));
                  }
                }}
              >
                {tr("push.reminder_minutes", { n: m })}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}
