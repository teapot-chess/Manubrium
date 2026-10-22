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
import { INCIDENT_KINDS } from "./RoundScreen";

const SETTING_LABELS: Record<string, string> = {
  type: "Type",
  venue: "Venue",
  city: "City",
  federation: "Federation",
  start_date: "Starts",
  end_date: "Ends",
  chief_arbiter: "Chief arbiter",
  deputy_arbiter: "Deputy arbiter",
  time_control: "Time control",
  rounds_count: "Rounds",
  bye_value: "Pairing bye scores",
  shared_places: "Shared places",
  fide_rated: "FIDE rated",
  postponed_games: "Postponed games",
  ask_bye_type: "Asks the bye type",
  publish_mode: "Publishing",
};

const TYPES: Record<string, string> = {
  swiss: "Swiss",
  roundrobin: "Round robin",
  "team-swiss": "Team Swiss",
  "team-roundrobin": "Team round robin",
};

const PUBLISH_MODES: Record<string, string> = {
  manual: "By hand",
  pairings: "Pairings as soon as a round is paired",
  results: "Pairings, and results as they come in",
  standings: "Pairings, results, and standings after each round",
};

/** An incident kind as the incident dialog named it, not as the database spells it. */
export function incidentKind(kind: string): string {
  return INCIDENT_KINDS.find(([v]) => v === kind)?.[1] ?? kind.replace(/_/g, " ");
}

/** A setting as a person reads it; the server's tokens stay the server's. */
export function settingValue(key: string, v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (key === "type") return TYPES[String(v)] ?? String(v);
  if (key === "publish_mode") return PUBLISH_MODES[String(v)] ?? String(v);
  if (key === "bye_value" && typeof v === "number") return v === 1 ? "1 point" : v === 0.5 ? "½ point" : `${v} points`;
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
      setInfo("Photo added.");
      await loadIncidents();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
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
        <h2>On this phone</h2>
        {queued.length === 0 ? (
          <Empty>Nothing waiting to be sent.</Empty>
        ) : (
          <ul class="list compact">
            {queued.map((q) => (
              <li key={q.entry.cid} class="row">
                <span class="row-main static">
                  <span class="row-title">
                    Round {q.entry.round}
                    {q.entry.kind === "result"
                      ? `, board ${q.label ?? q.entry.board}: ${resultLabel(q.entry.result)}`
                      : `${q.label ?? q.entry.board ? `, board ${q.label ?? q.entry.board}` : ""}: incident (${incidentKind(q.entry.type).toLowerCase()})`}
                  </span>
                  <span class="row-sub">{q.state === "waiting" ? "Waiting to send" : `Not accepted: ${refusalText(q)}`}</span>
                </span>
                {q.state === "refused" && (
                  <button type="button" class="chip" id={`dismiss-${q.entry.cid}`} onClick={() => ctx.outbox.dismiss(q.entry.cid).then(ctx.bump)}>
                    Dismiss
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {desk && (
        <section>
          <h2>Incidents</h2>
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
          {incidents && incidents.length === 0 && <Empty>None logged.</Empty>}
          {incidents && incidents.length > 0 && (
            <ul class="list compact" id="incident-list">
              {incidents.map((i) => (
                <li key={i.id} class="row">
                  <span class="row-main static">
                    <span class="row-title">
                      Round {i.round}
                      {i.board ? `, board ${i.board}` : ""}: {incidentKind(i.kind)}
                    </span>
                    <span class="row-sub">
                      {[i.white && i.black ? `${i.white} – ${i.black}` : null, i.note, i.by].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {i.has_photo ? (
                    <button type="button" class="chip" id={`photo-${i.id}`} disabled={busy === i.id} onClick={() => showPhoto(i)}>
                      Photo
                    </button>
                  ) : (
                    !t.read_only && (
                      <button type="button" class="chip" id={`add-photo-${i.id}`} disabled={busy === i.id} onClick={() => addPhoto(i)}>
                        Add photo
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
          <h2>Settings</h2>
          {canEdit ? (
            <button type="button" class="btn block" id="edit-settings" onClick={() => setEditing(true)}>
              Change the mid-event settings
            </button>
          ) : (
            <p class="fine">Read only here; change them at the desk.</p>
          )}
          <dl class="settings" id="settings">
            {Object.entries(SETTING_LABELS).map(([key, label]) => {
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
                <dt>Tie-breaks</dt>
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
            setInfo("Settings saved.");
            await props.reloadTournament?.();
          }}
        />
      )}

      {viewing && (
        <Sheet title={`Round ${viewing.incident.round}${viewing.incident.board ? `, board ${viewing.incident.board}` : ""}`} onClose={() => setViewing(null)}>
          <img class="incident-photo" id="incident-photo-view" src={viewing.url} alt="The incident's photo" />
        </Sheet>
      )}

      <section>
        <h2>Signed in</h2>
        <p class="fine">
          {ctx.server.user.name || ctx.server.user.email} on {ctx.server.label}
          {ctx.server.info.version && `, OpenPairings ${ctx.server.info.version}`}.
        </p>
      </section>
    </div>
  );
}
