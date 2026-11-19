// One team match, in full: the teams and the score, the boards, each team's
// line-up with its confirmation and what a plug-in's regulations make of it,
// the line-up editor, and what the desk does to a match as a whole - swap
// the home team, forfeit it, record a double forfeit, give it a score, and
// take any of that back.
//
// The server says what applies now (`can`) and the sheet shows only that;
// an arbiter reads and sees none of the buttons. Every change needs the
// server and says so without a signal. Destructive ones ask first, and what
// the server asks beyond that (a board already sent in a rating report) is
// shown as its own question. A change that enters a result - a forfeit, a
// score - is made with a hold, like every result.

import { useEffect, useRef, useState } from "preact/hooks";
import {
  ApiError,
  needsAcknowledgement,
  type LineupFindings,
  type LineupRosterPlayer,
  type MatchChange,
  type MatchDetail,
  type MatchLineup,
  type MatchSide,
  type Round,
  type Seats,
  type TeamBoardLayout,
  type Tournament,
} from "../api";
import { points, resultBetween, seats as seatsOf, type MatchCard } from "../matches";
import { lineupBody, lineupChanged, otherScore, outFromSeats, scoreChoices, seatsFromOut, sortFindings } from "../teamEvents";
import type { Ctx } from "./App";
import { describeError, Loading, Notice, resultLabel, Sheet, TryAgain } from "./common";
import { HoldButton } from "./HoldButton";
import { ColourDot } from "./Matches";
import { t as tr } from "../i18n";

type Ask = "reset" | "unconfirm_a" | "unconfirm_b" | "swap" | "forfeit_a" | "forfeit_b" | "double" | "withdraw" | "clear_score" | "score";

/** The asks that enter a result: these are confirmed with a hold. */
const ENTERS_RESULT: Ask[] = ["forfeit_a", "forfeit_b", "double", "score"];

interface Question {
  text: string;
  confirm: string[];
  act: (acknowledged: string[]) => Promise<MatchChange>;
  message: string;
}

const teamOf = (d: MatchDetail, side: MatchSide): string => (side === "a" ? d.team_a.name : (d.team_b?.name ?? ""));
const nameOf = (p: LineupRosterPlayer | undefined): string => (p ? `${p.title ? `${p.title} ` : ""}${p.name}` : tr("lineup.empty_seat"));

export function MatchSheet(props: {
  ctx: Ctx;
  t: Tournament;
  round: Round;
  card: MatchCard;
  layout: TeamBoardLayout;
  /** May confirm a line-up (the organiser and editors). */
  canConfirm: boolean;
  onClose: () => void;
  /** The round as the server now has it, to draw behind the sheet. */
  onRound: (round: Round) => void;
}) {
  const { ctx, t, round, card } = props;
  const matchId = card.match.id;
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [scoreA, setScoreA] = useState<number | null>(null);
  const gone = useRef(false);

  async function load() {
    setLoadError(null);
    try {
      const d = await ctx.api.match(t.id, round.number, matchId);
      if (!gone.current) setDetail(d);
    } catch (e) {
      if (!gone.current) setLoadError(describeError(e));
    }
  }

  useEffect(() => {
    gone.current = false;
    void load();
    return () => {
      gone.current = true;
    };
  }, [t.id, round.number, matchId]);

  /** One change: the server's answer is what the sheet and the round behind it now show. */
  async function run(act: (acknowledged: string[]) => Promise<MatchChange>, message: string, acknowledged: string[] = []) {
    setBusy(true);
    setError(null);
    try {
      const answer = await act(acknowledged);
      if (gone.current) return;
      setAsk(null);
      setQuestion(null);
      setEditing(false);
      setInfo(message);
      setDetail(answer.match);
      props.onRound(answer.round);
    } catch (e) {
      if (gone.current) return;
      const asked = needsAcknowledgement(e);
      if (asked && e instanceof ApiError) setQuestion({ text: e.message, confirm: asked.confirm, act, message });
      else setError(describeError(e));
    } finally {
      if (!gone.current) setBusy(false);
    }
  }

  async function confirmSide(side: MatchSide) {
    setBusy(true);
    setError(null);
    try {
      const answer = await ctx.api.confirmLineup(t.id, round.number, matchId, side);
      if (gone.current) return;
      setInfo(tr("lineup.confirmed_msg", { team: detail ? teamOf(detail, side) : "", n: card.match.number ?? "–" }));
      props.onRound(answer);
      await load();
    } catch (e) {
      if (!gone.current) setError(describeError(e));
    } finally {
      if (!gone.current) setBusy(false);
    }
  }

  const title = tr("tm.title", { n: card.match.number ?? "–" });
  if (!detail) {
    return (
      <Sheet title={title} onClose={props.onClose}>
        {loadError ? (
          <>
            <Notice kind="error">{loadError}</Notice>
            <TryAgain id="tm-retry" onClick={() => void load()} />
          </>
        ) : (
          <Loading />
        )}
      </Sheet>
    );
  }

  const d = detail;
  const lineup = d.lineup;
  const can = d.can;
  const anyChange = Object.values(can).some(Boolean);
  const boards = lineup?.boards ?? d.boards.length;
  const rosterOf = (side: MatchSide) => (side === "a" ? lineup?.roster_a : lineup?.roster_b) ?? [];

  // The actions that ask first, with what the question says.
  const asks: Record<Ask, { title: string; text: string; yes: string; run: () => void }> = {
    reset: {
      title: tr("tm.reset_title"),
      text: tr("tm.reset_text"),
      yes: tr("tm.reset_yes"),
      run: () => void run(() => ctx.api.resetLineups(t.id, round.number, matchId), tr("tm.reset_msg")),
    },
    unconfirm_a: {
      title: tr("tm.unconfirm_title", { team: teamOf(d, "a") }),
      text: tr("tm.unconfirm_text"),
      yes: tr("tm.unconfirm_yes"),
      run: () => void run(() => ctx.api.unconfirmLineup(t.id, round.number, matchId, "a"), tr("tm.unconfirm_msg", { team: teamOf(d, "a") })),
    },
    unconfirm_b: {
      title: tr("tm.unconfirm_title", { team: teamOf(d, "b") }),
      text: tr("tm.unconfirm_text"),
      yes: tr("tm.unconfirm_yes"),
      run: () => void run(() => ctx.api.unconfirmLineup(t.id, round.number, matchId, "b"), tr("tm.unconfirm_msg", { team: teamOf(d, "b") })),
    },
    swap: {
      title: tr("tm.swap_title"),
      text: tr("tm.swap_text", { home: teamOf(d, "b"), away: teamOf(d, "a") }),
      yes: tr("tm.swap_yes"),
      run: () => void run(() => ctx.api.swapHome(t.id, round.number, matchId), tr("tm.swap_msg")),
    },
    forfeit_a: {
      title: tr("tm.forfeit_title", { team: teamOf(d, "a") }),
      text: tr("tm.forfeit_text"),
      yes: tr("tm.forfeit_yes", { team: teamOf(d, "a") }),
      run: () => void run((ack) => ctx.api.decideMatch(t.id, round.number, matchId, "forfeit_a", ack), tr("tm.forfeit_msg", { team: teamOf(d, "a") })),
    },
    forfeit_b: {
      title: tr("tm.forfeit_title", { team: teamOf(d, "b") }),
      text: tr("tm.forfeit_text"),
      yes: tr("tm.forfeit_yes", { team: teamOf(d, "b") }),
      run: () => void run((ack) => ctx.api.decideMatch(t.id, round.number, matchId, "forfeit_b", ack), tr("tm.forfeit_msg", { team: teamOf(d, "b") })),
    },
    double: {
      title: tr("tm.double_title"),
      text: tr("tm.double_text"),
      yes: tr("tm.double_yes"),
      run: () => void run((ack) => ctx.api.decideMatch(t.id, round.number, matchId, "double_forfeit", ack), tr("tm.double_msg")),
    },
    withdraw: {
      title: tr("tm.withdraw_title"),
      text: tr("tm.withdraw_text"),
      yes: tr("tm.withdraw_yes"),
      run: () => void run(() => ctx.api.withdrawDecision(t.id, round.number, matchId), tr("tm.withdraw_msg")),
    },
    clear_score: {
      title: tr("tm.clear_score_title"),
      text: tr("tm.clear_score_text"),
      yes: tr("tm.clear_score_yes"),
      run: () => void run(() => ctx.api.clearMatchScore(t.id, round.number, matchId), tr("tm.clear_score_msg")),
    },
    score: {
      title: tr("tm.score_title"),
      text: tr("tm.score_text", { boards }),
      yes: tr("tm.score_yes"),
      run: () => {
        const a = scoreA ?? boards / 2;
        void run(() => ctx.api.setMatchScore(t.id, round.number, matchId, { a, b: otherScore(boards, a) }), tr("tm.score_msg", { a: points(a), b: points(otherScore(boards, a)) }));
      },
    },
  };

  // The server's question, after the first yes: the same change again with its answer.
  if (question) {
    return (
      <Sheet title={title} onClose={props.onClose}>
        <div class="ask" id="tm-question">
          <p class="ask-summary">{tr("tm.question_title")}</p>
          <p>{question.text}</p>
          {error && <Notice kind="error">{error}</Notice>}
          <div class="sheet-actions">
            <HoldButton
              id="tm-question-yes"
              class="danger block"
              disabled={busy}
              onLock={() => void run(question.act, question.message, question.confirm)}
            >
              {tr("tm.question_yes")}
            </HoldButton>
            <button type="button" class="btn block" id="tm-question-keep" disabled={busy} onClick={() => setQuestion(null)}>
              {tr("common.keep")}
            </button>
          </div>
        </div>
      </Sheet>
    );
  }

  if (ask) {
    const a = asks[ask];
    const holds = ENTERS_RESULT.includes(ask);
    return (
      <Sheet title={title} onClose={() => setAsk(null)}>
        <div class="ask" id="tm-ask">
          <p class="ask-summary">{a.title}</p>
          <p>{a.text}</p>
          {ask === "score" && (
            <ScoreField teamA={teamOf(d, "a")} teamB={teamOf(d, "b")} boards={boards} value={scoreA ?? boards / 2} onChange={setScoreA} />
          )}
          {error && <Notice kind="error">{error}</Notice>}
          <div class="sheet-actions">
            {holds ? (
              <HoldButton id="tm-ask-yes" class="danger block" disabled={busy} onLock={a.run}>
                {a.yes}
              </HoldButton>
            ) : (
              <button type="button" class="btn danger block" id="tm-ask-yes" disabled={busy} onClick={a.run}>
                {a.yes}
              </button>
            )}
            <button type="button" class="btn block" id="tm-ask-keep" disabled={busy} onClick={() => setAsk(null)}>
              {tr("common.keep")}
            </button>
          </div>
        </div>
      </Sheet>
    );
  }

  if (editing && lineup) {
    return (
      <Sheet title={tr("tm.edit_title", { n: card.match.number ?? "–" })} onClose={() => setEditing(false)} dirty={false}>
        <LineupEditor
          detail={d}
          lineup={lineup}
          busy={busy}
          error={error}
          onCheck={(body) => ctx.api.checkLineups(t.id, round.number, matchId, body)}
          onSave={(body) => void run(() => ctx.api.setLineups(t.id, round.number, matchId, body), tr("tm.edit_msg"))}
          onCancel={() => {
            setError(null);
            setEditing(false);
          }}
        />
      </Sheet>
    );
  }

  const decision = d.decision;
  const notes: string[] = [];
  if (d.match_points && d.match_points.a !== null)
    notes.push(
      d.match_points.b === null
        ? tr("match.mp_bye", { a: points(d.match_points.a) })
        : tr("match.mp", { a: points(d.match_points.a), b: points(d.match_points.b) }),
    );
  if (d.match_points && !d.complete) notes.push(tr("match.provisional_points"));
  if (decision === "forfeit_a" || decision === "forfeit_b") notes.push(tr("match.decision.forfeit", { team: teamOf(d, decision === "forfeit_a" ? "a" : "b") }));
  else if (decision === "double_forfeit") notes.push(tr("match.decision.double_forfeit"));
  else if (decision === "match_score" && d.match_score)
    notes.push(tr("tm.decided_by_score", { a: points(d.match_score.a), b: points(d.match_score.b) }));
  if (d.home === "a") notes.push(tr("tm.home", { team: teamOf(d, "a") }));

  return (
    <Sheet title={title} onClose={props.onClose}>
      <p class="sheet-sub">{tr("tm.sub", { round: round.number })}</p>
      <div class="match-teams tm-teams">
        <span class="match-team a">{d.team_a.name}</span>
        <span class="match-score" id="tm-score">
          {d.bye ? tr("match.bye") : `${points(d.game_points.a)} – ${points(d.game_points.b)}`}
        </span>
        <span class="match-team b">{d.team_b?.name}</span>
      </div>
      {notes.length > 0 && (
        <p class="match-notes" id="tm-notes">
          {notes.join(" · ")}
        </p>
      )}
      {info && <Notice kind="ok" onClose={() => setInfo(null)}>{info}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}

      {!d.bye && card.rows.length > 0 && (
        <>
          <h3>{tr("tm.boards")}</h3>
          <ul class="list compact tm-boards" id="tm-boards">
            {card.rows.map((row) => {
              const { left, right } = seatsOf(row, props.layout);
              const shown = row.board.result;
              return (
                <li class="row" key={row.board.id}>
                  <span class="game-round">{row.number}</span>
                  <span class="row-main static">
                    <span class="row-title">
                      <ColourDot colour={left.colour} /> {left.player?.name ?? "–"}
                    </span>
                    <span class="row-sub">
                      <ColourDot colour={right.colour} /> {right.player?.name ?? "–"}
                    </span>
                  </span>
                  <span class="game-result">{shown ? resultLabel(resultBetween(shown, left.colour === "w")) : "–"}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {lineup && !d.bye && (
        <>
          <h3>{tr("tm.lineups")}</h3>
          {(["a", "b"] as const).map((side) => (
            <LineupBlock
              key={side}
              side={side}
              detail={d}
              lineup={lineup}
              roster={rosterOf(side)}
              canConfirm={props.canConfirm}
              canUnconfirm={side === "a" ? can.unconfirm_a : can.unconfirm_b}
              busy={busy}
              onConfirm={() => void confirmSide(side)}
              onUnconfirm={() => setAsk(side === "a" ? "unconfirm_a" : "unconfirm_b")}
            />
          ))}
          <Findings findings={lineup.findings} teams={{ a: d.team_a.name, b: d.team_b?.name ?? "" }} />
        </>
      )}

      {!d.bye && !anyChange && (
        <p class="fine" id="tm-readonly">
          {tr("tm.read_only")}
        </p>
      )}

      {anyChange && (
        <div class="sheet-actions" id="tm-actions">
          {can.lineups && lineup && (
            <button type="button" class="btn primary block" id="tm-edit" onClick={() => setEditing(true)}>
              {tr("tm.edit")}
            </button>
          )}
          {can.lineups && lineup && (
            <button type="button" class="btn block" id="tm-reset" onClick={() => setAsk("reset")}>
              {tr("tm.reset")}
            </button>
          )}
          {can.swap_home && (
            <button type="button" class="btn block" id="tm-swap" onClick={() => setAsk("swap")}>
              {tr("tm.swap")}
            </button>
          )}
          {can.decide && (
            <>
              <button type="button" class="btn danger block" id="tm-forfeit-a" onClick={() => setAsk("forfeit_a")}>
                {tr("tm.forfeit_button", { team: teamOf(d, "a") })}
              </button>
              <button type="button" class="btn danger block" id="tm-forfeit-b" onClick={() => setAsk("forfeit_b")}>
                {tr("tm.forfeit_button", { team: teamOf(d, "b") })}
              </button>
            </>
          )}
          {can.double_forfeit && (
            <button type="button" class="btn danger block" id="tm-double" onClick={() => setAsk("double")}>
              {tr("tm.double")}
            </button>
          )}
          {can.score && (
            <button type="button" class="btn block" id="tm-score-set" onClick={() => setAsk("score")}>
              {tr("tm.score")}
            </button>
          )}
          {can.clear_score && (
            <button type="button" class="btn danger block" id="tm-score-clear" onClick={() => setAsk("clear_score")}>
              {tr("tm.clear_score")}
            </button>
          )}
          {can.withdraw_decision && (
            <button type="button" class="btn danger block" id="tm-withdraw" onClick={() => setAsk("withdraw")}>
              {tr("tm.withdraw")}
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}

// One team's line-up as saved: board, colour, player; its confirmation, and
// the buttons for it.
function LineupBlock(props: {
  side: MatchSide;
  detail: MatchDetail;
  lineup: MatchLineup;
  roster: LineupRosterPlayer[];
  canConfirm: boolean;
  canUnconfirm: boolean;
  busy: boolean;
  onConfirm: () => void;
  onUnconfirm: () => void;
}) {
  const { side, detail, lineup } = props;
  const seated = side === "a" ? lineup.a : lineup.b;
  const confirmed = detail.lineups[side];
  return (
    <section class="tm-lineup" id={`tm-lineup-${side}`}>
      <div class="tm-lineup-head">
        <strong>{teamOf(detail, side)}</strong>
        <span class={`tag ${confirmed ? "" : "warn"}`} id={`tm-state-${side}`}>
          {confirmed ? tr("tm.confirmed") : tr("tm.provisional")}
        </span>
      </div>
      <ul class="list compact">
        {seated.map((id, i) => {
          const player = props.roster.find((p) => p.id === id);
          const aWhite = detail.boards[i]?.a_white ?? i % 2 === 0;
          return (
            <li class="row" key={i}>
              <span class="game-round">{i + 1}</span>
              <ColourDot colour={(side === "a") === aWhite ? "w" : "b"} />
              <span class="row-main static">
                <span class="row-title">{nameOf(player)}</span>
                {player?.rating ? <span class="row-sub">{player.rating}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      <div class="two-btn">
        {!confirmed && props.canConfirm && (
          <button type="button" class="btn" id={`tm-confirm-${side}`} disabled={props.busy} onClick={props.onConfirm}>
            {tr("tm.confirm_side")}
          </button>
        )}
        {confirmed && props.canUnconfirm && (
          <button type="button" class="btn" id={`tm-unconfirm-${side}`} disabled={props.busy} onClick={props.onUnconfirm}>
            {tr("tm.unconfirm")}
          </button>
        )}
      </div>
    </section>
  );
}

/** What a plug-in's regulations make of the line-ups: nothing is shown when nobody checks. */
function Findings(props: { findings: LineupFindings | undefined; teams: { a: string; b: string } }) {
  const { findings } = props;
  if (findings === null || findings === undefined) return null;
  if (findings.length === 0)
    return (
      <p class="fine" id="tm-findings-none">
        {tr("tm.findings_none")}
      </p>
    );
  return (
    <div class="tm-findings" id="tm-findings">
      <h3>{tr("tm.findings")}</h3>
      <ul class="list compact">
        {sortFindings(findings).map((f, i) => (
          <li class="row finding" key={i}>
            <span class={`tag ${f.severity === "violation" ? "danger" : "warn"}`}>{f.severity === "violation" ? tr("tm.violation") : tr("tm.warning")}</span>
            <span class="row-main static">
              <span class="row-title">{f.message}</span>
              <span class="row-sub">
                {[f.team ? props.teams[f.team] : null, f.board ? tr("tm.finding_board", { n: f.board }) : null, f.penalty].filter(Boolean).join(" · ")}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScoreField(props: { teamA: string; teamB: string; boards: number; value: number; onChange: (v: number) => void }) {
  return (
    <div class="tm-score-field">
      <label class="field">
        <span>{tr("tm.score_for", { team: props.teamA })}</span>
        <select id="tm-score-a" value={String(props.value)} onChange={(e) => props.onChange(Number((e.target as HTMLSelectElement).value))}>
          {scoreChoices(props.boards).map((n) => (
            <option key={n} value={String(n)}>
              {points(n)}
            </option>
          ))}
        </select>
      </label>
      <p class="fine" id="tm-score-b">
        {tr("tm.score_other", { team: props.teamB, n: points(otherScore(props.boards, props.value)) })}
      </p>
    </div>
  );
}

// The line-up editor, in the desk's two modes. `ticks`: tick who sits out and
// the rest play in roster order. `selects`: a player for every board. What
// the ticks come to is previewed; the server's answer replaces it.
function LineupEditor(props: {
  detail: MatchDetail;
  lineup: MatchLineup;
  busy: boolean;
  error: string | null;
  onCheck: (body: ReturnType<typeof lineupBody>) => Promise<LineupFindings>;
  onSave: (body: ReturnType<typeof lineupBody>) => void;
  onCancel: () => void;
}) {
  const { detail, lineup } = props;
  const [a, setA] = useState<Seats>(lineup.a);
  const [b, setB] = useState<Seats>(lineup.b);
  const [outA, setOutA] = useState<Set<number>>(() => outFromSeats(lineup.roster_a, lineup.a));
  const [outB, setOutB] = useState<Set<number>>(() => outFromSeats(lineup.roster_b, lineup.b));
  const [checked, setChecked] = useState<LineupFindings | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const draft = { a, b, outA, outB };
  const body = lineupBody(lineup.mode, draft);
  const changed = lineupChanged(lineup, draft);

  async function check() {
    setChecking(true);
    setCheckError(null);
    try {
      setChecked(await props.onCheck(body));
    } catch (e) {
      setCheckError(describeError(e));
    } finally {
      setChecking(false);
    }
  }

  // Anything edited makes an earlier check stale.
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    setChecked(undefined);
    set(v);
  };

  return (
    <div class="tm-editor" id="tm-editor">
      <p class="sheet-sub">{lineup.mode === "ticks" ? tr("tm.edit_ticks_help") : tr("tm.edit_selects_help")}</p>
      {(["a", "b"] as const).map((side) => (
        <section class="tm-lineup" key={side} id={`tm-edit-${side}`}>
          <div class="tm-lineup-head">
            <strong>{teamOf(detail, side)}</strong>
          </div>
          {lineup.mode === "ticks" ? (
            <TickList
              side={side}
              roster={side === "a" ? lineup.roster_a : lineup.roster_b}
              out={side === "a" ? outA : outB}
              boards={lineup.boards}
              onChange={edit(side === "a" ? setOutA : setOutB)}
            />
          ) : (
            <SeatSelects
              side={side}
              roster={side === "a" ? lineup.roster_a : lineup.roster_b}
              seats={side === "a" ? a : b}
              onChange={edit(side === "a" ? setA : setB)}
            />
          )}
        </section>
      ))}
      {checkError && <Notice kind="error">{checkError}</Notice>}
      {props.error && <Notice kind="error">{props.error}</Notice>}
      {checked === null && (
        <p class="fine" id="tm-check-none">
          {tr("tm.check_none")}
        </p>
      )}
      <Findings findings={checked} teams={{ a: teamOf(detail, "a"), b: teamOf(detail, "b") }} />
      <div class="sheet-actions">
        <button type="button" class="btn block" id="tm-check" disabled={checking || props.busy} onClick={() => void check()}>
          {tr("tm.check")}
        </button>
        <button type="button" class="btn primary block" id="tm-save" disabled={!changed || props.busy} onClick={() => props.onSave(body)}>
          {tr("tm.save")}
        </button>
        <button type="button" class="btn ghost block" id="tm-edit-cancel" disabled={props.busy} onClick={props.onCancel}>
          {tr("common.cancel")}
        </button>
      </div>
    </div>
  );
}

function TickList(props: {
  side: MatchSide;
  roster: LineupRosterPlayer[];
  out: Set<number>;
  boards: number;
  onChange: (out: Set<number>) => void;
}) {
  const seated = seatsFromOut(props.roster, props.out, props.boards);
  return (
    <ul class="list compact">
      {props.roster.map((p) => {
        const board = seated.indexOf(p.id) + 1;
        const status = !p.available ? tr("tm.not_available") : board > 0 ? tr("tm.on_board", { n: board }) : props.out.has(p.id) ? tr("tm.sits_out") : tr("tm.reserve");
        return (
          <li class="row" key={p.id}>
            <label class="row-main pick">
              <input
                type="checkbox"
                id={`out-${props.side}-${p.id}`}
                checked={props.out.has(p.id)}
                disabled={!p.available}
                onChange={(e) => {
                  const next = new Set(props.out);
                  if ((e.target as HTMLInputElement).checked) next.add(p.id);
                  else next.delete(p.id);
                  props.onChange(next);
                }}
              />
              <span>
                <span class="row-title">{nameOf(p)}</span>
                <span class="row-sub">{[p.rating, status].filter(Boolean).join(" · ")}</span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function SeatSelects(props: { side: MatchSide; roster: LineupRosterPlayer[]; seats: Seats; onChange: (seats: Seats) => void }) {
  return (
    <div class="tm-selects">
      {props.seats.map((current, i) => (
        <label class="field" key={i}>
          <span>{tr("tm.board_n", { n: i + 1 })}</span>
          <select
            id={`seat-${props.side}-${i + 1}`}
            value={current === null ? "" : String(current)}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              const next = [...props.seats];
              next[i] = v === "" ? null : Number(v);
              props.onChange(next);
            }}
          >
            <option value="">{tr("lineup.empty_seat")}</option>
            {props.roster.map((p) => (
              <option key={p.id} value={String(p.id)} disabled={!p.available || (props.seats.includes(p.id) && current !== p.id)}>
                {nameOf(p)}
                {p.rating ? ` (${p.rating})` : ""}
                {p.available ? "" : ` – ${tr("tm.not_available")}`}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
