// A team event's standings: the teams as the Standings page ranks them
// (match points or game points first, then the event's tie-breaks), the
// individual ranking of everyone who played a game, and the board prizes
// per board with the minimum number of games to count. Read-only; the
// desk roles, like the individual standings, and shared the same way.

import { useEffect, useRef, useState } from "preact/hooks";
import type { BoardPrizes, TeamStandings, Tournament } from "../api";
import { points } from "../matches";
import { formatNumber as format, teamStandingsText } from "../share";
import type { Ctx } from "./App";
import { describeError, Empty, Loading, Notice, ShareButton, TryAgain } from "./common";
import { PlayerSheet } from "./PlayerSheet";
import { t as tr } from "../i18n";

type View = "teams" | "players" | "boards";

const percent = (n: number | null) => (n === null ? "" : `${Math.round(n)}%`);

export function TeamStandingsScreen(props: { ctx: Ctx; t: Tournament }) {
  const { ctx, t } = props;
  const [s, setS] = useState<TeamStandings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("teams");
  const [player, setPlayer] = useState<number | null>(null);

  async function load() {
    setError(null);
    try {
      setS(await ctx.api.teamStandings(t.id));
    } catch (e) {
      setError(describeError(e));
    }
  }

  useEffect(() => {
    void load();
  }, [t.id]);

  const views: { id: View; label: string }[] = [
    { id: "teams", label: tr("tstand.teams") },
    { id: "players", label: tr("tstand.players") },
    { id: "boards", label: tr("tstand.boards") },
  ];

  return (
    <div class="standings team-standings" id="team-standings">
      {error && <Notice kind="error">{error}</Notice>}
      {error && !s && <TryAgain id="team-standings-retry" onClick={() => void load()} />}
      {!s && !error && <Loading />}
      {s && (
        <>
          <div class="segmented three" role="group" aria-label={tr("tstand.view")}>
            {views.map((v) => (
              <button type="button" key={v.id} id={`tstand-${v.id}`} class={view === v.id ? "active" : ""} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
                {v.label}
              </button>
            ))}
          </div>
          {s.rows.length > 0 && (
            <div class="view-tools">
              <ShareButton id="share-team-standings" title={tr("standings.share_title", { name: t.name })} text={() => teamStandingsText(t, s)} />
            </div>
          )}
          {view === "teams" && <TeamTable s={s} />}
          {view === "players" && <PlayerTable s={s} onPlayer={setPlayer} />}
          {view === "boards" && <BoardPrizesPanel ctx={ctx} t={t} onPlayer={setPlayer} />}
          <button type="button" class="btn ghost block" onClick={() => void load()}>
            {tr("tournaments.refresh")}
          </button>
        </>
      )}
      {player !== null && <PlayerSheet ctx={ctx} t={t} playerId={player} onClose={() => setPlayer(null)} />}
    </div>
  );
}

function TeamTable(props: { s: TeamStandings }) {
  const { s } = props;
  if (s.rows.length === 0) return <Empty>{tr("tstand.none")}</Empty>;
  // The primary score is shown as its own columns already; the tie-breaks
  // list repeats MP and GP, which the table has, so leave those out.
  const extra = s.tiebreaks.filter((tb) => tb.code !== "MP" && tb.code !== "GP");
  const provisional = s.rows.some((r) => r.pending_boards > 0);
  return (
    <>
      <div class="table-wrap">
        <table id="team-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{tr("tstand.team")}</th>
              <th scope="col" class="num" title={tr("tstand.mp_title")}>
                {tr("tstand.mp")}
              </th>
              <th scope="col" class="num" title={tr("tstand.gp_title")}>
                {tr("tstand.gp")}
              </th>
              <th scope="col" class="num" title={tr("tstand.played")}>
                {tr("tstand.p")}
              </th>
              <th scope="col" class="num" title={tr("tstand.won")}>
                {tr("tstand.w")}
              </th>
              <th scope="col" class="num" title={tr("tstand.drawn")}>
                {tr("tstand.d")}
              </th>
              <th scope="col" class="num" title={tr("tstand.lost")}>
                {tr("tstand.l")}
              </th>
              {extra.map((tb) => (
                <th scope="col" class="num" key={tb.code} title={tb.name}>
                  {tb.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.team.id} class={r.withdrawn_from_round !== null ? "withdrawn" : ""} id={`team-row-${r.team.id}`}>
                <td>{r.rank}</td>
                <td class="player">
                  {r.team.short_name || r.team.name}
                  {r.withdrawn_from_round !== null && <small class="tag warn">{tr("teams.withdrawn_from", { n: r.withdrawn_from_round })}</small>}
                  {r.annulled && <small class="tag warn">{tr("tstand.annulled")}</small>}
                </td>
                <td class={`num ${s.primary === "MP" ? "strong" : ""}`}>{points(r.mp)}</td>
                <td class={`num ${s.primary === "GP" ? "strong" : ""}`}>{points(r.gp)}</td>
                <td class="num">{r.played}</td>
                <td class="num">{r.won}</td>
                <td class="num">{r.drawn}</td>
                <td class="num">{r.lost}</td>
                {extra.map((tb) => (
                  <td class="num" key={tb.code}>
                    {format(r.tiebreaks[tb.code])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {provisional && (
        <p class="fine" id="team-standings-provisional">
          {tr("tstand.provisional")}
        </p>
      )}
      <p class="fine">{s.primary === "MP" ? tr("tstand.ranked_mp") : tr("tstand.ranked_gp")}</p>
    </>
  );
}

function PlayerTable(props: { s: TeamStandings; onPlayer: (id: number) => void }) {
  const { s } = props;
  if (s.players.length === 0) return <Empty>{tr("tstand.no_players")}</Empty>;
  return (
    <div class="table-wrap">
      <table id="team-players">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">{tr("standings.player")}</th>
            <th scope="col">{tr("tstand.team")}</th>
            <th scope="col" class="num">
              {tr("tstand.games")}
            </th>
            <th scope="col" class="num">
              {tr("standings.pts")}
            </th>
            <th scope="col" class="num">
              %
            </th>
          </tr>
        </thead>
        <tbody>
          {s.players.map((r) => (
            <tr key={r.player.id}>
              <td>{r.rank}</td>
              <td class="player">
                <button type="button" class="link" id={`tstand-player-${r.player.id}`} onClick={() => props.onPlayer(r.player.id)}>
                  {r.player.title && <em>{r.player.title} </em>}
                  {r.player.name}
                </button>
              </td>
              <td>{r.team ? r.team.short_name || r.team.name : ""}</td>
              <td class="num">{r.games}</td>
              <td class="num strong">{points(r.points)}</td>
              <td class="num">{percent(r.percentage)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The board prizes: per board, the players who sat there ranked on what they
 * scored there. A player with fewer games than the minimum on a board is
 * left out of that board; the minimum starts at the desk's default (half the
 * rounds paired) and the arbiter can move it.
 */
export function BoardPrizesPanel(props: { ctx: Ctx; t: Tournament; onPlayer: (id: number) => void }) {
  const { ctx, t } = props;
  const [prizes, setPrizes] = useState<BoardPrizes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [min, setMin] = useState<number | null>(null);
  // Only the newest answer may land: tapping + three times asks three times.
  const asked = useRef(0);

  async function load(minGames?: number) {
    const mine = ++asked.current;
    setError(null);
    try {
      const answer = await ctx.api.boardPrizes(t.id, minGames);
      if (mine !== asked.current) return;
      setPrizes(answer);
      setMin(answer.min_games);
    } catch (e) {
      if (mine === asked.current) setError(describeError(e));
    }
  }

  useEffect(() => {
    void load();
  }, [t.id]);

  const shown = min ?? prizes?.min_games ?? 0;
  const rounds = Math.max(t.paired_rounds, 1);
  return (
    <section class="board-prizes" id="board-prizes">
      {error && <Notice kind="error">{error}</Notice>}
      {error && !prizes && <TryAgain id="board-prizes-retry" onClick={() => void load(min ?? undefined)} />}
      {!prizes && !error && <Loading />}
      {prizes && (
        <>
          <div class="min-games" id="min-games">
            <span id="min-games-label">{tr("tstand.min_games")}</span>
            <span class="stepper" role="group" aria-labelledby="min-games-label">
              <button type="button" class="chip" id="min-games-down" aria-label={tr("tstand.fewer")} disabled={shown <= 0} onClick={() => void load(Math.max(0, shown - 1))}>
                −
              </button>
              <output id="min-games-value" aria-live="polite">
                {shown}
              </output>
              <button type="button" class="chip" id="min-games-up" aria-label={tr("tstand.more")} disabled={shown >= rounds} onClick={() => void load(shown + 1)}>
                +
              </button>
            </span>
            {shown !== prizes.default_min_games && (
              <button type="button" class="chip" id="min-games-default" onClick={() => void load(prizes.default_min_games)}>
                {tr("tstand.default_min", { n: prizes.default_min_games })}
              </button>
            )}
          </div>
          {prizes.boards.length === 0 && <Empty>{tr("tstand.no_boards")}</Empty>}
          {prizes.boards.map((b) => (
            <div class="prize-table" key={b.board} id={`board-prize-${b.board}`}>
              <h3 class="sub">{tr("tstand.board_n", { n: b.board })}</h3>
              {b.rows.length === 0 ? (
                <p class="fine">{tr("tstand.board_empty")}</p>
              ) : (
                <ul class="list compact">
                  {b.rows.map((r) => (
                    <li class="row" key={r.player.id}>
                      <span class="game-round">{r.rank}</span>
                      <span class="row-main static">
                        <span class="row-title">
                          <button type="button" class="link" onClick={() => props.onPlayer(r.player.id)}>
                            {r.player.title ? `${r.player.title} ` : ""}
                            {r.player.name}
                          </button>
                        </span>
                        <span class="row-sub">
                          {[r.team ? r.team.short_name || r.team.name : null, tr("tstand.games_played", { n: r.games }), percent(r.percentage), r.performance ? tr("tstand.perf", { n: r.performance }) : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span class="game-result">{points(r.points)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
