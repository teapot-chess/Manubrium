// More: the incidents (desk roles) with their photos, the hall boards
// (Alnasl), the settings - read, and the mid-event ones changed - and the
// outbox for this tournament.

import { useEffect, useState } from "preact/hooks";
import type { Incident, Tournament } from "../api";
import { takePhoto } from "../platform";
import type { Ctx } from "./App";
import { describeError, Empty, Loading, Notice, resultLabel, Sheet, TryAgain } from "./common";
import { SettingsEditor } from "./SettingsEditor";
import { BoardLinks } from "./BoardLinks";
import { refusalText } from "../queue";
import { incidentKinds } from "./RoundScreen";
import { t as tr } from "./../i18n";

/** The labels of the settings the account page lists, in the order it lists them. */
const settingLabels = (): Record<string, string> => ({
  type: tr("more.setting.type"),
  venue: tr("more.setting.venue"),
  city: tr("more.setting.city"),
  federation: tr("more.setting.federation"),
  start_date: tr("more.setting.start_date"),
  end_date: tr("more.setting.end_date"),
  chief_arbiter: tr("more.setting.chief_arbiter"),
  deputy_arbiter: tr("more.setting.deputy_arbiter"),
  time_control: tr("more.setting.time_control"),
  rounds_count: tr("more.setting.rounds_count"),
  bye_value: tr("more.setting.bye_value"),
  shared_places: tr("more.setting.shared_places"),
  fide_rated: tr("more.setting.fide_rated"),
  postponed_games: tr("more.setting.postponed_games"),
  ask_bye_type: tr("more.setting.ask_bye_type"),
  publish_mode: tr("more.setting.publish_mode"),
});

const typeNames = (): Record<string, string> => ({
  swiss: tr("more.type.swiss"),
  roundrobin: tr("more.type.roundrobin"),
  "team-swiss": tr("more.type.team_swiss"),
  "team-roundrobin": tr("more.type.team_roundrobin"),
});

const publishModes = (): Record<string, string> => ({
  manual: tr("more.publish.manual"),
  pairings: tr("more.publish.pairings"),
  results: tr("more.publish.results"),
  standings: tr("more.publish.standings"),
});

/** An incident kind as the incident dialog named it, not as the database spells it. */
export function incidentKind(kind: string): string {
  return incidentKinds().find(([v]) => v === kind)?.[1] ?? kind.replace(/_/g, " ");
}

/** A setting as a person reads it; the server's tokens stay the server's. */
export function settingValue(key: string, v: unknown): string {
  if (typeof v === "boolean") return v ? tr("common.yes") : tr("common.no");
  if (key === "type") return typeNames()[String(v)] ?? String(v);
  if (key === "publish_mode") return publishModes()[String(v)] ?? String(v);
  if (key === "bye_value" && typeof v === "number")
    return v === 1 ? tr("common.points_one") : v === 0.5 ? tr("common.points_half") : tr("common.points_other", { n: v });
  return String(v);
}

export function MoreScreen(props: { ctx: Ctx; t: Tournament; reloadTournament?: () => Promise<void> }) {
  const { ctx, t } = props;
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<{ incident: Incident; url: string } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [amending, setAmending] = useState<Incident | null>(null);
  const desk = t.can.includes("settings");
  const canEdit = desk && Array.isArray(t.settings.editable) && !t.read_only;
  const queued = ctx.outbox.list(ctx.server.base, t.id);
  const tiebreakOptions = (t.settings.tiebreak_options as { code: string; name: string }[] | undefined) ?? [];
  const tiebreakName = (code: string) => tiebreakOptions.find((o) => o.code === code)?.name ?? code;

  const loadIncidents = () => ctx.api.incidents(t.id).then(setIncidents, (e) => setError(describeError(e)));

  useEffect(() => {
    if (desk) loadIncidents();
  }, [t.id]);

  useEffect(() => () => {
    if (viewing) URL.revokeObjectURL(viewing.url);
  }, [viewing]);

  async function addPhoto(i: Incident) {
    const photo = await takePhoto();
    if (!photo) return;
    setBusy(i.id);
    setError(null);
    try {
      await ctx.api.attachPhoto(t.id, i.id, photo);
      setInfo(tr("more.photo_added"));
      await loadIncidents();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  // An incident amended or deleted: the list is read again either way, so
  // what it shows is what the server kept.
  async function changed(message: string) {
    setAmending(null);
    setInfo(message);
    await loadIncidents();
  }

  async function showPhoto(i: Incident) {
    setBusy(i.id);
    setError(null);
    try {
      const blob = await ctx.api.photo(t.id, i.id);
      setViewing({ incident: i, url: URL.createObjectURL(blob) });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div class="more">
      <section>
        <h2>{tr("more.on_phone")}</h2>
        {queued.length === 0 ? (
          <Empty>{tr("more.nothing_waiting")}</Empty>
        ) : (
          <ul class="list compact">
            {queued.map((q) => (
              <li key={q.entry.cid} class="row">
                <span class="row-main static">
                  <span class="row-title">
                    {q.entry.kind === "result"
                      ? tr("more.queued_result", {
                          where: tr("more.round_board", { round: q.entry.round, board: String(q.label ?? q.entry.board) }),
                          result: resultLabel(q.entry.result),
                        })
                      : tr("more.queued_incident", {
                          where:
                            q.label ?? q.entry.board
                              ? tr("more.round_board", { round: q.entry.round, board: String(q.label ?? q.entry.board) })
                              : tr("more.round", { round: q.entry.round }),
                          kind: incidentKind(q.entry.type).toLowerCase(),
                        })}
                  </span>
                  <span class="row-sub">{q.state === "waiting" ? tr("more.waiting_to_send") : tr("more.not_accepted", { reason: refusalText(q) })}</span>
                </span>
                {q.state === "refused" && (
                  <button type="button" class="chip" id={`dismiss-${q.entry.cid}`} onClick={() => ctx.outbox.dismiss(q.entry.cid).then(ctx.bump)}>
                    {tr("more.dismiss")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {desk && (
        <section>
          <h2>{tr("more.incidents")}</h2>
          {error && (
            <Notice kind="error" onClose={() => setError(null)}>
              {error}
            </Notice>
          )}
          {info && (
            <Notice kind="ok" onClose={() => setInfo(null)}>
              {info}
            </Notice>
          )}
          {!incidents && !error && <Loading />}
          {!incidents && error && <TryAgain id="incidents-retry" onClick={() => {
            setError(null);
            loadIncidents();
          }} />}
          {incidents && incidents.length === 0 && <Empty>{tr("more.none_logged")}</Empty>}
          {incidents && incidents.length > 0 && (
            <ul class="list compact" id="incident-list">
              {incidents.map((i) => (
                <li key={i.id} class="row">
                  <span class="row-main static">
                    <span class="row-title">
                      {i.board ? tr("more.round_board", { round: i.round, board: i.board }) : tr("more.round", { round: i.round })}: {incidentKind(i.kind)}
                    </span>
                    <span class="row-sub">
                      {[i.white && i.black ? `${i.white} – ${i.black}` : null, i.note, i.by].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {!t.read_only && (
                    <button type="button" class="chip" id={`edit-incident-${i.id}`} disabled={busy === i.id} onClick={() => setAmending(i)}>
                      {tr("more.edit_incident")}
                    </button>
                  )}
                  {i.has_photo ? (
                    <button type="button" class="chip" id={`photo-${i.id}`} disabled={busy === i.id} onClick={() => showPhoto(i)}>
                      {tr("more.photo")}
                    </button>
                  ) : (
                    !t.read_only && (
                      <button type="button" class="chip" id={`add-photo-${i.id}`} disabled={busy === i.id} onClick={() => addPhoto(i)}>
                        {tr("more.add_photo")}
                      </button>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {desk && <BoardLinks ctx={ctx} t={t} />}

      {desk && (
        <section>
          <h2>{tr("set.title")}</h2>
          {canEdit ? (
            <button type="button" class="btn block" id="edit-settings" onClick={() => setEditing(true)}>
              {tr("more.change_settings")}
            </button>
          ) : (
            <p class="fine">{tr("more.read_only_settings")}</p>
          )}
          <dl class="settings" id="settings">
            {Object.entries(settingLabels()).map(([key, label]) => {
              const v = t.settings[key];
              if (v === null || v === undefined || v === "") return null;
              return (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{settingValue(key, v)}</dd>
                </div>
              );
            })}
            {Array.isArray(t.settings.tiebreaks) && (
              <div>
                <dt>{tr("set.tiebreaks")}</dt>
                <dd>{(t.settings.tiebreaks as string[]).map(tiebreakName).join(", ")}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {editing && (
        <SettingsEditor
          ctx={ctx}
          t={t}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            setInfo(tr("set.saved"));
            await props.reloadTournament?.();
          }}
        />
      )}

      {amending && <IncidentEditor ctx={ctx} t={t} incident={amending} onClose={() => setAmending(null)} onDone={changed} />}

      {viewing && (
        <Sheet
          title={
            viewing.incident.board
              ? tr("more.round_board", { round: viewing.incident.round, board: viewing.incident.board })
              : tr("more.round", { round: viewing.incident.round })
          }
          onClose={() => setViewing(null)}
        >
          <img class="incident-photo" id="incident-photo-view" src={viewing.url} alt={tr("more.photo_alt")} />
        </Sheet>
      )}

      <section>
        <h2>{tr("more.signed_in")}</h2>
        <p class="fine">
          {tr("more.signed_in_line", { who: ctx.server.user.name || ctx.server.user.email, server: ctx.server.label })}
          {ctx.server.info.version && tr("more.version", { version: ctx.server.info.version })}.
        </p>
      </section>
    </div>
  );
}

// An incident put right: its type and note changed, or the whole thing
// deleted (after a question - the photo goes with it). The server checks
// who may; a refusal is shown here and nothing moves.
function IncidentEditor(props: { ctx: Ctx; t: Tournament; incident: Incident; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const { ctx, t, incident } = props;
  const [kind, setKind] = useState(incident.kind);
  const [note, setNote] = useState(incident.note ?? "");
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const where = incident.board
    ? tr("more.round_board", { round: incident.round, board: incident.board })
    : tr("more.round", { round: incident.round });

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await props.onDone(message);
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }

  if (deleting) {
    return (
      <Sheet title={tr("more.incident_delete_title")} onClose={props.onClose}>
        <p>
          {where}: {incidentKind(incident.kind)}
          {incident.note ? ` · ${incident.note}` : ""}
        </p>
        <p>{tr("more.incident_delete_text")}</p>
        <div class="sheet-actions">
          <button
            type="button"
            class="btn danger block"
            id="incident-delete-confirm"
            disabled={busy}
            onClick={() => run(() => ctx.api.deleteIncident(t.id, incident.id), tr("more.incident_deleted"))}
          >
            {tr("more.incident_delete_yes")}
          </button>
          <button type="button" class="btn block" id="incident-delete-keep" onClick={() => setDeleting(false)}>
            {tr("common.keep")}
          </button>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
      </Sheet>
    );
  }

  return (
    <Sheet title={`${where}: ${tr("round.incident")}`} onClose={props.onClose} dirty={kind !== incident.kind || note !== (incident.note ?? "")}>
      <form
        class="form"
        id="incident-edit-form"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => ctx.api.updateIncident(t.id, incident.id, { kind, note: note.trim() }), tr("more.incident_saved"));
        }}
      >
        <label for="incident-edit-type">{tr("round.what")}</label>
        <select id="incident-edit-type" value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value)}>
          {incidentKinds().map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <label for="incident-edit-note">{tr("round.note")}</label>
        <textarea id="incident-edit-note" rows={3} maxLength={280} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
        <button type="submit" class="btn primary block" id="incident-save" disabled={busy}>
          {busy ? tr("set.saving") : tr("more.incident_save")}
        </button>
      </form>
      <button type="button" class="btn danger block" id="incident-delete" disabled={busy} onClick={() => setDeleting(true)}>
        {tr("more.incident_delete")}
      </button>
      {error && <Notice kind="error">{error}</Notice>}
    </Sheet>
  );
}
