// A player, tapped: their card from the server (`GET /players/:pid/card`,
// open to arbiters) - games so far with colours and results, the colour
// history, score, rating, club, requested byes - and for the arbiter a
// line when the player is not checked in or is on the default-time list.

import { useEffect, useState } from "preact/hooks";
import type { PlayerCard, Tournament } from "../api";
import { byeLabel } from "../byes";
import type { Ctx } from "./App";
import { describeError, Loading, Notice, Sheet, TryAgain } from "./common";
import { t as tr } from "../i18n";

/** "WBWB-W": the colours by round, a dash for a round without a game. */
export function colourHistory(card: PlayerCard): string {
  const byRound = new Map(card.games.map((g) => [g.round, g.colour]));
  const last = card.games.reduce((m, g) => Math.max(m, g.round), 0);
  let out = "";
  for (let r = 1; r <= last; r++) {
    const c = byRound.get(r);
    out += c === "w" ? tr("player.colour_w") : c === "b" ? tr("player.colour_b") : "-";
  }
  return out;
}

const points = (n: number) => String(n).replace(/\.5$/, "½").replace(/^0½$/, "½").replace(/\.0$/, "");

export function PlayerSheet(props: { ctx: Ctx; t: Tournament; playerId: number; waiting?: boolean; onClose: () => void }) {
  const { ctx, t, playerId } = props;
  const [card, setCard] = useState<PlayerCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    Promise.resolve()
      .then(() => ctx.api.playerCard(t.id, playerId))
      .then(setCard, (e) => setError(describeError(e)));
  };
  useEffect(load, [t.id, playerId]);

  const p = card?.player;
  return (
    <Sheet title={p ? `${p.title ? `${p.title} ` : ""}${p.name}` : tr("player.title")} onClose={props.onClose}>
      {!card && !error && <Loading />}
      {error && <Notice kind="error">{error}</Notice>}
      {error && <TryAgain id="player-card-retry" onClick={load} />}
      {card && p && (
        <div class="player-card" id="player-card">
          {(p.present === false || p.status !== "active" || props.waiting) && (
            <p class="missing-note" id="player-missing">
              {p.status === "withdrawn"
                ? tr("player.withdrawn")
                : p.status === "expelled"
                  ? tr("player.expelled")
                  : p.present === false
                    ? tr("player.not_checked_in")
                    : tr("player.on_default_list")}
            </p>
          )}
          <dl class="settings">
            <div>
              <dt>{tr("player.score")}</dt>
              <dd id="player-score">
                {points(card.score)}
                {card.rank !== null && card.rank !== "" ? ` · ${tr("player.rank", { rank: String(card.rank) })}` : ""}
              </dd>
            </div>
            {p.rating ? (
              <div>
                <dt>{tr("player.rating")}</dt>
                <dd>{p.rating}</dd>
              </div>
            ) : null}
            {p.club && (
              <div>
                <dt>{tr("player.club")}</dt>
                <dd>{p.club}</dd>
              </div>
            )}
            {p.federation && (
              <div>
                <dt>{tr("player.federation")}</dt>
                <dd>{p.federation}</dd>
              </div>
            )}
            {card.games.length > 0 && (
              <div>
                <dt>{tr("player.colours")}</dt>
                <dd class="mono" id="player-colours">
                  {colourHistory(card)}
                </dd>
              </div>
            )}
            {p.byes && p.byes.length > 0 && (
              <div>
                <dt>{tr("player.byes")}</dt>
                <dd id="player-byes">{p.byes.map((b) => tr("player.bye_line", { round: b.round, kind: byeLabel(b.kind) })).join(", ")}</dd>
              </div>
            )}
          </dl>

          <h3>{tr("player.games")}</h3>
          {card.games.length === 0 ? (
            <p class="empty">{tr("player.no_games")}</p>
          ) : (
            <ul class="list compact" id="player-games">
              {card.games.map((g) => (
                <li key={g.round} class="row">
                  <span class="game-round">{g.round}</span>
                  <span class={`colour-dot ${g.colour ?? "none"}`} aria-label={g.colour === "w" ? tr("player.white") : g.colour === "b" ? tr("player.black") : ""} />
                  <span class="row-main static">
                    <span class="row-title">{g.opponent ? `${g.opponent.title ? `${g.opponent.title} ` : ""}${g.opponent.name}` : tr("round.bye")}</span>
                    {g.opponent?.rating ? <span class="row-sub">{g.opponent.rating}</span> : null}
                  </span>
                  <span class="game-result">{g.result || "–"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  );
}
