// More: the incidents (desk roles) with their photos, the hall boards
// (Alnasl), the settings - read, and the mid-event ones changed - and the
// outbox for this tournament.

import { useEffect, useState } from "preact/hooks";
import type { Incident, Tournament } from "../api";
import { takePhoto } from "../platform";
import type { Ctx } from "./App";
import { describeError, Empty, Notice, Sheet } from "./common";
import { SettingsEditor } from "./SettingsEditor";
import { BoardLinks } from "./BoardLinks";
import { refusalText } from "../queue";

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
                    {q.entry.kind === "result" ? `, board ${q.entry.board}: ${q.entry.result}` : `: incident (${q.entry.type})`}
                  </span>
                  <span class="row-sub">{q.state === "waiting" ? "Waiting to send" : `Not accepted: ${refusalText(q)}`}</span>
                </span>
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
          {incidents && incidents.length === 0 && <Empty>None logged.</Empty>}
          {incidents && incidents.length > 0 && (
            <ul class="list compact" id="incident-list">
              {incidents.map((i) => (
                <li key={i.id} class="row">
                  <span class="row-main static">
                    <span class="row-title">
                      Round {i.round}
                      {i.board ? `, board ${i.board}` : ""}: {i.kind.replace(/_/g, " ")}
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
                  <dd>{typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}</dd>
                </div>
              );
            })}
            {Array.isArray(t.settings.tiebreaks) && (
              <div>
                <dt>Tie-breaks</dt>
                <dd>{(t.settings.tiebreaks as string[]).join(", ")}</dd>
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
