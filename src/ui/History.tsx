// A board's history: who changed its result, when, and from what to what,
// with Undo where the desk would allow it. The server decides (a later
// change, a later round paired with it, a refused write): the phone shows
// its reason as it is and offers the button only when it says yes.

import { useEffect, useState } from "preact/hooks";
import { type Board, type BoardHistory, type Tournament } from "../api";
import type { Ctx } from "./App";
import { describeError, Loading, Notice, Sheet } from "./common";
import { dateLocale, t as tr } from "../i18n";

const when = (iso: string) => new Date(iso).toLocaleString(dateLocale(), { dateStyle: "short", timeStyle: "short" });

export function HistorySheet(props: {
  ctx: Ctx;
  t: Tournament;
  round: number;
  board: Board;
  onClose: () => void;
  /** An undo went through: the round is read again and the sentence shown. */
  onUndone: (message: string) => void;
}) {
  const { ctx, t, board } = props;
  const [history, setHistory] = useState<BoardHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  async function load() {
    try {
      setHistory(await ctx.api.boardHistory(t.id, props.round, board.id));
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }

  useEffect(() => {
    void load();
  }, [t.id, props.round, board.id]);

  async function undo(entry: number) {
    setBusy(entry);
    try {
      props.onUndone(await ctx.api.undo(t.id, props.round, board.id, entry));
    } catch (e) {
      // A refusal comes with its reason; the list may be out of date too.
      setError(describeError(e));
      await load();
    } finally {
      setBusy(null);
    }
  }

  const canUndo = t.can.includes("results") && !t.read_only;

  return (
    <Sheet title={tr("history.title", { label: board.label })} onClose={props.onClose}>
      {error && <Notice kind="error">{error}</Notice>}
      {!history && !error && <Loading />}
      {history && history.entries.length === 0 && (
        <p class="empty" id="history-empty">
          {tr("history.empty")}
        </p>
      )}
      {history && history.entries.length > 0 && (
        <ul class="list compact" id="history-list">
          {history.entries.map((e) => (
            <li key={e.id} class="row history-entry" id={`history-${e.id}`}>
              <span class="row-main static">
                <span class="row-title">{e.text}</span>
                <span class="row-sub">
                  {e.who} · {when(e.at)}
                </span>
                {e.undo.status === "refused" && e.undo.reason && (
                  <span class="row-sub undo-reason" id={`history-reason-${e.id}`}>
                    {tr("history.cannot", { reason: e.undo.reason })}
                  </span>
                )}
              </span>
              {canUndo && e.undo.status === "ok" && (
                <button type="button" class="chip" id={`history-undo-${e.id}`} disabled={busy !== null} onClick={() => void undo(e.id)}>
                  {tr("history.undo")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
