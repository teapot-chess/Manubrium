import { useEffect, useState } from "preact/hooks";
import { ApiError, OfflineError, type Tournament, type TournamentLine } from "../api";
import { hallRoutes } from "../hall";
import type { Ctx } from "./App";
import { describeError, Empty, Loading, Notice, TopBar, TryAgain } from "./common";
import { t as tr } from "../i18n";

const roleName = (role: string): string =>
  role === "owner" ? tr("tournaments.role.owner") : role === "editor" ? tr("tournaments.role.editor") : role === "arbiter" ? tr("tournaments.role.arbiter") : role;

/** A kept tournament as a line of the list. */
function lineOf(t: Tournament): TournamentLine {
  const s = (t.settings ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: t.id,
    name: t.name,
    role: t.role,
    status: t.status,
    start_date: text(s.start_date),
    end_date: text(s.end_date),
    city: text(s.city),
    rounds_count: t.rounds_count,
    paired_rounds: t.paired_rounds,
  };
}

export function Tournaments(props: { ctx: Ctx; onServers: () => void; onNew: () => void; onOpen: (t: TournamentLine) => void }) {
  const { ctx } = props;
  const [list, setList] = useState<TournamentLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  async function load() {
    setError(null);
    try {
      setList(await ctx.api.tournaments());
      setSignedOut(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSignedOut(true);
      // No cloud: the relayed tournaments whose laptop this phone holds a
      // pass for are still worth opening (src/hall.ts).
      const kept = e instanceof OfflineError ? (hallRoutes.keptTournaments(ctx.server.base) as Tournament[]) : [];
      if (kept.length) {
        setList(kept.map(lineOf));
        setError(tr("tournaments.offline_kept"));
        return;
      }
      setError(describeError(e));
    }
  }

  useEffect(() => {
    load();
  }, [ctx.server.base]);

  return (
    <div class="screen">
      <TopBar
        title={tr("tournaments.title")}
        subtitle={ctx.server.label}
        right={
          <button type="button" class="chip" onClick={props.onServers} id="switch-server">
            {tr("tournaments.servers")}
          </button>
        }
      />
      <main class="content">
        {error && (
          <Notice kind="error">
            {error}
            {signedOut && tr("tournaments.signed_out_hint")}
          </Notice>
        )}
        {list === null && !error && <Loading />}
        {list && list.length === 0 && <Empty>{tr("tournaments.empty")}</Empty>}
        {list && list.length > 0 && (
          <ul class="list" id="tournament-list">
            {list.map((t) => {
              const waiting = ctx.outbox.count(ctx.server.base, t.id);
              return (
                <li key={t.id} class="row">
                  <button type="button" class="row-main" onClick={() => props.onOpen(t)}>
                    <span class="row-title">{t.name}</span>
                    <span class="row-sub">
                      {roleName(t.role)} · {tr("tournaments.row_round", { paired: t.paired_rounds || "–", total: t.rounds_count ?? "?" })}
                      {t.city ? ` · ${t.city}` : ""}
                      {waiting > 0 && ` · ${tr("tournaments.waiting", { n: waiting })}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {list && !signedOut && (
          <button type="button" class="btn primary block" id="new-tournament-btn" onClick={props.onNew}>
            {tr("tournaments.new")}
          </button>
        )}
        {list && (
          <button type="button" class="btn ghost block" onClick={load}>
            {tr("tournaments.refresh")}
          </button>
        )}
        {!list && error && !signedOut && <TryAgain id="tournaments-retry" onClick={load} />}
      </main>
    </div>
  );
}
