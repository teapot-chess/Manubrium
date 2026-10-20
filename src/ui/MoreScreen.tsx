// More: the incidents (desk roles), the settings worth reading from a
// phone, and the outbox for this tournament.

import { useEffect, useState } from "preact/hooks";
import type { Incident, Tournament } from "../api";
import type { Ctx } from "./App";
import { describeError, Empty, Notice } from "./common";

const SETTING_LABELS: Record<string, string> = {
  type: "Type",
  venue: "Venue",
  city: "City",
  federation: "Federation",
  start_date: "Starts",
  end_date: "Ends",
  chief_arbiter: "Chief arbiter",
  time_control: "Time control",
  fide_rated: "FIDE rated",
  postponed_games: "Postponed games",
  ask_bye_type: "Asks the bye type",
  publish_mode: "Publishing",
};

export function MoreScreen(props: { ctx: Ctx; t: Tournament }) {
  const { ctx, t } = props;
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const desk = t.can.includes("settings");
  const queued = ctx.outbox.list(ctx.server.base, t.id);

  useEffect(() => {
    if (desk) ctx.api.incidents(t.id).then(setIncidents, (e) => setError(describeError(e)));
  }, [t.id]);

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
                  <span class="row-sub">{q.state === "waiting" ? "Waiting to send" : `Not accepted: ${q.message}`}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {desk && (
        <section>
          <h2>Incidents</h2>
          {error && <Notice kind="error">{error}</Notice>}
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
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {desk && (
        <section>
          <h2>Settings</h2>
          <p class="fine">Read only here; change them at the desk.</p>
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
