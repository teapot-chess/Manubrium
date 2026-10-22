// Home: the round. Tap a board, tap a result. Results queue (they work
// without a signal); clearing, pairing, publishing, hand edits and the word
// on a Lite phone's result are online only.

import { useCallback, useEffect, useState } from "preact/hooks";
import { ApiError, OfflineError, type Board, type Round, type Tournament } from "../api";
import { onResume, takePhoto } from "../platform";
import type { Ctx } from "./App";
import { describeError, Empty, Loading, Notice, resultLabel, ShareButton, Sheet } from "./common";
import { t as tr } from "../i18n";
import { boardReportLabel } from "../alnasl";
import { pairingsText } from "../share";
import { refusalText } from "../queue";
import { BoardEditSheet, FinishEdits, PoolPanel } from "./PairingEdits";

const MAIN_RESULTS = ["1-0", "1/2-1/2", "0-1"];
const publishLabels = (): string[] => [0, 1, 2, 3].map((n) => tr(`round.publish.${n}` as "round.publish.0"));
/** The incident kinds the app offers; the contract's incident.kind must know every one. */
export const incidentKinds = (): [string, string][] => [
  ["illegal_move", tr("incident.kind.illegal_move")],
  ["clock", tr("incident.kind.clock")],
  ["device", tr("incident.kind.device")],
  ["complaint", tr("incident.kind.complaint")],
  ["time_added", tr("incident.kind.time_added")],
  ["game_rewound", tr("incident.kind.game_rewound")],
  ["arbiter_call", tr("incident.kind.arbiter_call")],
  ["other", tr("incident.kind.other")],
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
  const [editing, setEditing] = useState<Board | null>(null);
  const deskRole = t.can.includes("pair");

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
    }, b.label);
    ctx.bump();
    flush();
  }

  async function clear(b: Board) {
    setBoard(null);
    try {
      await ctx.api.clear(t.id, number, b.id, b.result);
      setInfo(tr("round.board_cleared", { label: b.label }));
    } catch (e) {
      setError(describeError(e));
    }
    load();
  }

  // The arbiter's word on a result a Lite phone entered: it stands, or the
  // board is cleared. Both name what the board showed, so a result changed
  // meanwhile is refused rather than confirmed unseen.
  async function verdict(b: Board, confirm: boolean) {
    setBoard(null);
    try {
      if (confirm) await ctx.api.confirmResult(t.id, number, b.id, b.result);
      else await ctx.api.rejectResult(t.id, number, b.id, b.result);
      setInfo(
        confirm
          ? tr("round.board_confirmed", { label: b.label, result: resultLabel(b.result) })
          : tr("round.board_rejected", { label: b.label }),
      );
    } catch (e) {
      setError(describeError(e));
    }
    load();
  }

  async function edited(message: string) {
    setEditing(null);
    setInfo(message);
    await load();
  }

  // Every incident belongs to a board: the server has nowhere to put one
  // without, and refused the round-level ones as "Board ?".
  async function incident(b: Board, type: string, note: string, photo: string | null) {
    await ctx.outbox.addIncident(
      base,
      t.id,
      {
        round: number,
        pairing: b.id,
        board: b.board,
        type,
        note,
        ...(photo ? { photo } : {}),
      },
      b.label,
    );
    ctx.bump();
    flush();
    setInfo(tr("round.board_incident_queued", { label: b.label }));
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
  const toCheck = round ? round.boards.filter((b) => b.phone?.state === "unconfirmed").length : 0;

  return (
    <div class="round">
      <div class="round-head">
        <button type="button" class="icon-btn" aria-label={tr("round.prev")} disabled={number <= 1} onClick={() => setNumber(number - 1)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <div class="round-title">
          <strong>{tr("round.title", { n: number })}</strong>
          <span>
            {round ? (missing ? tr("round.to_go", { n: missing }) : tr("round.all_in")) : "…"}
            {round && ` · ${publishLabels()[round.publish_level] ?? ""}`}
          </span>
        </div>
        <button type="button" class="icon-btn" aria-label={tr("round.next")} disabled={number >= latest} onClick={() => setNumber(number + 1)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {offline && (
        <Notice kind="info">
          {tr("round.offline", { now: waitingFor.size ? tr("round.offline_now", { n: waitingFor.size }) : "" })}
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
          {tr("more.not_accepted", { reason: refusalText(q) })}
        </Notice>
      ))}

      {toCheck > 0 && t.can.includes("results") && (
        <Notice kind="info">
          {toCheck === 1 ? tr("round.check_one") : tr("round.check_other", { n: toCheck })}
        </Notice>
      )}
      {round && deskRole && <FinishEdits ctx={ctx} t={t} round={round} onDone={edited} />}

      {round && round.boards.length > 0 && (
        <div class="view-tools">
          <ShareButton id="share-round" title={tr("round.share_title", { name: t.name, n: round.number })} text={() => pairingsText(t, round)} />
        </div>
      )}

      {!round && !error && <Loading />}
      {round && round.boards.length === 0 && <Empty>{tr("round.no_boards")}</Empty>}
      {round && (
        <ul class="boards" id="boards">
          {round.boards.map((b) => {
            const pending = waitingFor.get(b.id);
            const shown = pending && pending.entry.kind === "result" ? pending.entry.result : b.result;
            return (
              <li key={b.id}>
                <button
                  type="button"
                  class={`board ${shown ? "done" : ""} ${pending ? "pending" : ""} ${b.phone?.state === "unconfirmed" ? "from-phone" : ""}`}
                  id={`board-${b.id}`}
                  disabled={t.read_only || ((b.bye || b.vacant || b.empty) && !deskRole)}
                  onClick={() => (b.bye || b.vacant || b.empty ? setEditing(b) : setBoard(b))}
                >
                  <span class="board-no">{b.label}</span>
                  <span class="players">
                    <Name p={b.white} />
                    {b.bye ? <span class="bye">{tr("round.bye")}</span> : <Name p={b.black} />}
                    <BoardReportLine board={b} />
                  </span>
                  <span class="result">
                    {shown ? resultLabel(shown) : "–"}
                    {pending && <span class="state">{tr("round.waiting")}</span>}
                    {!pending && b.phone?.state === "unconfirmed" && <span class="state phone">{tr("round.phone")}</span>}
                    {!pending && b.phone?.state === "confirmed" && <span class="state">{tr("round.checked")}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {round?.byes.length ? (
        <p class="byes">
          {tr("round.not_playing", { list: round.byes.map((b) => `${b.player.name} (${b.type})`).join(", ") })}
        </p>
      ) : null}

      {round && deskRole && !t.read_only && <PoolPanel ctx={ctx} t={t} round={round} onDone={edited} />}

      <div class="round-actions">
        {t.can.includes("incidents") && (
          <IncidentButton boards={round ? round.boards.filter((b) => !b.bye && !b.empty) : []} onLog={(b, type, note, photo) => incident(b, type, note, photo)} />
        )}
        {(t.can.includes("pair") || t.can.includes("publish")) && (
          <button type="button" class="btn block" id="desk-actions" onClick={() => setDesk(true)}>
            {tr("round.pair_publish")}
          </button>
        )}
      </div>

      {board && round && (
        <ResultSheet
          board={board}
          codes={round.results}
          canIncident={t.can.includes("incidents")}
          canEdit={deskRole}
          onResult={(r) => enter(board, r)}
          onClear={() => clear(board)}
          onConfirm={() => verdict(board, true)}
          onReject={() => verdict(board, false)}
          onEdit={() => {
            setBoard(null);
            setEditing(board);
          }}
          onIncident={(type, note, photo) => {
            setBoard(null);
            incident(board, type, note, photo);
          }}
          onClose={() => setBoard(null)}
        />
      )}

      {editing && round && (
        <BoardEditSheet ctx={ctx} t={t} round={round} board={editing} onClose={() => setEditing(null)} onDone={edited} />
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
      <small>{props.p.rating ? `${props.p.rating} · ${props.p.score}` : props.p.score}</small>
    </span>
  );
}

// The hall board's word (Alnasl), small, beside the pairing: red when it
// disagrees with the result entered. Only ever shown - never entered,
// never offered as a choice.
function BoardReportLine(props: { board: Board }) {
  const report = props.board.board_report;
  const label = boardReportLabel(report);
  if (!report || !label) return null;
  return (
    <span
      class={`board-report ${report.mismatch ? "mismatch" : ""}`}
      id={`board-report-${props.board.id}`}
      title={report.mismatch ? tr("round.board_report_mismatch") : tr("round.board_report_title")}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 12h16M12 4v16" />
      </svg>
      {label}
      {report.mismatch && ` · ${tr("round.differs")}`}
    </span>
  );
}

function ResultSheet(props: {
  board: Board;
  codes: string[];
  canIncident: boolean;
  canEdit: boolean;
  onResult: (r: string) => void;
  onClear: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onEdit: () => void;
  onIncident: (type: string, note: string, photo: string | null) => void;
  onClose: () => void;
}) {
  const { board } = props;
  const [more, setMore] = useState(false);
  const [incident, setIncident] = useState(false);
  const others = props.codes.filter((c) => !MAIN_RESULTS.includes(c));

  if (incident) {
    return (
      <Sheet title={tr("round.board_incident", { label: board.label })} onClose={props.onClose}>
        <IncidentForm onLog={props.onIncident} />
      </Sheet>
    );
  }

  return (
    <Sheet title={tr("round.board", { label: board.label })} onClose={props.onClose}>
      <p class="sheet-sub">
        {board.white?.name} – {board.black?.name}
      </p>
      {board.phone?.state === "unconfirmed" && (
        <div class="phone-check" id="phone-check">
          <p>
            <strong>{resultLabel(board.result)}</strong>{" "}
            {tr("round.phone_entered", { by: board.phone.by ?? "" })}
          </p>
          <div class="two-btn">
            <button type="button" class="btn danger" id="reject-result" onClick={props.onReject}>
              {tr("round.reject")}
            </button>
            <button type="button" class="btn primary" id="confirm-result" onClick={props.onConfirm}>
              {tr("round.confirm")}
            </button>
          </div>
        </div>
      )}
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
            {tr("round.more_results")}
          </button>
        )
      )}
      <div class="sheet-actions">
        {board.clearable && (
          <button type="button" class="btn danger block" onClick={props.onClear}>
            {tr("round.clear")}
          </button>
        )}
        {props.canIncident && (
          <button type="button" class="btn block" onClick={() => setIncident(true)}>
            {tr("round.log_incident")}
          </button>
        )}
        {props.canEdit && (
          <button type="button" class="btn ghost block" id="edit-pairing" onClick={props.onEdit}>
            {tr("round.change_pairing")}
          </button>
        )}
      </div>
    </Sheet>
  );
}

function IncidentButton(props: { boards: Board[]; onLog: (b: Board, type: string, note: string, photo: string | null) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" class="btn block" id="log-incident" onClick={() => setOpen(true)}>
        {tr("round.log_incident")}
      </button>
      {open && (
        <Sheet title={tr("round.incident")} onClose={() => setOpen(false)}>
          <IncidentForm
            boards={props.boards}
            onLog={(type, note, photo, b) => {
              if (!b) return;
              setOpen(false);
              props.onLog(b, type, note, photo);
            }}
          />
        </Sheet>
      )}
    </>
  );
}

/**
 * The incident dialog. Opened from a board, it is about that board; opened
 * from the round (`boards` given), it asks which one first.
 */
export function IncidentForm(props: {
  boards?: Board[];
  onLog: (type: string, note: string, photo: string | null, board?: Board) => void;
}) {
  const [type, setType] = useState("arbiter_call");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [boardId, setBoardId] = useState("");
  const chosen = props.boards?.find((b) => String(b.id) === boardId);
  const ready = !props.boards || !!chosen;
  return (
    <form
      class="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) props.onLog(type, note.trim(), photo, chosen);
      }}
    >
      {props.boards && (
        <>
          <label for="incident-board">{tr("round.board_label")}</label>
          <select id="incident-board" required value={boardId} onChange={(e) => setBoardId((e.target as HTMLSelectElement).value)}>
            <option value="">{tr("round.which_board")}</option>
            {props.boards.map((b) => (
              <option key={b.id} value={String(b.id)}>
                {b.label}: {b.white?.name ?? "-"} - {b.black?.name ?? "-"}
              </option>
            ))}
          </select>
        </>
      )}
      <label for="incident-type">{tr("round.what")}</label>
      <select id="incident-type" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)}>
        {incidentKinds().map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <label for="incident-note">{tr("round.note")}</label>
      <textarea id="incident-note" rows={3} maxLength={500} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
      {photo ? (
        <div class="photo-preview">
          <img src={`data:image/jpeg;base64,${photo}`} alt={tr("round.photo_alt")} />
          <button type="button" class="btn ghost" id="incident-photo-drop" onClick={() => setPhoto(null)}>
            {tr("round.remove_photo")}
          </button>
        </div>
      ) : (
        <button type="button" class="btn block" id="incident-photo" onClick={async () => setPhoto(await takePhoto())}>
          {tr("round.take_photo")}
        </button>
      )}
      <button type="submit" class="btn primary block" disabled={!ready}>
        {tr("round.log_it")}
      </button>
    </form>
  );
}

function NothingPaired(props: { ctx: Ctx; t: Tournament; onPaired: () => Promise<void> }) {
  return (
    <div class="round">
      <Empty>{tr("round.none_paired")}</Empty>
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
  if (next.blocker === "all_rounds_paired") return <p class="fine">{tr("round.all_paired")}</p>;
  if (next.blocker) {
    return (
      <Notice kind="info">
        {next.blocker === "setup_incomplete"
          ? tr("round.blocker_setup")
          : next.blocker === "read_only"
            ? tr("round.blocker_read_only")
            : tr("round.blocker_desk")}
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
        {busy ? tr("round.pairing") : tr("round.pair_n", { n: next.number })}
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
    <Sheet title={tr("more.round", { round: round.number })} onClose={props.onClose}>
      {t.can.includes("publish") && (
        <>
          <h3>{tr("round.public")}</h3>
          <div class="segmented" role="radiogroup" aria-label={tr("round.published_aria")}>
            {publishLabels().map((label, level) => (
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
                    props.onChanged(tr("round.published_msg", { n: round.number, label: label.toLowerCase() }));
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
          <h3>{tr("round.next_round")}</h3>
          <PairButton ctx={ctx} t={t} onPaired={(n) => props.onChanged(tr("round.paired_msg", { n }), n)} />
          {confirmUndo ? (
            <div class="confirm">
              <p>{tr("round.unpair_q", { n: round.number })}</p>
              <button
                type="button"
                class="btn danger block"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await ctx.api.unpair(t.id, round.number);
                    props.onChanged(tr("round.unpaired_msg", { n: round.number }), round.number - 1);
                  })
                }
              >
                {tr("round.unpair_btn", { n: round.number })}
              </button>
              <button type="button" class="btn block" id="unpair-keep" disabled={busy} onClick={() => setConfirmUndo(false)}>
                {tr("common.keep")}
              </button>
            </div>
          ) : (
            <button type="button" class="btn ghost block" onClick={() => setConfirmUndo(true)}>
              {tr("round.undo_btn", { n: round.number })}
            </button>
          )}
        </>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </Sheet>
  );
}
