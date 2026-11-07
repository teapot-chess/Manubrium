// Live board control: every board in the hall, as its box (Alnasl) last
// reported it, and the commands the arbiter can send it. The phone asks
// OpenPairings and nothing else; a command waits there until the box calls
// in and fetches it. A board never enters a result: "accept the board's
// result" is the arbiter's own tap, carried out by OpenPairings.
//
// Polled every `poll_seconds` while this screen (or a board's sheet on it)
// is open and the app is in the foreground; leaving the screen stops it.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { BoardCommand, BoardCommandRequest, Board, LiveBoards, LiveBox, LiveGame, LiveTable, Tournament } from "../api";
import { ApiError } from "../api";
import { pushBack } from "../back";
import { completeFen, fenProblem, isWhite, moveSquares, parseFen, pieceGlyph, squareName, type FenProblem } from "../fen";
import { t as tr, type Key } from "../i18n";
import {
  ago,
  alarmLabel,
  clockNow,
  commandKindLabel,
  commandStateText,
  finishLabel,
  formatClock,
  guessedRuns,
  health,
  isFinal,
  liveErrorText,
  plyName,
  runName,
  stateLabel,
  stateTone,
} from "../liveBoards";
import { poll, watchForeground, type Foreground } from "../poll";
import type { Ctx } from "./App";
import { describeError, Empty, Loading, Notice, resultLabel, Sheet, TopBar, TryAgain } from "./common";
import "./liveBoards.css";

const keyOf = (x: { link_id: number | null; board: number | null }) => `${x.link_id}:${x.board}`;

function errorText(e: unknown): string {
  return liveErrorText(e) ?? describeError(e);
}

export function LiveBoardsScreen(props: { ctx: Ctx; t: Tournament; onClose: () => void; foreground?: Foreground }) {
  const { ctx, t } = props;
  const [data, setData] = useState<LiveBoards | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** Commands this phone sent, as last heard of, by id: kept when they fall off the recent list. */
  const [mine, setMine] = useState<Record<number, BoardCommand>>({});
  const mineRef = useRef(mine);
  mineRef.current = mine;
  const [now, setNow] = useState(Date.now());
  const poller = useRef<{ now(): void } | null>(null);
  const close = useRef(props.onClose);
  close.current = props.onClose;

  useEffect(() => pushBack(() => close.current(), "screen"), []);

  useEffect(() => {
    const tick = async () => {
      try {
        const next = await ctx.api.liveBoards(t.id);
        setData(next);
        setError(null);
        // Ours that left the recent list and are not settled: asked one by one.
        const listed = new Set(next.commands.map((c) => c.id));
        const updates: Record<number, BoardCommand> = {};
        for (const c of next.commands) if (mineRef.current[c.id]) updates[c.id] = c;
        for (const c of Object.values(mineRef.current)) {
          if (listed.has(c.id) || isFinal(c)) continue;
          try {
            updates[c.id] = await ctx.api.boardCommand(t.id, c.id);
          } catch (e) {
            if (e instanceof ApiError && e.status === 404) updates[c.id] = { ...c, state: "expired" };
          }
        }
        if (Object.keys(updates).length) setMine((m) => ({ ...m, ...updates }));
        return next.poll_seconds;
      } catch (e) {
        setError(errorText(e));
        throw e;
      }
    };
    const p = poll(tick, 5, props.foreground ?? watchForeground);
    poller.current = p;
    return () => {
      p.stop();
      poller.current = null;
    };
  }, [t.id]);

  // The running clocks and the "ago"s move on between two reports.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function send(request: BoardCommandRequest): Promise<BoardCommand> {
    const command = await ctx.api.sendBoardCommand(t.id, request);
    setMine((m) => ({ ...m, [command.id]: command }));
    poller.current?.now();
    return command;
  }

  const boxes = useMemo(() => new Map((data?.boxes ?? []).map((b) => [b.link_id, b])), [data]);
  const open = data?.tables.find((x) => keyOf(x) === openKey) ?? null;

  return (
    <div class="live-screen" id="live-boards">
      <TopBar title={tr("live.screen_title")} subtitle={t.name} onBack={props.onClose} backLabel={tr("common.back")} />
      <main class="content">
        {error && (
          <Notice kind="error" onClose={() => setError(null)}>
            {error}
          </Notice>
        )}
        {!data && !error && <Loading />}
        {!data && error && <TryAgain id="live-retry" onClick={() => poller.current?.now()} />}
        {data && (
          <>
            {data.boxes.length > 0 && (
              <div class="live-boxes" id="live-boxes">
                {data.boxes.map((b) => (
                  <span key={b.link_id} class={`live-box ${b.online ? "online" : "offline"}`} id={`live-box-${b.link_id}`}>
                    <span class="dot" aria-hidden="true" />
                    {b.name || tr("live.box_unnamed")} · {b.online ? tr("live.box_online") : tr("live.box_offline", { when: ago(b.last_seen_at, now) ?? tr("live.never") })}
                  </span>
                ))}
              </div>
            )}
            {data.tables.length === 0 && <Empty>{data.boxes.length ? tr("live.no_tables") : tr("live.no_boxes")}</Empty>}
            {data.tables.length > 0 && (
              <ul class="list live-list" id="live-tables">
                {data.tables.map((x) => (
                  <TableRow key={keyOf(x)} table={x} box={boxes.get(x.link_id)} now={now} onOpen={() => setOpenKey(keyOf(x))} />
                ))}
              </ul>
            )}
            <p class="fine">{tr("live.fine")}</p>
          </>
        )}
      </main>
      {open && data && (
        <BoardSheet
          ctx={ctx}
          t={t}
          table={open}
          box={boxes.get(open.link_id)}
          round={data.round}
          now={now}
          commands={commandsFor(open, data.commands, mine)}
          send={send}
          onClose={() => setOpenKey(null)}
        />
      )}
    </div>
  );
}

/** The commands about one board, newest first: the server's recent list, and ours it no longer lists. */
export function commandsFor(table: LiveTable, recent: BoardCommand[], mine: Record<number, BoardCommand>): BoardCommand[] {
  const about = (c: BoardCommand) => (c.kind === "accept_result" ? !!table.game && c.game === table.game : c.link_id === table.link_id && c.board === table.board);
  const byId = new Map<number, BoardCommand>();
  for (const c of Object.values(mine)) if (about(c)) byId.set(c.id, c);
  for (const c of recent) if (about(c)) byId.set(c.id, c);
  return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, 6);
}

function tableTitle(x: LiveTable): string {
  return x.table !== null ? tr("live.table_n", { n: x.table, name: x.name }) : x.name;
}

function pairingLine(x: LiveTable): string | null {
  if (!x.pairing) return null;
  return `${x.pairing.label}. ${x.pairing.white ?? "–"} – ${x.pairing.black ?? "–"}`;
}

function TableRow(props: { table: LiveTable; box: LiveBox | undefined; now: number; onOpen: () => void }) {
  const x = props.table;
  const h = health(x);
  return (
    <li class="row">
      <button type="button" class="row-main live-row" id={`live-table-${x.link_id}-${x.board}`} onClick={props.onOpen}>
        <MiniBoard fen={x.fen} lastMove={x.last_move} flipped={x.flipped} size="small" />
        <span class="live-row-text">
          <span class="row-title">
            {tableTitle(x)}
            <StateBadge state={x.state} />
          </span>
          <span class="row-sub">{pairingLine(x) ?? (x.game ? tr("live.unknown_game") : tr("live.no_pairing"))}</span>
          <HealthLine table={x} box={props.box} now={props.now} health={h} />
          <Chips table={x} />
          <ResultLine table={x} />
        </span>
      </button>
    </li>
  );
}

function StateBadge(props: { state: string }) {
  return <span class={`live-state ${stateTone(props.state)}`}>{stateLabel(props.state)}</span>;
}

function HealthLine(props: { table: LiveTable; box: LiveBox | undefined; now: number; health: ReturnType<typeof health> }) {
  const seen = ago(props.table.last_seen, props.now);
  return (
    <span class={`live-health ${props.health}`}>
      <span class="dot" aria-hidden="true" />
      {tr(`live.health.${props.health}` as Key)}
      {seen && ` · ${tr("live.last_seen", { when: seen })}`}
      {props.box && !props.box.online && ` · ${tr("live.box_down")}`}
    </span>
  );
}

function Chips(props: { table: LiveTable }) {
  const x = props.table;
  if (!x.alarms.length && !x.draft && !x.guessed_plies.length) return null;
  return (
    <span class="live-chips">
      {x.alarms.map((a) => (
        <span key={a} class="live-chip alarm" title={x.alarm_detail ?? undefined}>
          {alarmLabel(a)}
        </span>
      ))}
      {x.draft && <span class="live-chip draft">{tr("live.draft_waiting")}</span>}
      {x.guessed_plies.length > 0 && <span class="live-chip alarm">{tr("live.guessed_n", { n: x.guessed_plies.length })}</span>}
    </span>
  );
}

function ResultLine(props: { table: LiveTable }) {
  const x = props.table;
  const arbiter = x.pairing?.result ?? null;
  const seen = x.board_result;
  if (!arbiter && !seen) return null;
  const differs = !!arbiter && !!seen && arbiter !== seen;
  return (
    <span class={`live-results ${differs ? "mismatch" : ""}`}>
      {tr("live.arbiter_result", { result: arbiter ? resultLabel(arbiter) : "–" })} · {tr("live.board_result", { result: seen ? resultLabel(seen) : "–" })}
      {differs && ` · ${tr("live.differs")}`}
    </span>
  );
}

/** The position, drawn from a FEN: 64 squares, the last move marked, White at the bottom unless flipped. */
interface MiniBoardProps {
  fen: string | null;
  lastMove: string | null;
  flipped: boolean;
  size?: "small" | "large";
}

// Drawn again only when what it shows changes: the list redraws every second
// for the clocks, and 64 squares a table add up. The same vnode handed back
// is skipped by Preact. (Not preact/compat's memo: compat rewires onChange
// app-wide.)
export function MiniBoard(props: MiniBoardProps) {
  return useMemo(() => drawBoard(props), [props.fen, props.lastMove, props.flipped, props.size]);
}

function drawBoard(props: MiniBoardProps) {
  const squares = parseFen(props.fen);
  const size = props.size ?? "large";
  if (!squares) {
    return (
      <span class={`mini-board ${size} empty`} role="img" aria-label={tr("live.no_position")}>
        {size === "large" && tr("live.no_position")}
      </span>
    );
  }
  const marked = moveSquares(props.lastMove);
  const order = props.flipped ? [...squares.keys()].reverse() : [...squares.keys()];
  return (
    <span class={`mini-board ${size}`} role="img" aria-label={props.fen ?? ""} data-flipped={props.flipped ? "true" : "false"}>
      {order.map((i) => {
        const piece = squares[i];
        const dark = (Math.floor(i / 8) + (i % 8)) % 2 === 1;
        const last = marked && (marked[0] === i || marked[1] === i);
        return (
          <span key={i} class={["sq", dark ? "dark" : "light", last ? "last" : ""].join(" ")} data-square={squareName(i)}>
            {piece && <span class={`pc ${isWhite(piece) ? "w" : "b"}`}>{pieceGlyph(piece)}</span>}
          </span>
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// One board's sheet: the position, the clocks, the moves, the commands.

type Panel = "link" | "fen" | "takeback" | "finish" | null;
interface Ask {
  title: string;
  text: string;
  yes: string;
  danger: boolean;
  request: BoardCommandRequest;
}

function BoardSheet(props: {
  ctx: Ctx;
  t: Tournament;
  table: LiveTable;
  box: LiveBox | undefined;
  round: number | null;
  now: number;
  commands: BoardCommand[];
  send: (r: BoardCommandRequest) => Promise<BoardCommand>;
  onClose: () => void;
}) {
  const { ctx, t, table: x } = props;
  const [game, setGame] = useState<LiveGame | null>(null);
  const [gameError, setGameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const canCommand = !t.read_only;

  // The moves: when the sheet opens, and again whenever the board has more (or fewer).
  useEffect(() => {
    setGameError(null);
    if (!x.game) {
      setGame(null);
      return;
    }
    let live = true;
    ctx.api.liveGame(t.id, x.game).then(
      (g) => live && setGame(g),
      (e) => {
        if (!live) return;
        setGame(null);
        setGameError(e instanceof ApiError && e.code === "game_not_found" ? tr("live.no_moves") : errorText(e));
      },
    );
    return () => {
      live = false;
    };
  }, [x.game, x.plies]);

  const box = (kind: Exclude<BoardCommandRequest["kind"], "accept_result">, args: Record<string, unknown> = {}): BoardCommandRequest => ({
    kind,
    link_id: x.link_id,
    board: x.board,
    game: x.game,
    args,
  });

  async function go(request: BoardCommandRequest) {
    setBusy(true);
    setError(null);
    try {
      await props.send(request);
      setAsk(null);
      setPanel(null);
    } catch (e) {
      setAsk(null);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const confirm = (key: string, request: BoardCommandRequest, vars: Record<string, string | number> = {}, danger = true) =>
    setAsk({
      title: tr(`live.ask.${key}.title` as Key, vars),
      text: tr(`live.ask.${key}.text` as Key, vars),
      yes: tr(`live.ask.${key}.yes` as Key, vars),
      danger,
      request,
    });

  const white = x.pairing?.white ?? tr("live.white");
  const black = x.pairing?.black ?? tr("live.black");
  const canAccept = !!x.board_result && !!x.pairing && x.pairing.result === null && !!x.game;
  const runs = guessedRuns(x.guessed_plies);
  const pending = props.commands.filter((c) => !isFinal(c));

  return (
    <Sheet title={tableTitle(x)} onClose={props.onClose}>
      <div id="live-sheet">
        <p class="sheet-sub">
          {pairingLine(x) ?? tr("live.no_pairing")}
          <StateBadge state={x.state} />
        </p>
        <HealthLine table={x} box={props.box} now={props.now} health={health(x)} />
        {x.alarm_detail && <p class="live-alarm-detail">{x.alarm_detail}</p>}
        <Chips table={x} />

        <div class="live-clock-row">
          <Clock label={x.flipped ? white : black} side={x.flipped ? "white" : "black"} table={x} now={props.now} />
        </div>
        <MiniBoard fen={x.fen} lastMove={x.last_move} flipped={x.flipped} />
        <div class="live-clock-row">
          <Clock label={x.flipped ? black : white} side={x.flipped ? "black" : "white"} table={x} now={props.now} />
        </div>
        {x.running && x.running !== "none" && <p class="fine">{tr("live.clock_approx")}</p>}

        <ResultLine table={x} />

        {error && (
          <Notice kind="error" onClose={() => setError(null)}>
            {error}
          </Notice>
        )}

        {props.commands.length > 0 && (
          <>
            <h3>{tr("live.commands")}</h3>
            <ul class="live-commands" id="live-commands">
              {props.commands.map((c) => (
                <li key={c.id} class={`live-command ${c.state}`} id={`live-command-${c.id}`}>
                  <strong>{commandKindLabel(c.kind)}</strong> <span>{commandStateText(c)}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {canCommand && (
          <>
            {canAccept && (
              <button
                type="button"
                class="btn primary block"
                id="cmd-accept-result"
                disabled={busy}
                onClick={() =>
                  confirm("accept_result", { kind: "accept_result", game: x.game! }, { result: resultLabel(x.board_result!), white, black }, false)
                }
              >
                {tr("live.accept_result", { result: resultLabel(x.board_result!) })}
              </button>
            )}

            {runs.length > 0 && (
              <>
                <h3>{tr("live.guessed_title")}</h3>
                {runs.map((run) => (
                  <div class="live-guess" key={run[0]} id={`guess-${run[0]}`}>
                    <span>{tr("live.guessed_run", { moves: runName(run) })}</span>
                    <button type="button" class="chip" id={`cmd-confirm-guess-${run[0]}`} disabled={busy} onClick={() => go(box("confirm_guess", { ply: run[0] }))}>
                      {tr("live.confirm_guess")}
                    </button>
                    <button
                      type="button"
                      class="chip danger"
                      id={`cmd-reject-guess-${run[0]}`}
                      disabled={busy}
                      onClick={() => confirm("reject_guess", box("reject_guess", { ply: run[0] }), { moves: runName(run) })}
                    >
                      {tr("live.reject_guess")}
                    </button>
                  </div>
                ))}
              </>
            )}

            {x.draft && (
              <>
                <h3>{tr("live.draft_title")}</h3>
                <p class="fine">{tr("live.draft_text", { from: x.draft.from_ply > 0 ? plyName(x.draft.from_ply) : "1.", n: x.draft.plies, reason: x.draft.reason })}</p>
                <div class="live-actions">
                  <button type="button" class="btn" id="cmd-accept-draft" disabled={busy} onClick={() => go(box("accept_draft", { draft: x.draft!.id }))}>
                    {tr("live.accept_draft")}
                  </button>
                  <button
                    type="button"
                    class="btn danger"
                    id="cmd-dismiss-draft"
                    disabled={busy}
                    onClick={() => confirm("dismiss_draft", box("dismiss_draft", { draft: x.draft!.id }))}
                  >
                    {tr("live.dismiss_draft")}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        <h3>{tr("live.moves")}</h3>
        <Moves game={game} error={gameError} guessed={x.guessed_plies} hasGame={!!x.game} />

        {canCommand && (
          <>
            <h3>{tr("live.board_actions")}</h3>
            <div class="live-actions">
              <button type="button" class="btn" id="cmd-flip" disabled={busy} onClick={() => go(box("flip", { flipped: !x.flipped }))}>
                {tr("live.flip")}
              </button>
              <button type="button" class="btn" id="cmd-resync" disabled={busy} onClick={() => go(box("resync"))}>
                {tr("live.resync")}
              </button>
              <button type="button" class="btn" id="cmd-link" disabled={busy} onClick={() => setPanel("link")}>
                {x.game ? tr("live.relink") : tr("live.link")}
              </button>
              {(x.game || x.round !== null) && (
                <button type="button" class="btn danger" id="cmd-unlink" disabled={busy} onClick={() => confirm("unlink", box("unlink"), { name: x.name })}>
                  {tr("live.unlink")}
                </button>
              )}
              <button type="button" class="btn danger" id="cmd-takeback" disabled={busy} onClick={() => setPanel("takeback")}>
                {tr("live.takeback")}
              </button>
              <button type="button" class="btn danger" id="cmd-set-position" disabled={busy} onClick={() => setPanel("fen")}>
                {tr("live.set_position")}
              </button>
              <button type="button" class="btn danger" id="cmd-finish" disabled={busy} onClick={() => setPanel("finish")}>
                {tr("live.finish")}
              </button>
              <button type="button" class="btn danger" id="cmd-restart" disabled={busy} onClick={() => confirm("restart", box("restart"), { name: x.name })}>
                {tr("live.restart")}
              </button>
            </div>
            {pending.length > 0 && <p class="fine">{tr("live.pending_hint")}</p>}
          </>
        )}
      </div>

      {panel === "link" && (
        <LinkPanel
          ctx={ctx}
          t={t}
          round={props.round ?? x.round}
          onClose={() => setPanel(null)}
          onPick={(r, b) => confirmLink(r, b)}
        />
      )}
      {panel === "fen" && <FenPanel initial={x.fen ?? ""} onClose={() => setPanel(null)} onSend={(fen) => confirm("set_position", box("set_position", { fen }), { fen })} />}
      {panel === "takeback" && <TakebackPanel onClose={() => setPanel(null)} onSend={(n) => confirm("takeback", box("takeback", { plies: n }), { n: n === 1 ? tr("live.plies_one") : tr("live.plies_other", { n }) })} />}
      {panel === "finish" && (
        <FinishPanel onClose={() => setPanel(null)} onSend={(result) => confirm("finish", box("finish", { result }), { result: finishLabel(result) })} />
      )}

      {ask && (
        <Sheet title={ask.title} onClose={() => setAsk(null)}>
          <div id="live-confirm">
            <p>{ask.text}</p>
            <button type="button" class={`btn block ${ask.danger ? "danger" : "primary"}`} id="live-confirm-yes" disabled={busy} onClick={() => go(ask.request)}>
              {ask.yes}
            </button>
            <button type="button" class="btn block" id="live-confirm-no" onClick={() => setAsk(null)}>
              {tr("common.keep")}
            </button>
          </div>
        </Sheet>
      )}
    </Sheet>
  );

  function confirmLink(round: number, b: Board) {
    const who = `${b.white?.name ?? "–"} – ${b.black?.name ?? "–"}`;
    setPanel(null);
    // Linking is not destructive in itself, but moving a board that plays a game is: asked when it does.
    if (x.game) confirm("link", box("link", { round, board_no: b.board }), { label: b.label, round, who });
    else go(box("link", { round, board_no: b.board }));
  }
}

function Clock(props: { label: string; side: "white" | "black"; table: LiveTable; now: number }) {
  const ms = clockNow(props.table, props.side, props.now);
  const running = props.table.running === props.side;
  return (
    <span class={`live-clock ${props.side} ${running ? "running" : ""}`} id={`live-clock-${props.side}`}>
      <span class="who">{props.label}</span>
      <span class="time">{formatClock(ms)}</span>
    </span>
  );
}

function Moves(props: { game: LiveGame | null; error: string | null; guessed: number[]; hasGame: boolean }) {
  if (!props.hasGame) return <p class="fine">{tr("live.no_game")}</p>;
  if (props.error) return <p class="fine">{props.error}</p>;
  if (!props.game) return <Loading />;
  const g = props.game;
  if (!g.moves.length) return <p class="fine">{tr("live.no_moves_yet")}</p>;
  const guessed = new Set(props.guessed);
  const pairs: { n: number; plies: [number, string][] }[] = [];
  g.moves.forEach((san, i) => {
    const ply = i + 1;
    if (ply % 2 === 1) pairs.push({ n: (ply + 1) / 2, plies: [] });
    pairs[pairs.length - 1].plies.push([ply, san]);
  });
  return (
    <>
      {(g.reconstructed || g.guessed) && <p class="fine">{g.guessed ? tr("live.moves_guessed") : tr("live.moves_reconstructed")}</p>}
      <ol class="live-moves" id="live-moves">
        {pairs.map((p) => (
          <li key={p.n}>
            <span class="n">{p.n}.</span>
            {p.plies.map(([ply, san]) => (
              <span key={ply} class={guessed.has(ply) ? "guessed" : ""} data-ply={ply}>
                {san}
              </span>
            ))}
          </li>
        ))}
      </ol>
    </>
  );
}

function LinkPanel(props: { ctx: Ctx; t: Tournament; round: number | null; onClose: () => void; onPick: (round: number, b: Board) => void }) {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const n = props.round;

  useEffect(() => {
    if (!n) return;
    props.ctx.api.round(props.t.id, n).then(
      (r) => setBoards(r.boards.filter((b) => b.board !== null && !b.bye)),
      (e) => setError(describeError(e)),
    );
  }, [n]);

  return (
    <Sheet title={n ? tr("live.link_title", { round: n }) : tr("live.link")} onClose={props.onClose}>
      {!n && <Empty>{tr("live.link_no_round")}</Empty>}
      {error && <Notice kind="error">{error}</Notice>}
      {n && !boards && !error && <Loading />}
      {boards && boards.length === 0 && <Empty>{tr("live.link_no_boards")}</Empty>}
      {boards && boards.length > 0 && (
        <ul class="list compact" id="live-link-boards">
          {boards.map((b) => (
            <li key={b.id} class="row">
              <button type="button" class="row-main" id={`live-link-${b.id}`} onClick={() => props.onPick(n!, b)}>
                <span class="row-title">
                  {b.label}. {b.white?.name ?? "–"} – {b.black?.name ?? "–"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function FenPanel(props: { initial: string; onClose: () => void; onSend: (fen: string) => void }) {
  const [fen, setFen] = useState(props.initial);
  const [problem, setProblem] = useState<FenProblem | null>(null);
  const preview = parseFen(fen);
  function submit(e: Event) {
    e.preventDefault();
    const p = fenProblem(fen);
    setProblem(p);
    if (!p) props.onSend(completeFen(fen));
  }
  return (
    <Sheet title={tr("live.set_position")} onClose={props.onClose} dirty={fen !== props.initial}>
      <form class="form" id="live-fen-form" onSubmit={submit}>
        <label for="live-fen">{tr("live.fen_label")}</label>
        <textarea id="live-fen" rows={3} value={fen} spellcheck={false} autocapitalize="off" onInput={(e) => setFen((e.target as HTMLTextAreaElement).value)} />
        {problem && (
          <p class="live-fen-problem" id="live-fen-problem" role="alert">
            {tr(`live.fen.${problem}` as Key)}
          </p>
        )}
        {preview && <MiniBoard fen={fen} lastMove={null} flipped={false} />}
        <p class="fine">{tr("live.fen_hint")}</p>
        <button type="submit" class="btn danger block" id="live-fen-send">
          {tr("live.fen_send")}
        </button>
      </form>
    </Sheet>
  );
}

function TakebackPanel(props: { onClose: () => void; onSend: (n: number) => void }) {
  const [n, setN] = useState(1);
  return (
    <Sheet title={tr("live.takeback")} onClose={props.onClose}>
      <p class="sheet-sub">{tr("live.takeback_text")}</p>
      <div class="live-stepper">
        <button type="button" class="btn" id="takeback-less" disabled={n <= 1} onClick={() => setN(n - 1)} aria-label={tr("live.fewer")}>
          −
        </button>
        <span id="takeback-n">{n === 1 ? tr("live.plies_one") : tr("live.plies_other", { n })}</span>
        <button type="button" class="btn" id="takeback-more" disabled={n >= 20} onClick={() => setN(n + 1)} aria-label={tr("live.more")}>
          +
        </button>
      </div>
      <button type="button" class="btn danger block" id="takeback-send" onClick={() => props.onSend(n)}>
        {tr("live.takeback")}
      </button>
    </Sheet>
  );
}

const FINISH_RESULTS = ["1-0", "1/2-1/2", "0-1", "*"];

function FinishPanel(props: { onClose: () => void; onSend: (result: string) => void }) {
  return (
    <Sheet title={tr("live.finish")} onClose={props.onClose}>
      <p class="sheet-sub">{tr("live.finish_text")}</p>
      <div class="result-grid live-finish">
        {FINISH_RESULTS.map((r) => (
          <button type="button" class="btn" key={r} id={`finish-${r.replace(/\W/g, "_")}`} onClick={() => props.onSend(r)}>
            {finishLabel(r)}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

