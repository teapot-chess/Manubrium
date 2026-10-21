import { useEffect, useState } from "preact/hooks";
import type { Standings, Tournament } from "../api";
import type { Ctx } from "./App";
import { describeError, Empty, Loading, Notice, ShareButton } from "./common";
import { formatNumber as format, standingsText } from "../share";

/**
 * Mid-round, points already count the results entered, but tie-breaks only
 * count complete rounds - on the server's Standings page too. Without a word
 * about it, a leader on 2 points with a Buchholz of 0 looks like a bug.
 */
export function tiebreakNote(s: Standings): string | null {
  const through = s.tiebreaks_through;
  const paired = s.rounds_paired;
  if (s.tiebreaks.length === 0 || through === undefined || paired === undefined || through >= paired) return null;
  return through === 0
    ? "Tie-breaks count complete rounds only, and no round is complete yet."
    : `Tie-breaks count complete rounds only: up to round ${through}. Points include every result entered so far.`;
}

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
      {s && s.rows.length > 0 && tiebreakNote(s) && (
        <p class="fine" id="standings-tiebreak-note">
          {tiebreakNote(s)}
        </p>
      )}
      {s && (
        <button type="button" class="btn ghost block" onClick={load}>
          Refresh
        </button>
      )}
    </div>
  );
}

