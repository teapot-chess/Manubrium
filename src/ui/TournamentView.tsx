import { useEffect, useState } from "preact/hooks";
import type { Tournament, TournamentLine } from "../api";
import type { Ctx } from "./App";
import { describeError, Loading, Notice, TopBar, TryAgain } from "./common";
import { RoundScreen } from "./RoundScreen";
import { StandingsScreen } from "./StandingsScreen";
import { PlayersScreen } from "./PlayersScreen";
import { MoreScreen } from "./MoreScreen";

type Tab = "round" | "standings" | "players" | "more";

export function TournamentView(props: { ctx: Ctx; line: TournamentLine; onBack: () => void }) {
  const { ctx, line } = props;
  const [t, setT] = useState<Tournament | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("round");

  async function load() {
    try {
      setT(await ctx.api.tournament(line.id));
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }

  useEffect(() => {
    load();
  }, [line.id]);

  const can = (c: string) => t?.can.includes(c as never) ?? false;
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "round", label: "Round", show: true },
    { id: "standings", label: "Standings", show: can("standings") },
    { id: "players", label: "Players", show: can("players") },
    { id: "more", label: "More", show: true },
  ];

  return (
    <div class="screen with-tabs">
      <TopBar title={t?.name ?? line.name} subtitle={ctx.server.label} onBack={props.onBack} backLabel="Tournaments" />
      <main class="content">
        {error && !t && <Notice kind="error">{error}</Notice>}
        {error && !t && (
          <TryAgain
            id="tournament-retry"
            onClick={() => {
              setError(null);
              load();
            }}
          />
        )}
        {t?.read_only && (
          <Notice kind="info">
            {t.handed_off && !t.archived
              ? "This tournament was handed to another copy of OpenPairings; it is run from there now."
              : "This tournament is archived."}{" "}
            Everything here can be read; nothing can be changed.
          </Notice>
        )}
        {!t && !error && <Loading />}
        {t && tab === "round" && <RoundScreen ctx={ctx} t={t} reloadTournament={load} />}
        {t && tab === "standings" && <StandingsScreen ctx={ctx} t={t} />}
        {t && tab === "players" && <PlayersScreen ctx={ctx} t={t} />}
        {t && tab === "more" && <MoreScreen ctx={ctx} t={t} reloadTournament={load} />}
      </main>
      <nav class="tabs" aria-label="Tournament">
        {tabs
          .filter((x) => x.show)
          .map((x) => (
            <button
              type="button"
              key={x.id}
              id={`tab-${x.id}`}
              class={tab === x.id ? "active" : ""}
              aria-current={tab === x.id ? "page" : undefined}
              onClick={() => setTab(x.id)}
            >
              {x.label}
            </button>
          ))}
      </nav>
    </div>
  );
}
