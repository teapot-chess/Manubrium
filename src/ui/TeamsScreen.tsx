// The teams of a team event: who they are, who plays for them in board order,
// who the captain is, which have left - and, for the organiser and editors,
// what the Teams page does in the middle of an event: a team withdraws or
// comes back, sits a round out or takes a half-point bye, and a reserve who
// turned up goes on the roster (or a player comes off it). Setting the teams
// up - names, seeding, the board order, imports - stays at the desk.
//
// Arbiters read: who plays for whom is what the hall asks first.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  ApiError,
  refOf,
  sameRow,
  needsAcknowledgement,
  type EventTeam,
  type Player,
  type Ref,
  type RosterPlayer,
  type TeamDetail,
  type TeamRoundStatus,
  type Tournament,
} from "../api";
import { points } from "../matches";
import { futureRounds, roundStatus, withdrawRounds } from "../teamEvents";
import type { Ctx } from "./App";
import { describeError, Empty, Loading, Notice, Sheet, TryAgain } from "./common";
import { HoldButton } from "./HoldButton";
import { t as tr } from "../i18n";

const person = (p: { name: string; title: string | null }) => (p.title ? `${p.title} ${p.name}` : p.name);

export function TeamsScreen(props: { ctx: Ctx; t: Tournament }) {
  const { ctx, t } = props;
  const [teams, setTeams] = useState<EventTeam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // By uid where there is one: on a relayed tournament the list may be read
  // from the laptop one time and from the cloud the next, and their ids differ.
  const [open, setOpen] = useState<Ref | null>(null);
  const [filter, setFilter] = useState("");

  async function load() {
    setError(null);
    try {
      setTeams(await ctx.api.teams(t.id));
    } catch (e) {
      setError(describeError(e));
    }
  }

  useEffect(() => {
    void load();
  }, [t.id, t.paired_rounds]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (teams ?? []).filter((x) => !q || [x.name, x.short_name, x.club, x.captain].some((v) => v?.toLowerCase().includes(q)));
  }, [teams, filter]);
  const openTeam = open === null ? null : (teams?.find((x) => sameRow(open, x)) ?? null);

  return (
    <div class="teams" id="teams">
      {error && <Notice kind="error">{error}</Notice>}
      {error && !teams && <TryAgain id="teams-retry" onClick={() => void load()} />}
      {!teams && !error && <Loading />}
      {teams && teams.length === 0 && <Empty>{tr("teams.none")}</Empty>}
      {teams && teams.length > 8 && (
        <input
          type="search"
          id="teams-filter"
          placeholder={tr("teams.filter")}
          aria-label={tr("teams.filter")}
          value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
        />
      )}
      {shown.map((team) => (
        <TeamCard key={team.id} team={team} onOpen={() => setOpen(refOf(team))} />
      ))}
      {teams && teams.length > 0 && (
        <button type="button" class="btn ghost block" onClick={() => void load()}>
          {tr("tournaments.refresh")}
        </button>
      )}
      {openTeam && (
        <TeamSheet
          ctx={ctx}
          t={t}
          team={openTeam}
          onClose={() => setOpen(null)}
          onChanged={(changed) => {
            // The open team changed: by the ref it was opened with, not by an id
            // that may be the other copy's.
            setTeams((list) => list?.map((x) => (sameRow(open, x) ? changed : x)) ?? list);
            setOpen(refOf(changed));
          }}
        />
      )}
    </div>
  );
}

function TeamCard(props: { team: EventTeam; onOpen: () => void }) {
  const { team } = props;
  const out = team.withdrawn_from_round !== null;
  return (
    <section class={`team-card ${out ? "withdrawn" : ""}`} id={`team-${team.id}`}>
      <button type="button" class="team-card-head" id={`team-open-${team.id}`} onClick={props.onOpen}>
        <span class="game-round">{team.number ?? "–"}</span>
        <span class="row-main static">
          <span class="row-title">{team.name}</span>
          <span class="row-sub">
            {[team.series, team.club, team.captain ? tr("teams.captain", { name: team.captain }) : null, team.rating ? tr("teams.rating", { n: team.rating }) : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        {out && (
          <span class="tag warn" id={`team-out-${team.id}`}>
            {tr("teams.withdrawn_from", { n: team.withdrawn_from_round ?? 0 })}
          </span>
        )}
        <svg viewBox="0 0 24 24" aria-hidden="true" class="chevron">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <ol class="roster" aria-label={tr("teams.roster")}>
        {team.roster.map((p) => (
          <li key={p.id} class={p.status === "active" ? "" : "gone"}>
            <span class="game-round">{p.order}</span>
            <span class="roster-name">{person(p)}</span>
            <span class="roster-meta">{[p.rating, p.status === "active" ? null : tr(`teams.status.${p.status}` as "teams.status.withdrawn")].filter(Boolean).join(" · ")}</span>
          </li>
        ))}
      </ol>
      {team.rounds.length > 0 && (
        <p class="fine team-rounds" id={`team-rounds-${team.id}`}>
          {team.rounds.map((r) => tr(r.status === "absent" ? "teams.round_absent" : "teams.round_half_bye", { n: r.round })).join(" · ")}
        </p>
      )}
    </section>
  );
}

type Ask = { kind: "withdraw" } | { kind: "reinstate" } | { kind: "remove"; player: RosterPlayer };

function TeamSheet(props: {
  ctx: Ctx;
  t: Tournament;
  team: EventTeam;
  onClose: () => void;
  onChanged: (team: EventTeam) => void;
}) {
  const { ctx, t } = props;
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [question, setQuestion] = useState<{ text: string; confirm: string[] } | null>(null);
  const [from, setFrom] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const gone = useRef(false);
  const desk = t.can.includes("pair") && !t.read_only;

  async function load() {
    setLoadError(null);
    try {
      const d = await ctx.api.teamDetail(t.id, refOf(props.team));
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
  }, [t.id, props.team.id]);

  /** One change to the team; the server's answer is what is shown from then on. */
  async function run(act: () => Promise<TeamDetail>, message: string) {
    setBusy(true);
    setError(null);
    try {
      const answer = await act();
      if (gone.current) return;
      setDetail(answer);
      setAsk(null);
      setQuestion(null);
      setAdding(false);
      setInfo(message);
      props.onChanged(answer.team);
    } catch (e) {
      if (gone.current) return;
      const asked = needsAcknowledgement(e);
      if (asked && e instanceof ApiError) setQuestion({ text: e.message, confirm: asked.confirm });
      else setError(describeError(e));
    } finally {
      if (!gone.current) setBusy(false);
    }
  }

  const title = props.team.name;
  if (!detail) {
    return (
      <Sheet title={title} onClose={props.onClose}>
        {loadError ? (
          <>
            <Notice kind="error">{loadError}</Notice>
            <TryAgain id="team-retry" onClick={() => void load()} />
          </>
        ) : (
          <Loading />
        )}
      </Sheet>
    );
  }

  const team = detail.team;
  const withdrawn = team.withdrawn_from_round !== null;
  const rounds = withdrawRounds(t);
  const fromRound = from ?? rounds[rounds.length - 1] ?? 1;

  if (ask?.kind === "withdraw") {
    const send = (ack: string[]) => void run(() => ctx.api.withdrawTeam(t.id, refOf(team), fromRound, ack), tr("teams.withdraw_msg", { team: team.name, n: fromRound }));
    return (
      <Sheet
        title={title}
        onClose={() => {
          setAsk(null);
          setQuestion(null);
          setError(null);
        }}
      >
        <div class="ask" id="team-ask">
          <p class="ask-summary">{tr("teams.withdraw_title", { team: team.name })}</p>
          {question ? (
            <>
              <p id="team-question">{question.text}</p>
              {error && <Notice kind="error">{error}</Notice>}
              <HoldButton id="team-question-yes" class="danger block" disabled={busy} onLock={() => send(question.confirm)}>
                {tr("tm.question_yes")}
              </HoldButton>
            </>
          ) : (
            <>
              <p>{tr("teams.withdraw_text")}</p>
              <label class="field">
                <span>{tr("teams.withdraw_from")}</span>
                <select id="team-withdraw-round" value={String(fromRound)} onChange={(e) => setFrom(Number((e.target as HTMLSelectElement).value))}>
                  {rounds.map((n) => (
                    <option key={n} value={String(n)}>
                      {tr("teams.round_n", { n })}
                    </option>
                  ))}
                </select>
              </label>
              {error && <Notice kind="error">{error}</Notice>}
              <HoldButton id="team-withdraw-yes" class="danger block" disabled={busy} onLock={() => send([])}>
                {tr("teams.withdraw_yes", { team: team.name })}
              </HoldButton>
            </>
          )}
          <button
            type="button"
            class="btn block"
            id="team-ask-keep"
            disabled={busy}
            onClick={() => {
              setAsk(null);
              setQuestion(null);
              setError(null);
            }}
          >
            {tr("common.keep")}
          </button>
        </div>
      </Sheet>
    );
  }

  if (ask) {
    const removing = ask.kind === "remove";
    return (
      <Sheet title={title} onClose={() => setAsk(null)}>
        <div class="ask" id="team-ask">
          <p class="ask-summary">{removing ? tr("teams.remove_title", { name: ask.player.name }) : tr("teams.reinstate_title", { team: team.name })}</p>
          <p>{removing ? tr("teams.remove_text") : tr("teams.reinstate_text")}</p>
          {error && <Notice kind="error">{error}</Notice>}
          <button
            type="button"
            class="btn primary block"
            id="team-ask-yes"
            disabled={busy}
            onClick={() =>
              removing
                ? void run(() => ctx.api.removeTeamPlayer(t.id, refOf(team), refOf(ask.player)), tr("teams.remove_msg", { name: ask.player.name }))
                : void run(() => ctx.api.reinstateTeam(t.id, refOf(team)), tr("teams.reinstate_msg", { team: team.name }))
            }
          >
            {removing ? tr("teams.remove_yes") : tr("teams.reinstate_yes")}
          </button>
          <button type="button" class="btn block" id="team-ask-keep" disabled={busy} onClick={() => setAsk(null)}>
            {tr("common.keep")}
          </button>
        </div>
      </Sheet>
    );
  }

  if (adding) {
    return (
      <Sheet title={tr("teams.add_title", { team: team.name })} onClose={() => setAdding(false)}>
        <ReservePicker
          ctx={ctx}
          t={t}
          team={team}
          busy={busy}
          error={error}
          onPick={(p) => void run(() => ctx.api.addTeamPlayer(t.id, refOf(team), refOf(p)), tr("teams.add_msg", { name: p.name, team: team.name }))}
          onCancel={() => setAdding(false)}
        />
      </Sheet>
    );
  }

  const future = futureRounds(t).slice(0, 15);
  const swiss = t.pairing_system === "swiss";
  return (
    <Sheet title={title} onClose={props.onClose}>
      <p class="sheet-sub" id="team-facts">
        {[
          team.series,
          team.club,
          team.captain ? tr("teams.captain", { name: team.captain }) : null,
          team.captain_contact,
          team.rating ? tr("teams.rating", { n: team.rating }) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {withdrawn && (
        <Notice kind="info">
          {tr("teams.withdrawn_from", { n: team.withdrawn_from_round ?? 0 })}
        </Notice>
      )}
      {info && <Notice kind="ok" onClose={() => setInfo(null)}>{info}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}

      <h3>{tr("teams.matches")}</h3>
      {detail.matches.length === 0 ? (
        <p class="empty" id="team-no-matches">
          {tr("teams.no_matches")}
        </p>
      ) : (
        <ul class="list compact" id="team-matches">
          {detail.matches.map((m) => (
            <li class="row" key={m.match_id}>
              <span class="game-round">{m.round}</span>
              <span class="row-main static">
                <span class="row-title">{m.bye ? tr("match.bye") : (m.opponent?.name ?? "–")}</span>
                <span class="row-sub">
                  {m.bye
                    ? tr("teams.bye_points", { n: points(m.game_points) })
                    : tr("teams.game_points", { a: points(m.game_points), b: points(m.opponent_game_points ?? 0) })}
                  {m.complete ? "" : ` · ${tr("teams.in_play")}`}
                </span>
              </span>
              <span class="game-result">{m.match_points === null ? "–" : tr("teams.mp_short", { n: points(m.match_points) })}</span>
            </li>
          ))}
        </ul>
      )}

      <h3>{tr("teams.roster")}</h3>
      <ul class="list compact" id="team-roster">
        {team.roster.map((p) => (
          <li class="row" key={p.id}>
            <span class="game-round">{p.order}</span>
            <span class="row-main static">
              <span class="row-title">{person(p)}</span>
              <span class="row-sub">
                {[p.rating, p.federation, p.status === "active" ? null : tr(`teams.status.${p.status}` as "teams.status.withdrawn")].filter(Boolean).join(" · ")}
              </span>
            </span>
            {desk && (
              <button type="button" class="chip danger" id={`team-remove-${p.id}`} onClick={() => setAsk({ kind: "remove", player: p })}>
                {tr("teams.remove")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {desk && t.can.includes("players") && (
        <button type="button" class="btn block" id="team-add" onClick={() => setAdding(true)}>
          {tr("teams.add")}
        </button>
      )}

      {desk && !withdrawn && future.length > 0 && (
        <>
          <h3>{tr("teams.rounds")}</h3>
          <p class="fine">{tr("teams.rounds_help")}</p>
          <ul class="list compact" id="team-rounds">
            {future.map((n) => {
              const status = roundStatus(team, n);
              const options: TeamRoundStatus[] = swiss ? ["plays", "absent", "half_bye"] : ["plays", "absent"];
              return (
                <li class="row round-status" key={n}>
                  <span class="row-main static">
                    <span class="row-title">{tr("teams.round_n", { n })}</span>
                  </span>
                  <span class="segmented tight" role="group" aria-label={tr("teams.round_n", { n })}>
                    {options.map((o) => (
                      <button
                        type="button"
                        key={o}
                        id={`team-round-${n}-${o}`}
                        class={status === o ? "active" : ""}
                        aria-pressed={status === o}
                        disabled={busy}
                        onClick={() => status !== o && void run(() => ctx.api.setTeamRound(t.id, refOf(team), n, o), tr("teams.round_msg", { team: team.name, n }))}
                      >
                        {tr(`teams.round.${o}` as "teams.round.plays")}
                      </button>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {desk && (
        <div class="sheet-actions">
          {withdrawn ? (
            <button type="button" class="btn block" id="team-reinstate" onClick={() => setAsk({ kind: "reinstate" })}>
              {tr("teams.reinstate")}
            </button>
          ) : (
            <button type="button" class="btn danger block" id="team-withdraw" onClick={() => setAsk({ kind: "withdraw" })}>
              {tr("teams.withdraw")}
            </button>
          )}
        </div>
      )}
      {!desk && (
        <p class="fine" id="team-read-only">
          {tr("teams.read_only")}
        </p>
      )}
    </Sheet>
  );
}

// A reserve who turned up: any player of the tournament not on this team,
// found by name. A player on another team moves, which the line says.
function ReservePicker(props: {
  ctx: Ctx;
  t: Tournament;
  team: EventTeam;
  busy: boolean;
  error: string | null;
  onPick: (p: Player) => void;
  onCancel: () => void;
}) {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  async function load() {
    setError(null);
    try {
      setPlayers(await props.ctx.api.players(props.t.id));
    } catch (e) {
      setError(describeError(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  // By uid where there is one: the roster and the player list may come from different copies of a relayed tournament.
  const onTeam = (p: Player) => props.team.roster.some((r) => sameRow(refOf(p), r));
  const query = q.trim().toLowerCase();
  const matches = (players ?? []).filter((p) => !onTeam(p) && p.status === "active" && (!query || p.name.toLowerCase().includes(query))).slice(0, 25);

  return (
    <div id="team-reserve">
      <p class="sheet-sub">{tr("teams.add_help")}</p>
      <input
        type="search"
        id="team-reserve-search"
        placeholder={tr("teams.add_search")}
        aria-label={tr("teams.add_search")}
        value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
      />
      {error && <Notice kind="error">{error}</Notice>}
      {props.error && <Notice kind="error">{props.error}</Notice>}
      {error && <TryAgain id="team-reserve-retry" onClick={() => void load()} />}
      {!players && !error && <Loading />}
      {players && matches.length === 0 && <Empty>{tr("teams.add_none")}</Empty>}
      <ul class="list compact" id="team-reserve-list">
        {matches.map((p) => (
          <li class="row" key={p.id}>
            <button type="button" class="row-main" id={`team-reserve-${p.id}`} disabled={props.busy} onClick={() => props.onPick(p)}>
              <span class="row-title">{person(p)}</span>
              <span class="row-sub">{[p.rating, p.club].filter(Boolean).join(" · ")}</span>
            </button>
            <span class="add-plus" aria-hidden="true">
              +
            </span>
          </li>
        ))}
      </ul>
      <button type="button" class="btn ghost block" id="team-reserve-cancel" onClick={props.onCancel}>
        {tr("common.cancel")}
      </button>
    </div>
  );
}
