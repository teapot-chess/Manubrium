// A player, tapped: their card from the server (`GET /players/:pid/card`,
// open to arbiters) - games so far with colours and results, the colour
// history, score, rating, club, requested byes - and for the arbiter a
// line when the player is not checked in or is on the default-time list.
//
// And the sentence every arbiter hears between rounds: "I will not be
// playing the next one." The organiser and editors can note it here, and
// take it back; what the round is then worth, and whether it is allowed at
// all, is the server's to say.

import { useEffect, useState } from "preact/hooks";
import { ApiError, type PlayerCard, type Tournament } from "../api";
import { byeLabel, byesToSend, canSitOut, nextRound, setBye } from "../byes";
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

          {canSitOut(t, p) && <SitOut ctx={ctx} t={t} card={card} onCard={setCard} />}

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

/**
 * "Will not play round N", and its way back. The bye is one of the kinds
 * the tournament offers (`bye_kinds`): a plain absence, or where the
 * tournament asks the bye type, the half-point, zero-point or full-point
 * bye. Two taps, because a player left out of a pairing by a stray thumb
 * is a conversation nobody wants.
 *
 * The server keeps a player's byes as one list and takes it whole, so the
 * card is read again just before it is sent: what the desk changed for
 * another round in the meantime is kept, not overwritten. Where the desk
 * would ask first (a second half-point bye, a round already sent for
 * rating) the server's question is shown and answered here. Online only.
 */
function SitOut(props: { ctx: Ctx; t: Tournament; card: PlayerCard; onCard: (card: PlayerCard) => void }) {
  const { ctx, t, card } = props;
  const player = card.player;
  const round = nextRound(t)!;
  const kinds = t.bye_kinds ?? [];
  const current = (player.byes ?? []).find((b) => b.round === round) ?? null;
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ ids: string[]; message: string; kind: string | null } | null>(null);

  async function change(kind: string | null, acknowledged: string[] = []) {
    setBusy(true);
    setError(null);
    setSaid(null);
    try {
      const fresh = await ctx.api.playerCard(t.id, player.id);
      const byes = setBye(fresh.player.byes ?? [], round, kind, t.paired_rounds);
      const list = byesToSend(byes, t.paired_rounds);
      await (acknowledged.length ? ctx.api.setByes(t.id, player.id, list, acknowledged) : ctx.api.setByes(t.id, player.id, list));
      // The card as the server now has it, before anything is said: the
      // sentence and the button under it must not disagree, even for a second.
      const now = await ctx.api.playerCard(t.id, player.id).catch(() => ({ ...fresh, player: { ...fresh.player, byes } }));
      props.onCard(now);
      setAsk(null);
      setPicking(false);
      setSaid(kind ? tr("sitout.done", { name: player.name, round, kind: byeLabel(kind) }) : tr("sitout.undone", { name: player.name, round }));
    } catch (e) {
      if (e instanceof ApiError && e.code === "needs_acknowledgement") {
        setAsk({ ids: Array.isArray(e.body.confirm) ? (e.body.confirm as string[]) : [], message: e.message, kind });
      } else {
        setAsk(null);
        setError(describeError(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="sit-out" id="sit-out">
      <h3>{tr("more.round", { round })}</h3>
      {ask ? (
        <div class="confirm" id="sit-out-ask">
          <p>{ask.message}</p>
          <button type="button" class="btn primary block" id="sit-out-confirm" disabled={busy} onClick={() => change(ask.kind, ask.ids)}>
            {tr("round.confirm")}
          </button>
          <button type="button" class="btn block" id="sit-out-ask-keep" disabled={busy} onClick={() => setAsk(null)}>
            {tr("common.keep")}
          </button>
        </div>
      ) : current ? (
        <>
          <p class="missing-note" id="sit-out-state">
            {tr("sitout.is", { round, kind: byeLabel(current.kind) })}
          </p>
          <button type="button" class="btn block" id="sit-out-undo" disabled={busy} onClick={() => change(null)}>
            {tr("sitout.undo", { round })}
          </button>
        </>
      ) : picking ? (
        <div class="confirm" id="sit-out-pick">
          <p>{tr(kinds.length === 1 ? "sitout.pick_one" : "sitout.pick", { name: player.name, round })}</p>
          {kinds.map((k) => (
            <button type="button" key={k.id} class="btn block" id={`sit-out-${k.id}`} disabled={busy} onClick={() => change(k.id)}>
              {byeLabel(k.id)}
            </button>
          ))}
          <button type="button" class="btn ghost block" id="sit-out-keep" disabled={busy} onClick={() => setPicking(false)}>
            {tr("sitout.plays")}
          </button>
        </div>
      ) : (
        <button type="button" class="btn block" id="sit-out-open" disabled={busy} onClick={() => setPicking(true)}>
          {tr("sitout.button", { round })}
        </button>
      )}
      {said && <Notice kind="ok">{said}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
    </section>
  );
}
