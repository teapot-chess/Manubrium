import { useEffect, useState } from "preact/hooks";
import { OfflineError, type Tournament, type TournamentLine } from "../api";
import type { Ctx } from "./App";
import { describeError, Loading, Notice, TopBar, TryAgain } from "./common";
import { t as tr } from "../i18n";
import { RoundScreen } from "./RoundScreen";
import { StandingsScreen } from "./StandingsScreen";
import { PlayersScreen } from "./PlayersScreen";
import { MoreScreen } from "./MoreScreen";
import { TeamsScreen } from "./TeamsScreen";
import { TeamStandingsScreen } from "./TeamStandings";
import { RelayBanner, RelayCommands } from "./RelayCommands";
import { writableWhenRelayed } from "../relay";

type Tab = "round" | "teams" | "standings" | "players" | "more";

export function TournamentView(props: { ctx: Ctx; line: TournamentLine; onBack: () => void }) {
  const { ctx, line } = props;
  const [t, setT] = useState<Tournament | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("round");

  async function load() {
    try {
      // A relayed tournament is locked here but not on its laptop, which
      // takes every write the app makes (src/relay.ts).
      setT(writableWhenRelayed(await ctx.api.tournament(line.id)));
      setError(null);
    } catch (e) {
      // Offline with a record already open is the round screen's business
      // (it says so, and the outbox carries on); anything else is shown.
      if (!(e instanceof OfflineError && t)) setError(describeError(e));
    }
  }

  useEffect(() => {
    load();
  }, [line.id]);

  const can = (c: string) => t?.can.includes(c as never) ?? false;
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "round", label: tr("tabs.round"), show: true },
    { id: "teams", label: tr("tabs.teams"), show: t?.team ?? false },
    { id: "standings", label: tr("tabs.standings"), show: can("standings") },
    { id: "players", label: tr("tabs.players"), show: can("players") },
    { id: "more", label: tr("tabs.more"), show: true },
  ];

  return (
    <div class="screen with-tabs">
      <TopBar title={t?.name ?? line.name} subtitle={ctx.server.label} onBack={props.onBack} backLabel={tr("tournaments.title")} />
      <main class="content">
        {error && !t && <Notice kind="error">{error}</Notice>}
        {error && t && (
          <Notice kind="error" onClose={() => setError(null)}>
            {error}
          </Notice>
        )}
        {error && !t && (
          <TryAgain
            id="tournament-retry"
            onClick={() => {
              setError(null);
              load();
            }}
          />
        )}
        {t && <RelayBanner t={t} base={ctx.server.base} />}
        {t && <RelayCommands ctx={ctx} t={t} onAnswered={() => void load()} />}
        {t?.read_only && (
          <Notice kind="info">
            {t.handed_off && !t.archived
              ? tr("tournament.handed_off")
              : tr("tournament.archived")}{" "}
            {tr("tournament.read_only_tail")}
          </Notice>
        )}
        {!t && !error && <Loading />}
        {t && tab === "round" && <RoundScreen ctx={ctx} t={t} reloadTournament={load} />}
        {t && tab === "teams" && <TeamsScreen ctx={ctx} t={t} />}
        {t && tab === "standings" && (t.team ? <TeamStandingsScreen ctx={ctx} t={t} /> : <StandingsScreen ctx={ctx} t={t} />)}
        {t && tab === "players" && <PlayersScreen ctx={ctx} t={t} />}
        {t && tab === "more" && <MoreScreen ctx={ctx} t={t} reloadTournament={load} />}
      </main>
      <nav class="tabs" aria-label={tr("tournament.nav_aria")}>
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
