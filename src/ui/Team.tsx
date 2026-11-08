// Several arbiters on one tournament, the desk's safety on the phone: who
// else is here (and a warning when they are entering results in the round
// on screen), the handover notes, and the card a collision turns into.
//
// The server does the judging. The phone says where it is every half minute
// or so, reads the others and the notes back, and asks nothing it does not
// get an answer for: a server that predates all this just answers an error,
// and the strip stays out of the way.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { OfflineError, type Board, type HandoverNote, type Team, type Tournament } from "../api";
import { onResume } from "../platform";
import type { Queued } from "../queue";
import type { Ctx } from "./App";
import { describeError, Notice, resultLabel, Sheet } from "./common";
import { t as tr } from "../i18n";

const NOTE_MAX = 500;
const DEFAULT_BEAT = 30;

/** The names of some people, as a list. */
export const names = (list: { label: string }[]): string => list.map((p) => p.label).join(", ");

export function TeamStrip(props: { ctx: Ctx; t: Tournament; round: number; onError?: (message: string) => void }) {
  const { ctx, t, round } = props;
  const [team, setTeam] = useState<Team | null>(null);
  const [notes, setNotes] = useState<HandoverNote[]>([]);
  const [open, setOpen] = useState(false);
  const beat = useRef(DEFAULT_BEAT);

  const look = useCallback(async () => {
    try {
      const [seen, list] = await Promise.all([ctx.api.team(t.id, round > 0 ? round : null), ctx.api.notes(t.id)]);
      beat.current = Math.max(10, seen.heartbeat_seconds);
      setTeam(seen);
      setNotes(list);
    } catch (e) {
      // Offline, or a server without the routes: say nothing, show what was last known.
      if (!(e instanceof OfflineError)) beat.current = 60;
    }
  }, [ctx.api, t.id, round]);

  useEffect(() => {
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      await look();
      if (!gone) timer = setTimeout(tick, beat.current * 1000);
    };
    void tick();
    const undo = onResume(() => void look());
    return () => {
      gone = true;
      if (timer) clearTimeout(timer);
      undo();
    };
  }, [look]);

  if (!team) return null;
  const entering = team.others.filter((p) => p.entering_here);
  const pinned = notes.filter((n) => n.pinned);
  const canWrite = t.can.includes("results") && !t.read_only;

  return (
    <div class="team-strip" id="team-strip">
      <div class="team-row">
        {team.others.length > 0 && (
          <ul class="team-faces" id="team-faces" aria-label={tr("team.here", { names: names(team.others) })}>
            {team.others.map((p) => (
              <li key={p.id} class={`team-avatar ${p.entering_results ? "is-entering" : ""}`} id={`team-${p.id}`} title={p.label}>
                <span aria-hidden="true">{p.initials}</span>
                <span class="sr-only">{p.label}</span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" class="chip" id="notes-open" onClick={() => setOpen(true)}>
          {notes.length > 0 ? tr("notes.button_n", { n: notes.length }) : tr("notes.button")}
        </button>
      </div>

      {entering.length > 0 && (
        <Notice kind="info">
          <span id="team-entering">{tr(entering.length === 1 ? "team.entering" : "team.entering_other", { who: names(entering) })}</span>
        </Notice>
      )}

      {pinned.map((n) => (
        <div class="note pinned" key={n.id} id={`note-pinned-${n.id}`}>
          <span>{n.body}</span>
          {canWrite && <ResolveButton ctx={ctx} t={t} note={n} onDone={setNotes} onError={props.onError} />}
        </div>
      ))}

      {open && (
        <NotesSheet
          ctx={ctx}
          t={t}
          round={round}
          notes={notes}
          canWrite={canWrite}
          onNotes={setNotes}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function ResolveButton(props: {
  ctx: Ctx;
  t: Tournament;
  note: HandoverNote;
  onDone: (notes: HandoverNote[]) => void;
  onError?: (message: string) => void;
}) {
  const { ctx, t, note } = props;
  return (
    <button
      type="button"
      class="chip"
      id={`note-resolve-${note.id}`}
      onClick={async () => {
        try {
          await ctx.api.updateNote(t.id, note.id, { resolved: true });
          props.onDone(await ctx.api.notes(t.id));
        } catch (e) {
          props.onError?.(describeError(e));
        }
      }}
    >
      {tr("notes.resolve")}
    </button>
  );
}

function NotesSheet(props: {
  ctx: Ctx;
  t: Tournament;
  round: number;
  notes: HandoverNote[];
  canWrite: boolean;
  onNotes: (notes: HandoverNote[]) => void;
  onClose: () => void;
}) {
  const { ctx, t } = props;
  const [body, setBody] = useState("");
  const [thisRound, setThisRound] = useState(false);
  const [pin, setPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: Event) {
    e.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await ctx.api.createNote(t.id, { body: text, round: thisRound && props.round > 0 ? props.round : null, pinned: pin });
      props.onNotes(await ctx.api.notes(t.id));
      setBody("");
      setThisRound(false);
      setPin(false);
      setError(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={tr("notes.title")} onClose={props.onClose} dirty={body.trim() !== ""}>
      {props.notes.length === 0 ? (
        <p class="empty" id="notes-none">
          {tr("notes.none")}
        </p>
      ) : (
        <ul class="list compact" id="notes-list">
          {props.notes.map((n) => (
            <li key={n.id} class="row" id={`note-${n.id}`}>
              <span class="row-main static">
                <span class="row-title">{n.body}</span>
                <span class="row-sub">
                  {[n.pinned ? tr("notes.pinned") : null, n.round ? tr("notes.round", { n: n.round }) : tr("notes.whole"), n.author].filter(Boolean).join(" · ")}
                </span>
              </span>
              {props.canWrite && <ResolveButton ctx={ctx} t={t} note={n} onDone={props.onNotes} onError={setError} />}
            </li>
          ))}
        </ul>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {props.canWrite && (
        <form class="form" id="note-form" onSubmit={save}>
          <h3>{tr("notes.add")}</h3>
          <label for="note-body">{tr("notes.body")}</label>
          <textarea id="note-body" rows={3} maxLength={NOTE_MAX} value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} />
          <p class="fine">{tr("notes.hint")}</p>
          {props.round > 0 && (
            <label class="check">
              <input type="checkbox" id="note-this-round" checked={thisRound} onChange={(e) => setThisRound((e.target as HTMLInputElement).checked)} /> {tr("notes.this_round")}
            </label>
          )}
          <label class="check">
            <input type="checkbox" id="note-pin" checked={pin} onChange={(e) => setPin((e.target as HTMLInputElement).checked)} /> {tr("notes.pin")}
          </label>
          <button type="submit" class="btn primary block" id="note-save" disabled={busy || body.trim() === ""}>
            {tr("notes.save")}
          </button>
        </form>
      )}
    </Sheet>
  );
}

/**
 * A result of this phone the server refused because the board moved on
 * (`conflict`), as a question instead of a sentence: keep what the board
 * says, or enter mine after all. "Mine" expects what the board holds now, so
 * the next collision is a new question and not a silent overwrite. What the
 * board holds comes with the refusal; when it does not (an answer replayed
 * after the app was closed), the round on screen knows it.
 */
export function ConflictNotice(props: {
  q: Queued;
  board: Board | undefined;
  onKeep: () => void;
  onMine: (expected: string) => void;
}) {
  const { q } = props;
  if (q.entry.kind !== "result") return null;
  const theirs = q.current ?? props.board?.result ?? null;
  const label = q.label ?? (q.entry.board ? String(q.entry.board) : "?");
  const mine = resultLabel(q.entry.result);
  const there = theirs === null ? null : theirs === "" ? tr("conflict.nothing") : resultLabel(theirs);

  return (
    <div class="notice error conflict" role="alert" id={`conflict-${q.entry.cid}`}>
      <strong>{tr("conflict.title", { label })}</strong>
      <span>{there === null ? tr("conflict.unknown", { mine }) : tr("conflict.text", { mine, theirs: there })}</span>
      <div class="two-btn">
        <button type="button" class="btn" id="conflict-keep" onClick={props.onKeep}>
          {tr("conflict.theirs")}
        </button>
        <button type="button" class="btn primary" id="conflict-mine" disabled={theirs === null} onClick={() => theirs !== null && props.onMine(theirs)}>
          {tr("conflict.mine")}
        </button>
      </div>
    </div>
  );
}
