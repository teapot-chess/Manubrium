// Home: the round. Tap a board, tap a result. Results queue (they work
// without a signal); clearing, pairing and publishing are online only.

import { useCallback, useEffect, useState } from "preact/hooks";
import { ApiError, OfflineError, type Board, type Round, type Tournament } from "../api";
import { onResume } from "../platform";
import type { Ctx } from "./App";
import { describeError, Empty, Loading, Notice, resultLabel, Sheet } from "./common";

const MAIN_RESULTS = ["1-0", "1/2-1/2", "0-1"];
const PUBLISH = ["Not public", "Pairings", "Pairings and results", "Results and standings"];
const INCIDENT_KINDS: [string, string][] = [
  ["illegal_move", "Illegal move"],
  ["clock", "Clock"],
  ["device", "Phone or device"],
  ["complaint", "Complaint"],
  ["time_added", "Time added"],
  ["game_rewound", "Game rewound"],
  ["arbiter_call", "Arbiter call"],
  ["other", "Something else"],
];

export function RoundScreen(props: { ctx: Ctx; t: Tournament; reloadTournament: () => Promise<void> }) {
  const { ctx, t } = props;
  const latest = t.paired_rounds;
  const [number, setNumber] = useState(latest);
  const [round, setRound] = useState<Round | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [desk, setDesk] = useState(false);

  const base = ctx.server.base;

  const load = useCallback(async () => {
    if (number < 1) return;
    try {
      setRound(await ctx.api.round(t.id, number));
      setOffline(false);
      setError(null);
    } catch (e) {
      if (e instanceof OfflineError) setOffline(true);
      else setError(describeError(e));
    }
  }, [ctx.api, t.id, number]);

  const flush = useCallback(async () => {
    const outcome = await ctx.outbox.flush(base, t.id, (entries) => ctx.api.sync(t.id, entries)).catch((e) => {
      setError(describeError(e));
      return null;
    });
    if (outcome) {
      setOffline(outcome.offline);
      if (outcome.saved > 0) await load();
    }
    ctx.bump();
  }, [ctx, base, t.id, load]);

  useEffect(() => {
    load();
    flush();
  }, [load]);

  useEffect(() => {
    const undo = onResume(() => {
      flush();
      load();
    });
    // Other phones and the desk enter results too; look again now and then.
    const timer = setInterval(() => {
      if (ctx.outbox.count(base, t.id) > 0) flush();
      else load();
    }, 20_000);
    return () => {
      undo();
      clearInterval(timer);
    };
  }, [flush, load]);

  async function enter(b: Board, result: string) {
    setBoard(null);
    await ctx.outbox.addResult(base, t.id, {
      round: number,
      pairing: b.id,
      board: b.board,
      white: b.white?.id ?? null,
      black: b.black?.id ?? null,
      result,
      expected: b.result,
    });
    ctx.bump();
    flush();
  }

  async function clear(b: Board) {
    setBoard(null);
    try {
      await ctx.api.clear(t.id, number, b.id, b.result);
      setInfo(`Board ${b.label}: cleared.`);
    } catch (e) {
      setError(describeError(e));
    }
    load();
  }

  async function incident(b: Board | null, type: string, note: string) {
    await ctx.outbox.addIncident(base, t.id, {
      round: number,
      ...(b ? { pairing: b.id, board: b.board } : {}),
      type,
      note,
    });
    ctx.bump();
    flush();
    setInfo(b ? `Board ${b.label}: incident queued.` : "Incident queued.");
  }

  if (latest < 1) {
    return <NothingPaired ctx={ctx} t={t} onPaired={props.reloadTournament} />;
  }

  const queued = ctx.outbox.list(base, t.id).filter((q) => q.entry.round === number);
  const waitingFor = new Map(
    queued.filter((q) => q.state === "waiting" && q.entry.kind === "result").map((q) => [q.entry.kind === "result" ? q.entry.pairing : 0, q]),
  );
  const refused = queued.filter((q) => q.state === "refused");
  const missing = round ? round.boards.filter((b) => !b.bye && !b.result).length : 0;

  return (
    <div class="round">
      <div class="round-head">
        <button type="button" class="icon-btn" aria-label="Previous round" disabled={number <= 1} onClick={() => setNumber(number - 1)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <div class="round-title">
          <strong>Round {number}</strong>
          <span>
            {round ? (missing ? `${missing} to go` : "All results in") : "…"}
            {round && ` · ${PUBLISH[round.publish_level] ?? ""}`}
          </span>
        </div>
        <button type="button" class="icon-btn" aria-label="Next round" disabled={number >= latest} onClick={() => setNumber(number + 1)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {offline && (
        <Notice kind="info">
          No connection. Results you enter wait on this phone{waitingFor.size ? ` (${waitingFor.size} now)` : ""} and are sent when the signal is back.
        </Notice>
      )}
      {error && (
        <Notice kind="error" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}
      {info && (
        <Notice kind="ok" onClose={() => setInfo(null)}>
          {info}
        </Notice>
      )}
      {refused.map((q) => (
        <Notice key={q.entry.cid} kind="error" onClose={() => ctx.outbox.dismiss(q.entry.cid).then(ctx.bump)}>
          Not accepted: {q.message}
        </Notice>
      ))}

      {!round && !error && <Loading />}
      {round && round.boards.length === 0 && <Empty>No boards in this round.</Empty>}
      {round && (
        <ul class="boards" id="boards">
          {round.boards.map((b) => {
            const pending = waitingFor.get(b.id);
            const shown = pending && pending.entry.kind === "result" ? pending.entry.result : b.result;
            return (
              <li key={b.id}>
                <button
                  type="button"
                  class={`board ${shown ? "done" : ""} ${pending ? "pending" : ""}`}
                  id={`board-${b.id}`}
                  disabled={b.bye || t.read_only}
                  onClick={() => setBoard(b)}
                >
                  <span class="board-no">{b.label}</span>
                  <span class="players">
                    <Name p={b.white} />
                    {b.bye ? <span class="bye">bye</span> : <Name p={b.black} />}
                  </span>
                  <span class="result">
                    {shown ? resultLabel(shown) : "–"}
                    {pending && <span class="state">Waiting</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {round?.byes.length ? (
        <p class="byes">
          Not playing: {round.byes.map((b) => `${b.player.name} (${b.type})`).join(", ")}
        </p>
      ) : null}

      <div class="round-actions">
        {t.can.includes("incidents") && (
          <IncidentButton onLog={(type, note) => incident(null, type, note)} />
        )}
        {(t.can.includes("pair") || t.can.includes("publish")) && (
          <button type="button" class="btn block" id="desk-actions" onClick={() => setDesk(true)}>
            Pair and publish
          </button>
        )}
      </div>

      {board && round && (
        <ResultSheet
          board={board}
          codes={round.results}
          canIncident={t.can.includes("incidents")}
          onResult={(r) => enter(board, r)}
          onClear={() => clear(board)}
          onIncident={(type, note) => {
            setBoard(null);
            incident(board, type, note);
          }}
          onClose={() => setBoard(null)}
        />
      )}

      {desk && round && (
        <DeskSheet
          ctx={ctx}
          t={t}
          round={round}
          onClose={() => setDesk(false)}
          onChanged={async (message, goTo) => {
            setDesk(false);
            setInfo(message);
            await props.reloadTournament();
            if (goTo !== undefined) setNumber(goTo);
            else load();
          }}
        />
      )}
    </div>
  );
}

function Name(props: { p: Board["white"] }) {
  if (!props.p) return <span class="name">–</span>;
  return (
    <span class="name">
      {props.p.title && <em>{props.p.title} </em>}
      {props.p.name}
      <small>
        {props.p.rating ?? ""} · {props.p.score}
      </small>
    </span>
  );
}

function ResultSheet(props: {
  board: Board;
  codes: string[];
  canIncident: boolean;
  onResult: (r: string) => void;
  onClear: () => void;
  onIncident: (type: string, note: string) => void;
  onClose: () => void;
}) {
  const { board } = props;
  const [more, setMore] = useState(false);
  const [incident, setIncident] = useState(false);
  const others = props.codes.filter((c) => !MAIN_RESULTS.includes(c));

  if (incident) {
    return (
      <Sheet title={`Board ${board.label}: incident`} onClose={props.onClose}>
        <IncidentForm onLog={props.onIncident} />
      </Sheet>
    );
  }

  return (
    <Sheet title={`Board ${board.label}`} onClose={props.onClose}>
      <p class="sheet-sub">
        {board.white?.name} – {board.black?.name}
      </p>
      <div class="result-grid">
        {MAIN_RESULTS.filter((c) => props.codes.includes(c)).map((c) => (
          <button type="button" key={c} class={`btn big ${board.result === c ? "primary" : ""}`} onClick={() => props.onResult(c)}>
            {resultLabel(c)}
          </button>
        ))}
      </div>
      {more ? (
        <div class="result-grid small">
          {others.map((c) => (
            <button type="button" key={c} class={`btn ${board.result === c ? "primary" : ""}`} onClick={() => props.onResult(c)}>
              {resultLabel(c)}
            </button>
          ))}
        </div>
      ) : (
        others.length > 0 && (
          <button type="button" class="btn ghost block" onClick={() => setMore(true)}>
            Forfeits and other results
          </button>
        )
      )}
      <div class="sheet-actions">
        {board.clearable && (
          <button type="button" class="btn danger block" onClick={props.onClear}>
            Clear the result (needs a connection)
          </button>
        )}
        {props.canIncident && (
          <button type="button" class="btn block" onClick={() => setIncident(true)}>
            Log an incident
          </button>
        )}
      </div>
    </Sheet>
  );
}

function IncidentButton(props: { onLog: (type: string, note: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" class="btn block" id="log-incident" onClick={() => setOpen(true)}>
        Log an incident
      </button>
      {open && (
        <Sheet title="Incident" onClose={() => setOpen(false)}>
          <IncidentForm
            onLog={(type, note) => {
              setOpen(false);
              props.onLog(type, note);
            }}
          />
        </Sheet>
      )}
    </>
  );
}

function IncidentForm(props: { onLog: (type: string, note: string) => void }) {
  const [type, setType] = useState("arbiter_call");
  const [note, setNote] = useState("");
  return (
    <form
      class="form"
      onSubmit={(e) => {
        e.preventDefault();
        props.onLog(type, note.trim());
      }}
    >
      <label for="incident-type">What happened</label>
      <select id="incident-type" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)}>
        {INCIDENT_KINDS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <label for="incident-note">Note</label>
      <textarea id="incident-note" rows={3} maxLength={500} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
      <button type="submit" class="btn primary block">
        Log it
      </button>
    </form>
  );
}

function NothingPaired(props: { ctx: Ctx; t: Tournament; onPaired: () => Promise<void> }) {
  return (
    <div class="round">
      <Empty>No round is paired yet.</Empty>
      {props.t.can.includes("pair") && <PairButton ctx={props.ctx} t={props.t} onPaired={() => props.onPaired()} />}
    </div>
  );
}

function PairButton(props: { ctx: Ctx; t: Tournament; onPaired: (n: number) => void }) {
  const { ctx, t } = props;
  const next = t.next_round;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acks, setAcks] = useState<string[]>([]);

  if (!next) return null;
  if (next.blocker === "all_rounds_paired") return <p class="fine">Every round is paired.</p>;
  if (next.blocker) {
    return (
      <Notice kind="info">
        {next.blocker === "setup_incomplete"
          ? "Finish the tournament setup at the desk before pairing."
          : next.blocker === "read_only"
            ? "This tournament is read-only."
            : "This tournament is paired at the desk."}
      </Notice>
    );
  }

  const toConfirm = next.warnings.filter((w) => w.confirm);
  const ready = toConfirm.every((w) => acks.includes(w.id));

  async function pair() {
    setBusy(true);
    setError(null);
    try {
      const round = await ctx.api.pair(t.id, acks);
      props.onPaired(round.number);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="pair">
      {next.warnings.map((w) => (
        <label key={w.id} class="warning">
          {w.confirm && (
            <input
              type="checkbox"
              checked={acks.includes(w.id)}
              onChange={(e) =>
                setAcks((e.target as HTMLInputElement).checked ? [...acks, w.id] : acks.filter((a) => a !== w.id))
              }
            />
          )}
          <span>{w.message}</span>
        </label>
      ))}
      {error && <Notice kind="error">{error}</Notice>}
      <button type="button" class="btn primary block" id="pair-next" disabled={busy || !ready} onClick={pair}>
        {busy ? "Pairing…" : `Pair round ${next.number}`}
      </button>
    </div>
  );
}

function DeskSheet(props: {
  ctx: Ctx;
  t: Tournament;
  round: Round;
  onClose: () => void;
  onChanged: (message: string, goTo?: number) => void;
}) {
  const { ctx, t, round } = props;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={`Round ${round.number}`} onClose={props.onClose}>
      {t.can.includes("publish") && (
        <>
          <h3>Public</h3>
          <div class="segmented" role="radiogroup" aria-label="Published">
            {PUBLISH.map((label, level) => (
              <button
                type="button"
                key={level}
                role="radio"
                aria-checked={round.publish_level === level}
                class={round.publish_level === level ? "active" : ""}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await ctx.api.publish(t.id, round.number, level as 0 | 1 | 2 | 3);
                    props.onChanged(`Round ${round.number}: ${label.toLowerCase()}.`);
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {t.can.includes("pair") && round.latest && (
        <>
          <h3>Next round</h3>
          <PairButton ctx={ctx} t={t} onPaired={(n) => props.onChanged(`Round ${n} paired.`, n)} />
          {confirmUndo ? (
            <div class="confirm">
              <p>Unpair round {round.number}? Its pairings and results are deleted; a snapshot is kept at the desk.</p>
              <button
                type="button"
                class="btn danger block"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await ctx.api.unpair(t.id, round.number);
                    props.onChanged(`Round ${round.number} unpaired.`, round.number - 1);
                  })
                }
              >
                Unpair round {round.number}
              </button>
            </div>
          ) : (
            <button type="button" class="btn ghost block" onClick={() => setConfirmUndo(true)}>
              Undo round {round.number}
            </button>
          )}
        </>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </Sheet>
  );
}
