// A team event's round: one card per match - the two teams, the running
// score, the match points once it is over - with its boards under it, in
// the layout the tournament asks for (`team_board_layout`): each team on
// its own side on every board, or White on the left on every board. Either
// way every player carries a colour mark, and the result between two
// players reads left to right, the left player's score first.
//
// Also the line-ups: whether each team's is confirmed, and - for the
// organiser and editors - confirming one as it stands, or all of them. The
// server decides who may and what a confirmation does; the phone asks and
// draws the round it answers with. Changing a line-up stays at the desk.
//
// Tapping a board is the round screen's business and works as on any board.

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { Board, Match, MatchSide, Round, TeamBoardLayout, Tournament } from "../api";
import { lineup, matchScore, points, pointValues, resultBetween, seats, unconfirmed, type MatchCard, type MatchView, type Seat } from "../matches";
import type { Queued } from "../queue";
import type { Ctx } from "./App";
import { describeError, Notice, resultLabel, Sheet } from "./common";
import { t as tr } from "../i18n";

const teamName = (match: Match, side: MatchSide): string => (side === "a" ? match.team_a.name : (match.team_b?.name ?? ""));

export function ColourDot(props: { colour: "w" | "b" }) {
  return <span class={`colour-dot ${props.colour}`} role="img" aria-label={tr(props.colour === "w" ? "player.white" : "player.black")} />;
}

function SeatCell(props: { seat: Seat; side: "left" | "right"; team?: string }) {
  const { seat } = props;
  return (
    <span class={`seat ${props.side}`}>
      <ColourDot colour={seat.colour} />
      <span class="seat-text">
        <span class="seat-name">
          {seat.player ? (
            <>
              {seat.player.title && <em>{seat.player.title} </em>}
              {seat.player.name}
            </>
          ) : (
            "–"
          )}
        </span>
        {(seat.player?.rating || props.team) && <small>{[seat.player?.rating || null, props.team].filter(Boolean).join(" · ")}</small>}
      </span>
    </span>
  );
}

export function MatchList(props: {
  t: Tournament;
  view: MatchView;
  layout: TeamBoardLayout;
  /** This phone's results still waiting to be sent, by pairing id. */
  waitingFor: Map<number, Queued>;
  /** Whether a board can be tapped at all (the round screen's own rule). */
  disabled: (b: Board) => boolean;
  /** Boards to leave out (a filter); a match with none left is left out too. */
  hidden?: (b: Board) => boolean;
  canConfirm: boolean;
  onBoard: (b: Board) => void;
  onLineup: (card: MatchCard, side: MatchSide) => void;
  /** The hall board's line under a pairing; the round screen owns how it looks. */
  report: (b: Board) => ComponentChildren;
}) {
  const { t, view, layout, waitingFor } = props;
  const values = pointValues(t);
  const pending = new Map<number, string>();
  for (const [id, q] of waitingFor) if (q.entry.kind === "result") pending.set(id, q.entry.result);
  const shownRows = (card: MatchCard) => (props.hidden ? card.rows.filter((r) => !props.hidden!(r.board)) : card.rows);

  return (
    <div class="matches" id="matches">
      {view.cards.map((card) => {
        const { match } = card;
        const rows = shownRows(card);
        if (props.hidden && rows.length === 0) return null;
        const score = matchScore(card, pending, values);
        return (
          <section class={`match ${match.lineups.confirmed ? "" : "provisional"}`} key={match.id} id={`match-${match.id}`}>
            <header class="match-head">
              <div class="match-meta">
                <span class="match-no">{tr("match.number", { n: match.number ?? "–" })}</span>
                {match.bye ? null : match.lineups.confirmed ? (
                  <span class="match-lineups" id={`lineups-confirmed-${match.id}`}>
                    {tr("match.lineups_confirmed")}
                  </span>
                ) : (
                  <span class="match-lineups waiting" id={`lineups-provisional-${match.id}`}>
                    {tr("match.provisional")}
                  </span>
                )}
              </div>
              {match.bye ? (
                <div class="match-teams">
                  <span class="match-team a">{match.team_a.name}</span>
                  <span class="match-score bye">{tr("match.bye")}</span>
                  <span class="match-team b" />
                </div>
              ) : (
                <div class="match-teams">
                  <span class="match-team a">{match.team_a.name}</span>
                  <span class={`match-score ${score.waiting ? "waiting" : ""}`} id={`match-score-${match.id}`}>
                    {points(score.a)} – {points(score.b)}
                  </span>
                  <span class="match-team b">{match.team_b?.name}</span>
                </div>
              )}
              <MatchNotes match={match} waiting={score.waiting} matchPoints={score.matchPoints} />
              {!match.bye && !match.lineups.confirmed && (
                <div class="lineup-chips">
                  {(["a", "b"] as const).map((side) => {
                    const done = match.lineups[side];
                    return (
                      <button
                        type="button"
                        key={side}
                        class={`chip ${done ? "active" : ""}`}
                        id={`lineup-${match.id}-${side}`}
                        onClick={() => props.onLineup(card, side)}
                      >
                        {done
                          ? tr("match.team_confirmed", { team: teamName(match, side) })
                          : props.canConfirm
                            ? tr("match.confirm_team", { team: teamName(match, side) })
                            : tr("match.team_waiting", { team: teamName(match, side) })}
                      </button>
                    );
                  })}
                </div>
              )}
            </header>
            {rows.length > 0 && (
              <ul class="boards match-boards">
                {rows.map((row) => {
                  const b = row.board;
                  const q = waitingFor.get(b.id);
                  const shown = q && q.entry.kind === "result" ? q.entry.result : b.result;
                  const { left, right } = seats(row, layout);
                  const team = (seat: Seat) => (layout === "white_left" ? (seat.team === "a" ? match.team_a : match.team_b) : null);
                  const tag = (seat: Seat) => {
                    const of = team(seat);
                    return of ? of.short_name || of.name : undefined;
                  };
                  return (
                    <li key={b.id}>
                      <button
                        type="button"
                        class={`board match-board ${shown ? "done" : ""} ${q ? "pending" : ""} ${b.phone?.state === "unconfirmed" ? "from-phone" : ""}`}
                        id={`board-${b.id}`}
                        disabled={props.disabled(b)}
                        onClick={() => props.onBoard(b)}
                      >
                        <span class="board-no">
                          {row.number}
                          {b.label !== String(row.number) && <small>{b.label}</small>}
                        </span>
                        <SeatCell seat={left} side="left" team={tag(left)} />
                        <span class="result">
                          {shown ? resultLabel(resultBetween(shown, left.colour === "w")) : "–"}
                          {q && <span class="state">{tr("round.waiting")}</span>}
                          {!q && b.phone?.state === "unconfirmed" && <span class="state phone">{tr("round.phone")}</span>}
                          {!q && b.phone?.state === "confirmed" && <span class="state">{tr("round.checked")}</span>}
                        </span>
                        <SeatCell seat={right} side="right" team={tag(right)} />
                        {props.report(b)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

// Under the team names: the match points once the match is over, what is
// still only on this phone, and a decision the desk took over the whole
// match.
function MatchNotes(props: { match: Match; waiting: number; matchPoints: { a: number | null; b: number | null } | null }) {
  const { match, matchPoints } = props;
  const notes: string[] = [];
  if (matchPoints && matchPoints.a !== null) {
    notes.push(
      matchPoints.b === null
        ? tr("match.mp_bye", { a: points(matchPoints.a) })
        : tr("match.mp", { a: points(matchPoints.a), b: points(matchPoints.b) }),
    );
    if (!match.complete) notes.push(tr("match.provisional_points"));
  }
  if (props.waiting > 0) notes.push(tr(props.waiting === 1 ? "match.waiting_one" : "match.waiting_other", { n: props.waiting }));
  if (match.decision === "forfeit_a" || match.decision === "forfeit_b") {
    notes.push(tr("match.decision.forfeit", { team: teamName(match, match.decision === "forfeit_a" ? "a" : "b") }));
  } else if (match.decision === "double_forfeit") notes.push(tr("match.decision.double_forfeit"));
  else if (match.decision === "match_score") notes.push(tr("match.decision.match_score"));
  if (notes.length === 0) return null;
  return (
    <p class="match-notes" id={`match-notes-${match.id}`}>
      {notes.join(" · ")}
    </p>
  );
}

/**
 * Above the matches, while line-ups wait: how many, and for whoever may,
 * the desk's "Confirm all line-ups for this round" - after asking, because
 * it puts every one of those matches on the results site board by board.
 */
export function LineupsBar(props: { ctx: Ctx; t: Tournament; round: Round; view: MatchView; canConfirm: boolean; onDone: (round: Round, message: string) => void }) {
  const { ctx, t, round } = props;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = unconfirmed(props.view).length;
  if (waiting === 0) return null;

  async function confirmAll() {
    setBusy(true);
    setError(null);
    try {
      const answer = await ctx.api.confirmLineups(t.id, round.number);
      setAsking(false);
      props.onDone(answer, tr("match.confirmed_all_msg", { n: round.number }));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="lineups-bar" id="lineups-bar">
      <span>{tr(waiting === 1 ? "match.lineups_wait_one" : "match.lineups_wait_other", { n: waiting })}</span>
      {props.canConfirm && (
        <button type="button" class="chip" id="confirm-all-lineups" onClick={() => setAsking(true)}>
          {tr("match.confirm_all")}
        </button>
      )}
      {asking && (
        <Sheet title={tr("match.confirm_all_title", { n: round.number })} onClose={() => setAsking(false)}>
          <p>{tr("match.confirm_all_text")}</p>
          {error && <Notice kind="error">{error}</Notice>}
          <div class="sheet-actions">
            <button type="button" class="btn primary block" id="confirm-all-yes" disabled={busy} onClick={confirmAll}>
              {tr("match.confirm_all_yes")}
            </button>
            <button type="button" class="btn block" id="confirm-all-keep" disabled={busy} onClick={() => setAsking(false)}>
              {tr("common.keep")}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/**
 * One team's line-up in one match: who sits on which board with which
 * colour, as the boards stand, and - when it still waits and this account
 * may - the button that confirms it. Open on a confirmed one too: the
 * captain asking "who do you have on three?" deserves an answer.
 */
export function LineupSheet(props: {
  ctx: Ctx;
  t: Tournament;
  round: Round;
  card: MatchCard;
  side: MatchSide;
  canConfirm: boolean;
  onClose: () => void;
  onDone: (round: Round, message: string) => void;
}) {
  const { ctx, t, round, card, side } = props;
  const { match } = card;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const team = teamName(match, side);
  const confirmed = match.lineups[side];
  const seated = lineup(card, side);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const answer = await ctx.api.confirmLineup(t.id, round.number, match.id, side);
      props.onDone(answer, tr("lineup.confirmed_msg", { team, n: match.number ?? "–" }));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={tr("lineup.title", { team })} onClose={props.onClose}>
      <p class="sheet-sub">{tr("lineup.sub", { n: match.number ?? "–", opponent: teamName(match, side === "a" ? "b" : "a") })}</p>
      {seated.length === 0 ? (
        <p class="empty">{tr("lineup.empty")}</p>
      ) : (
        <ul class="list compact" id="lineup-list">
          {seated.map((s) => (
            <li key={s.number} class="row">
              <span class="game-round">{s.number}</span>
              <ColourDot colour={s.colour} />
              <span class="row-main static">
                <span class="row-title">{s.player ? `${s.player.title ? `${s.player.title} ` : ""}${s.player.name}` : tr("lineup.empty_seat")}</span>
                {s.player?.rating ? <span class="row-sub">{s.player.rating}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p class="fine" id="lineup-state">
        {confirmed ? tr("lineup.text_confirmed") : props.canConfirm ? tr("lineup.text_waiting") : tr("lineup.text_desk")}
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      {!confirmed && props.canConfirm && (
        <button type="button" class="btn primary block" id="lineup-confirm" disabled={busy} onClick={confirm}>
          {tr("lineup.confirm")}
        </button>
      )}
    </Sheet>
  );
}
