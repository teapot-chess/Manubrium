import { useEffect, useState } from "preact/hooks";
import type { Standings, Tournament } from "../api";
import type { Ctx } from "./App";
import { describeError, Empty, Loading, Notice, ShareButton } from "./common";
import { formatNumber as format, standingsText } from "../share";

export function StandingsScreen(props: { ctx: Ctx; t: Tournament }) {
  const [s, setS] = useState<Standings | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setS(await props.ctx.api.standings(props.t.id));
    } catch (e) {
      setError(describeError(e));
    }
  }

  useEffect(() => {
    load();
  }, [props.t.id]);

  return (
    <div class="standings">
      {error && <Notice kind="error">{error}</Notice>}
      {!s && !error && <Loading />}
      {s && s.rows.length === 0 && <Empty>No players yet.</Empty>}
      {s && s.rows.length > 0 && (
        <div class="view-tools">
          <ShareButton id="share-standings" title={`${props.t.name}, standings`} text={() => standingsText(props.t, s)} />
        </div>
      )}
      {s && s.rows.length > 0 && (
        <div class="table-wrap">
          <table id="standings">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Player</th>
                <th scope="col" class="num">Pts</th>
                {s.tiebreaks.map((tb) => (
                  <th scope="col" class="num" key={tb.code} title={tb.name}>
                    {tb.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r, i) => (
                <tr key={r.player?.id ?? i}>
                  <td>{r.rank ?? ""}</td>
                  <td class="player">
                    {r.player?.title && <em>{r.player.title} </em>}
                    {r.player?.name}
                  </td>
                  <td class="num strong">{r.points}</td>
                  {s.tiebreaks.map((tb) => (
                    <td class="num" key={tb.code}>
                      {format(r.tiebreaks[tb.code])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s && (
        <button type="button" class="btn ghost block" onClick={load}>
          Refresh
        </button>
      )}
    </div>
  );
}

