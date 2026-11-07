// @vitest-environment happy-dom
//
// Live board control on the phone: the boards screen, a board's sheet, and
// every command it sends, against a fake API. The box is never involved:
// the phone talks to OpenPairings only.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type BoardCommand, type Client, type LiveBoards, type LiveTable, type Round, type Tournament } from "../api";
import { goBack, resetBack } from "../back";
import { saveLanguage } from "../i18n";
import type { Foreground } from "../poll";
import { Outbox } from "../queue";
import type { SavedServer } from "../servers";
import type { Ctx } from "./App";
import { commandsFor, LiveBoardsScreen } from "./LiveBoards";
import { MoreScreen } from "./MoreScreen";

vi.mock("../platform", () => ({
  onResume: () => () => undefined,
  takePhoto: vi.fn(async () => null),
  shareText: vi.fn(async () => "shared"),
}));

const START = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

const server: SavedServer = {
  base: "https://pairings.example",
  token: "mnb_t",
  label: "pairings.example",
  user: { email: "arbiter@example.org", name: null },
  info: { name: "OpenPairings", version: "1", api: 1, desktop: false },
  deviceId: 1,
  addedAt: "2026-10-21T00:00:00Z",
};

function table(extra: Partial<LiveTable> = {}): LiveTable {
  return {
    link_id: 4,
    board: 12,
    name: "Board 3",
    table: 3,
    serial: "06310",
    connected: true,
    last_seen: new Date().toISOString(),
    stale: false,
    state: "live",
    flipped: false,
    alarms: [],
    alarm_detail: null,
    draft: null,
    guessed_plies: [],
    fen: START,
    last_move: "e2e4",
    white_ms: 5_371_000,
    black_ms: 5_340_000,
    running: "black",
    clock_at: new Date().toISOString(),
    round: 3,
    board_no: 5,
    game: "g1",
    pairing: { id: 991, round: 3, board: 5, label: "5", white: "Player One", black: "Player Two", result: null },
    board_result: null,
    plies: 1,
    ...extra,
  };
}

function live(tables: LiveTable[], commands: BoardCommand[] = [], extra: Partial<LiveBoards> = {}): LiveBoards {
  return {
    poll_seconds: 5,
    round: 3,
    boxes: [{ link_id: 4, name: "Hall A", version: "0.17.0", last_seen_at: new Date().toISOString(), online: true, tables_at: null }],
    tables,
    commands,
    ...extra,
  };
}

function command(extra: Partial<BoardCommand> = {}): BoardCommand {
  return {
    id: 41,
    kind: "flip",
    link_id: 4,
    board: 12,
    game: "g1",
    args: { flipped: true },
    state: "pending",
    error: null,
    detail: null,
    created_at: "2026-11-08T10:15:00Z",
    sent_at: null,
    done_at: null,
    expires_at: "2026-11-08T10:17:00Z",
    by: "Jane Arbiter",
    ...extra,
  };
}

const round3: Round = {
  number: 3,
  latest: true,
  publish_level: 1,
  boards: [
    { id: 991, board: 5, label: "5", white: { id: 1, name: "Player One", title: null, rating: null, score: 0 }, black: { id: 2, name: "Player Two", title: null, rating: null, score: 0 }, bye: false, result: "", clearable: false },
    { id: 992, board: 6, label: "6", white: { id: 3, name: "Player Three", title: null, rating: null, score: 0 }, black: { id: 4, name: "Player Four", title: null, rating: null, score: 0 }, bye: false, result: "", clearable: false },
    { id: 993, board: null, label: "bye", white: { id: 5, name: "Odd One", title: null, rating: null, score: 0 }, black: null, bye: true, result: "+", clearable: false },
  ],
  byes: [],
  results: [],
};

function fakeApi(data: LiveBoards) {
  return {
    liveBoards: vi.fn(async () => data),
    liveGame: vi.fn(async () => ({
      game: "g1",
      status: "live",
      result: null,
      moves: ["e4", "e5", "Nf3"],
      move_clocks: [null, null, null],
      white_ms: null,
      black_ms: null,
      running: null,
      start_fen: null,
      reconstructed: false,
      guessed: false,
      reported_at: null,
    })),
    sendBoardCommand: vi.fn(async (_id: number, req: { kind: string }) => command({ id: 50, kind: req.kind, state: req.kind === "accept_result" ? "done" : "pending" })),
    boardCommand: vi.fn(async () => command({ id: 50, state: "done" })),
    round: vi.fn(async () => round3),
    boardLinks: vi.fn(async () => [{ id: 4, kind: "tournament", label: "Hall A", reach: null, created_at: "", last_seen_at: null }]),
    incidents: vi.fn(async () => []),
    hall: vi.fn(async () => ({ apps: [], devices: [], round: null, countdown: null })),
  };
}
type FakeApi = ReturnType<typeof fakeApi>;

function tournament(extra: Partial<Tournament> = {}): Tournament {
  return {
    id: 7,
    name: "Hall Open",
    role: "owner",
    status: "running",
    rounds_count: 5,
    paired_rounds: 3,
    can: ["results", "incidents", "pair", "publish", "players", "standings", "settings"],
    read_only: false,
    archived: false,
    handed_off: false,
    pairing_system: "swiss",
    team: false,
    rounds: [],
    next_round: null,
    settings: {},
    ...extra,
  };
}

const ctxWith = (api: FakeApi): Ctx => ({ server, api: api as unknown as Client, outbox: new Outbox({ get: async () => null, set: async () => undefined }), bump: () => undefined });

/** A foreground the test drives; `listening` says whether the screen still watches it. */
function foreground() {
  let listener: ((a: boolean) => void) | null = null;
  const f: Foreground = (cb) => {
    listener = cb;
    return () => {
      listener = null;
    };
  };
  return { f, set: (a: boolean) => listener?.(a), listening: () => listener !== null };
}

const el = (selector: string) =>
  waitFor(() => {
    const found = document.querySelector(selector);
    if (!found) throw new Error(`${selector} not rendered`);
    return found as HTMLElement;
  });

function open(api: FakeApi, t: Tournament = tournament(), fg = foreground()) {
  const onClose = vi.fn();
  render(<LiveBoardsScreen ctx={ctxWith(api)} t={t} onClose={onClose} foreground={fg.f} />);
  return { onClose, fg };
}

async function sheet(api: FakeApi, t?: Tournament) {
  const out = open(api, t);
  fireEvent.click(await el("#live-table-4-12"));
  await el("#live-sheet");
  return out;
}

beforeEach(async () => {
  await saveLanguage({ get: async () => null, set: async () => undefined }, "en");
});

afterEach(() => {
  cleanup();
  resetBack();
});

describe("the boards screen", () => {
  it("opens from the hall boards under More, and only once a code exists", async () => {
    const api = fakeApi(live([table()]));
    render(<MoreScreen ctx={ctxWith(api)} t={tournament()} />);
    fireEvent.click(await el("#open-live-boards"));
    await el("#live-table-4-12");
    expect(api.liveBoards).toHaveBeenCalledWith(7);
  });

  it("lists every table with its health, state, alarms, draft and both results", async () => {
    const api = fakeApi(
      live([
        table({ state: "guessed", alarms: ["out_of_turn", "cat_on_board"], draft: { id: 7, reason: "conflict", from_ply: 12, plies: 30 }, board_result: "0-1", pairing: { ...table().pairing!, result: "1-0" } }),
        table({ board: 13, name: "Board 4", table: 4, stale: true, state: "teleporting", game: null, pairing: null }),
      ]),
    );
    open(api);
    const one = await el("#live-table-4-12");
    expect(one.textContent).toContain("Table 3 · Board 3");
    expect(one.textContent).toContain("5. Player One – Player Two");
    expect(one.querySelector(".live-state")!.className).toContain("bad");
    expect(one.textContent).toContain("moves guessed");
    expect(one.textContent).toContain("out of turn");
    expect(one.textContent).toContain("cat_on_board");
    expect(one.textContent).toContain("memory draft waiting");
    expect(one.querySelector(".live-results")!.className).toContain("mismatch");
    expect(one.textContent).toContain("arbiter 1-0 · board 0-1");
    expect(one.textContent).toContain("Connected");
    expect(one.querySelectorAll(".mini-board .sq")).toHaveLength(64);

    const two = document.querySelector("#live-table-4-13")!;
    expect(two.textContent).toContain("No news from the box");
    expect(two.textContent).toContain("teleporting");
    expect(two.textContent).toContain("Not linked to a pairing");
    expect(document.querySelector("#live-box-4")!.textContent).toContain("online");
  });

  it("says so when no box has reported", async () => {
    const api = fakeApi(live([], [], { boxes: [] }));
    open(api);
    await screen.findByText(/No box has reported yet/);
  });

  it("stops polling when left, by the back button too", async () => {
    const api = fakeApi(live([table()]));
    const { onClose, fg } = open(api);
    await el("#live-table-4-12");
    expect(fg.listening()).toBe(true);
    goBack();
    expect(onClose).toHaveBeenCalled();
    cleanup();
    await waitFor(() => expect(fg.listening()).toBe(false));
  });

  it("asks again at once when the app comes back to the foreground", async () => {
    const api = fakeApi(live([table()]));
    const { fg } = open(api);
    await el("#live-table-4-12");
    const before = api.liveBoards.mock.calls.length;
    fg.set(false);
    fg.set(true);
    await waitFor(() => expect(api.liveBoards.mock.calls.length).toBe(before + 1));
  });
});

describe("a board's sheet", () => {
  it("draws the position with the last move, and the moves", async () => {
    const api = fakeApi(live([table()]));
    await sheet(api);
    const board = document.querySelector("#live-sheet .mini-board.large")!;
    expect(board.querySelectorAll(".sq")).toHaveLength(64);
    expect(board.querySelector(".sq")!.getAttribute("data-square")).toBe("a8");
    expect([...board.querySelectorAll(".sq.last")].map((s) => s.getAttribute("data-square")).sort()).toEqual(["e2", "e4"]);
    expect(board.querySelector('[data-square="e4"] .pc.w')).not.toBeNull();
    await waitFor(() => expect(document.querySelector("#live-moves")!.textContent).toContain("Nf3"));
    expect(api.liveGame).toHaveBeenCalledWith(7, "g1");
    expect(document.querySelector("#live-clock-black")!.className).toContain("running");
  });

  it("turns the board round when the box has it flipped", async () => {
    const api = fakeApi(live([table({ flipped: true })]));
    await sheet(api);
    const board = document.querySelector("#live-sheet .mini-board.large")!;
    expect(board.querySelector(".sq")!.getAttribute("data-square")).toBe("h1");
  });

  it("fetches the moves again when the board has more", async () => {
    const api = fakeApi(live([table()]));
    const { fg } = await sheet(api);
    await waitFor(() => expect(api.liveGame).toHaveBeenCalledTimes(1));
    api.liveBoards.mockResolvedValue(live([table({ plies: 2 })]));
    fg.set(false);
    fg.set(true);
    await waitFor(() => expect(api.liveGame).toHaveBeenCalledTimes(2));
  });

  it("accepts the board's result after a confirmation naming the result and the players", async () => {
    const api = fakeApi(live([table({ board_result: "1/2-1/2" })]));
    await sheet(api);
    fireEvent.click(await el("#cmd-accept-result"));
    expect(api.sendBoardCommand).not.toHaveBeenCalled();
    const ask = await el("#live-confirm");
    expect(ask.textContent).toContain("Player One – Player Two");
    expect(ask.textContent).toContain("½-½");
    fireEvent.click(document.querySelector("#live-confirm-yes")!);
    await waitFor(() => expect(api.sendBoardCommand).toHaveBeenCalledWith(7, { kind: "accept_result", game: "g1" }));
  });

  it("offers no accept when the arbiter has a result, or the board none", async () => {
    const api = fakeApi(live([table({ board_result: "1-0", pairing: { ...table().pairing!, result: "1-0" } })]));
    await sheet(api);
    expect(document.querySelector("#cmd-accept-result")).toBeNull();
    cleanup();
    const api2 = fakeApi(live([table({ board_result: null })]));
    await sheet(api2);
    expect(document.querySelector("#cmd-accept-result")).toBeNull();
  });

  it("says why the server refused, in words", async () => {
    const api = fakeApi(live([table({ board_result: "1-0" })]));
    api.sendBoardCommand.mockRejectedValue(new ApiError(409, "result_entered", "raw"));
    await sheet(api);
    fireEvent.click(await el("#cmd-accept-result"));
    fireEvent.click(await el("#live-confirm-yes"));
    await screen.findByText(/already has a result/);
  });

  it("flips at once, without asking", async () => {
    const api = fakeApi(live([table()]));
    await sheet(api);
    fireEvent.click(await el("#cmd-flip"));
    await waitFor(() => expect(api.sendBoardCommand).toHaveBeenCalledWith(7, { kind: "flip", link_id: 4, board: 12, game: "g1", args: { flipped: true } }));
  });

  it("keeps a guessed run at once, and takes one back only after asking", async () => {
    const api = fakeApi(live([table({ state: "guessed", guessed_plies: [23, 24] })]));
    await sheet(api);
    fireEvent.click(await el("#cmd-confirm-guess-23"));
    await waitFor(() => expect(api.sendBoardCommand).toHaveBeenLastCalledWith(7, expect.objectContaining({ kind: "confirm_guess", args: { ply: 23 } })));
    fireEvent.click(await el("#cmd-reject-guess-23"));
    expect(api.sendBoardCommand).toHaveBeenCalledTimes(1);
    fireEvent.click(await el("#live-confirm-yes"));
    await waitFor(() => expect(api.sendBoardCommand).toHaveBeenLastCalledWith(7, expect.objectContaining({ kind: "reject_guess", args: { ply: 23 } })));
  });

  it("accepts a memory draft, and discards one only after asking", async () => {
    const api = fakeApi(live([table({ draft: { id: 7, reason: "conflict", from_ply: 12, plies: 30 } })]));
    await sheet(api);
    fireEvent.click(await el("#cmd-accept-draft"));
    await waitFor(() => expect(api.sendBoardCommand).toHaveBeenLastCalledWith(7, expect.objectContaining({ kind: "accept_draft", args: { draft: 7 } })));
    fireEvent.click(await el("#cmd-dismiss-draft"));
    fireEvent.click(await el("#live-confirm-yes"));
    await waitFor(() => expect(api.sendBoardCommand).toHaveBeenLastCalledWith(7, expect.objectContaining({ kind: "dismiss_draft", args: { draft: 7 } })));
  });

  it("checks a typed position before it asks, then sends it whole", async () => {
    const api = fakeApi(live([table()]));
    await sheet(api);
    fireEvent.click(await el("#cmd-set-position"));
    const input = (await el("#live-fen")) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: "8/8/8/8/8/8/8/8" } });
    fireEvent.submit(document.querySelector("#live-fen-form")!);
    expect((await el("#live-fen-problem")).textContent).toContain("exactly one king");
    fireEvent.input(input, { target: { value: "4k3/8/8/8/8/8/8/4K3" } });
    fireEvent.submit(document.querySelector("#live-fen-form")!);
    fireEvent.click(await el("#live-confirm-yes"));
    await waitFor(() =>
      expect(api.sendBoardCommand).toHaveBeenCalledWith(7, expect.objectContaining({ kind: "set_position", args: { fen: "4k3/8/8/8/8/8/8/4K3 w - - 0 1" } })),
    );
  });

  it("takes back a chosen number of plies after asking", async () => {
    const api = fakeApi(live([table()]));
    await sheet(api);
    fireEvent.click(await el("#cmd-takeback"));
    fireEvent.click(await el("#takeback-more"));
    fireEvent.click(document.querySelector("#takeback-send")!);
    expect((await el("#live-confirm")).textContent).toContain("2 plies");
    fireEvent.click(document.querySelector("#live-confirm-yes")!);
    await waitFor(() => expect(api.sendBoardCommand).toHaveBeenCalledWith(7, expect.objectContaining({ kind: "takeback", args: { plies: 2 } })));
  });

  it("finishes a game on the box only, and says so", async () => {
    const api = fakeApi(live([table()]));
    await sheet(api);
    fireEvent.click(await el("#cmd-finish"));
    await screen.findByText(/on the box only/);
    fireEvent.click(await el("#finish-1_0"));
    expect((await el("#live-confirm")).textContent).toContain("Only on the box");
    fireEvent.click(document.querySelector("#live-confirm-yes")!);
    await waitFor(() => expect(api.sendBoardCommand).toHaveBeenCalledWith(7, expect.objectContaining({ kind: "finish", args: { result: "1-0" } })));
  });

  it("links to a pairing of the current round, picked from the round", async () => {
    const api = fakeApi(live([table({ game: null, pairing: null, round: null, board_no: null, state: "unlinked" })]));
    await sheet(api);
    fireEvent.click(await el("#cmd-link"));
    await waitFor(() => expect(api.round).toHaveBeenCalledWith(7, 3));
    expect(document.querySelector("#live-link-993")).toBeNull();
    fireEvent.click(await el("#live-link-992"));
    await waitFor(() => expect(api.sendBoardCommand).toHaveBeenCalledWith(7, expect.objectContaining({ kind: "link", args: { round: 3, board_no: 6 } })));
  });

  it("asks before unlinking or restarting, and re-reads at once", async () => {
    const api = fakeApi(live([table()]));
    await sheet(api);
    fireEvent.click(await el("#cmd-unlink"));
    fireEvent.click(await el("#live-confirm-yes"));
    await waitFor(() => expect(api.sendBoardCommand).toHaveBeenLastCalledWith(7, expect.objectContaining({ kind: "unlink", args: {} })));
    fireEvent.click(await el("#cmd-restart"));
    fireEvent.click(await el("#live-confirm-yes"));
    await waitFor(() => expect(api.sendBoardCommand).toHaveBeenLastCalledWith(7, expect.objectContaining({ kind: "restart" })));
    fireEvent.click(await el("#cmd-resync"));
    await waitFor(() => expect(api.sendBoardCommand).toHaveBeenLastCalledWith(7, expect.objectContaining({ kind: "resync" })));
    expect(api.sendBoardCommand).toHaveBeenCalledTimes(3);
  });

  it("shows where each command stands, in the box's words mapped to sentences", async () => {
    const api = fakeApi(
      live(
        [table()],
        [
          command({ id: 43, kind: "reject_guess", state: "failed", error: "not_last", detail: null }),
          command({ id: 42, kind: "restart", state: "expired" }),
          command({ id: 41, state: "sent" }),
          command({ id: 40, link_id: 9, state: "done" }),
        ],
      ),
    );
    await sheet(api);
    expect((await el("#live-command-43")).textContent).toContain("not the last ones");
    expect(document.querySelector("#live-command-42")!.textContent).toContain("never picked it up");
    expect(document.querySelector("#live-command-41")!.textContent).toContain("The box has it.");
    expect(document.querySelector("#live-command-40")).toBeNull();
  });

  it("follows a sent command until the box answers", async () => {
    const api = fakeApi(live([table()]));
    await sheet(api);
    fireEvent.click(await el("#cmd-flip"));
    await el("#live-command-50");
    // Not on the recent list: asked by id, at once and on every poll after.
    await waitFor(() => expect(api.boardCommand).toHaveBeenCalledWith(7, 50));
    await waitFor(() => expect(document.querySelector("#live-command-50")!.textContent).toContain("Done."));
  });

  it("offers no commands on a read-only tournament", async () => {
    const api = fakeApi(live([table({ board_result: "1-0", guessed_plies: [3] })]));
    await sheet(api, tournament({ read_only: true }));
    expect(document.querySelector("#cmd-flip")).toBeNull();
    expect(document.querySelector("#cmd-accept-result")).toBeNull();
    expect(document.querySelector("#cmd-confirm-guess-3")).toBeNull();
  });
});

describe("commandsFor", () => {
  it("keeps the board's own commands and its game's accepted result, newest first", () => {
    const x = table();
    const got = commandsFor(
      x,
      [command({ id: 3 }), command({ id: 2, kind: "accept_result", link_id: null, board: null, game: "g1" }), command({ id: 1, board: 99 })],
      { 5: command({ id: 5 }) },
    );
    expect(got.map((c) => c.id)).toEqual([5, 3, 2]);
  });
});

