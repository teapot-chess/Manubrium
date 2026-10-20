import { useEffect, useState } from "preact/hooks";
import { ApiError, type TournamentLine } from "../api";
import type { Ctx } from "./App";
import { describeError, Empty, Loading, Notice, TopBar } from "./common";

const ROLE: Record<string, string> = { owner: "Organiser", editor: "Editor", arbiter: "Arbiter" };

export function Tournaments(props: { ctx: Ctx; onServers: () => void; onOpen: (t: TournamentLine) => void }) {
  const { ctx } = props;
  const [list, setList] = useState<TournamentLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  async function load() {
    setError(null);
    try {
      setList(await ctx.api.tournaments());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSignedOut(true);
      setError(describeError(e));
    }
  }

  useEffect(() => {
    load();
  }, [ctx.server.base]);

  return (
    <div class="screen">
      <TopBar
        title="Tournaments"
        subtitle={ctx.server.label}
        right={
          <button type="button" class="chip" onClick={props.onServers} id="switch-server">
            Servers
          </button>
        }
      />
      <main class="content">
        {error && (
          <Notice kind="error">
            {error}
            {signedOut && " Remove the server and connect it again."}
          </Notice>
        )}
        {list === null && !error && <Loading />}
        {list && list.length === 0 && <Empty>No tournaments on this account yet. Make one at the desk.</Empty>}
        {list && list.length > 0 && (
          <ul class="list" id="tournament-list">
            {list.map((t) => {
              const waiting = ctx.outbox.count(ctx.server.base, t.id);
              return (
                <li key={t.id} class="row">
                  <button type="button" class="row-main" onClick={() => props.onOpen(t)}>
                    <span class="row-title">{t.name}</span>
                    <span class="row-sub">
                      {ROLE[t.role] ?? t.role} · round {t.paired_rounds || "–"} of {t.rounds_count ?? "?"}
                      {t.city ? ` · ${t.city}` : ""}
                      {waiting > 0 && ` · ${waiting} waiting`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {list && (
          <button type="button" class="btn ghost block" onClick={load}>
            Refresh
          </button>
        )}
      </main>
    </div>
  );
}
