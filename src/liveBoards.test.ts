import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, client, type FetchLike } from "./api";
import { completeFen, fenProblem, moveSquares, parseFen, pieceGlyph, squareIndex, squareName } from "./fen";
import { saveLanguage } from "./i18n";
import {
  ago,
  alarmLabel,
  boxErrorText,
  clockNow,
  commandStateText,
  formatClock,
  guessedRuns,
  health,
  liveErrorText,
  runName,
  stateLabel,
  stateTone,
} from "./liveBoards";
import { poll, type Foreground } from "./poll";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const memory = () => {
  const data = new Map<string, string>();
  return { get: async (k: string) => data.get(k) ?? null, set: async (k: string, v: string) => void data.set(k, v) };
};

beforeEach(async () => {
  await saveLanguage(memory(), "en");
});

describe("the FEN board", () => {
  it("reads the start position into 64 squares, a8 first", () => {
    const sq = parseFen(START)!;
    expect(sq).toHaveLength(64);
    expect(sq[0]).toBe("r");
    expect(sq[4]).toBe("k");
    expect(sq[60]).toBe("K");
    expect(sq[63]).toBe("R");
    expect(sq.slice(16, 48).every((p) => p === null)).toBe(true);
  });

  it("refuses what is not eight ranks of eight", () => {
    expect(parseFen(null)).toBeNull();
    expect(parseFen("8/8/8")).toBeNull();
    expect(parseFen("9/8/8/8/8/8/8/8")).toBeNull();
    expect(parseFen("rnbqkbnr/ppppxppp/8/8/8/8/PPPPPPPP/RNBQKBNR")).toBeNull();
    expect(parseFen("rnbqkbnr/ppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR")).toBeNull();
  });

  it("names squares and moves", () => {
    expect(squareIndex("a8")).toBe(0);
    expect(squareIndex("h1")).toBe(63);
    expect(squareIndex("e4")).toBe(36);
    expect(squareName(36)).toBe("e4");
    expect(moveSquares("e7e5")).toEqual([squareIndex("e7"), squareIndex("e5")]);
    expect(moveSquares("e7e8q")).toEqual([12, 4]);
    expect(moveSquares("Nf3")).toBeNull();
    expect(moveSquares(null)).toBeNull();
  });

  it("draws pieces as text glyphs, never as emoji", () => {
    expect(pieceGlyph("p")).toBe("♟︎");
    expect(pieceGlyph("K")).toBe("♚︎");
  });

  it("checks a typed position and says what is wrong", () => {
    expect(fenProblem(START)).toBeNull();
    expect(fenProblem("4k3/8/8/8/8/8/8/4K3")).toBeNull();
    expect(fenProblem("  ")).toBe("empty");
    expect(fenProblem("8/8/8/8/8/8/8/8")).toBe("kings");
    expect(fenProblem("4k3/8/8/8/8/8/8/4KK2")).toBe("kings");
    expect(fenProblem("4k2P/8/8/8/8/8/8/4K3")).toBe("pawns");
    expect(fenProblem("4k3/8/8/8/8/8/8/4K3 x")).toBe("side");
    expect(fenProblem("4k3/8/8/8/8/8/8/4K3 w KX")).toBe("castling");
    expect(fenProblem("4k3/8/8/8/8/8/8/4K3 w - e5")).toBe("en_passant");
    expect(fenProblem("4k3/8/8/8/8/8/8/4K3 w - - x 1")).toBe("counters");
    expect(fenProblem(`${START} extra`)).toBe("fields");
    expect(fenProblem("rnbqkbnr/pppp")).toBe("placement");
  });

  it("completes a bare placement to six fields", () => {
    expect(completeFen("4k3/8/8/8/8/8/8/4K3")).toBe("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    expect(completeFen(` ${START} `)).toBe(START);
  });
});

describe("the clocks", () => {
  const at = "2026-11-08T10:15:02Z";
  const base = Date.parse(at);
  const table = { white_ms: 300_000, black_ms: 200_000, running: "white" as const, clock_at: at };

  it("count the running one down from the report, and leave the other alone", () => {
    expect(clockNow(table, "white", base + 12_500)).toBe(287_500);
    expect(clockNow(table, "black", base + 12_500)).toBe(200_000);
  });

  it("never go below zero, nor up when the phone's clock is behind", () => {
    expect(clockNow(table, "white", base + 400_000)).toBe(0);
    expect(clockNow(table, "white", base - 5_000)).toBe(300_000);
  });

  it("stand still when nothing runs, and say nothing without a clock", () => {
    expect(clockNow({ ...table, running: "none" }, "white", base + 9_000)).toBe(300_000);
    expect(clockNow({ ...table, white_ms: null }, "white", base)).toBeNull();
  });

  it("read as a chess clock does", () => {
    expect(formatClock(5_371_000)).toBe("1:29:31");
    expect(formatClock(65_400)).toBe("1:05");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(null)).toBe("–");
  });
});

describe("a board's health and words", () => {
  it("is stale before anything else, then connected or lost", () => {
    expect(health({ connected: true, stale: true })).toBe("stale");
    expect(health({ connected: true, stale: false })).toBe("connected");
    expect(health({ connected: false, stale: false })).toBe("lost");
  });

  it("says how long ago", () => {
    const now = Date.parse("2026-11-08T10:20:00Z");
    expect(ago("2026-11-08T10:19:58Z", now)).toBe("just now");
    expect(ago("2026-11-08T10:19:30Z", now)).toBe("30 s ago");
    expect(ago("2026-11-08T10:15:00Z", now)).toBe("5 min ago");
    expect(ago("2026-11-08T07:20:00Z", now)).toBe("3 h ago");
    expect(ago(null, now)).toBeNull();
    expect(ago("garbage", now)).toBeNull();
  });

  it("names known states and alarms, and shows unknown ones as they came", () => {
    expect(stateLabel("guessed")).toBe("moves guessed");
    expect(stateLabel("levitating")).toBe("levitating");
    expect(stateTone("guessed")).toBe("bad");
    expect(stateTone("recovered")).toBe("warn");
    expect(stateTone("live")).toBe("ok");
    expect(stateTone("levitating")).toBe("plain");
    expect(alarmLabel("out_of_turn")).toBe("out of turn");
    expect(alarmLabel("cat_on_board")).toBe("cat_on_board");
  });

  it("groups guessed plies into runs", () => {
    expect(guessedRuns([24, 23, 9, 25, 9])).toEqual([
      [9, 9],
      [23, 25],
    ]);
    expect(guessedRuns([])).toEqual([]);
    expect(runName([23, 24])).toBe("12.–12…");
    expect(runName([9, 9])).toBe("5.");
  });
});

describe("what a command's state says", () => {
  const c = (state: string, error: string | null = null, detail: string | null = null, kind = "flip") => ({ state, error, detail, kind });

  it("has a sentence for every state", () => {
    expect(commandStateText(c("pending"))).toBe("Waiting for the box to pick it up.");
    expect(commandStateText(c("sent"))).toBe("The box has it.");
    expect(commandStateText(c("done"))).toBe("Done.");
    expect(commandStateText(c("done", null, null, "accept_result"))).toBe("Entered as the result.");
    expect(commandStateText(c("expired"))).toBe("The box never picked it up. Is it online?");
  });

  it("turns the box's error into a sentence, its detail after it", () => {
    expect(commandStateText(c("failed", "not_last", "the guessed moves are not the last ones"))).toBe(
      "Failed: the guessed moves are not the last ones, so they cannot be taken back (the guessed moves are not the last ones)",
    );
    expect(boxErrorText("wrong_game", null)).toBe("the board plays another game now");
    expect(boxErrorText("gremlins", null)).toBe("the box said gremlins");
  });

  it("explains the server's refusals", () => {
    expect(liveErrorText(new ApiError(409, "no_board_result", "x"))).toBe("The board has not seen a result for this game.");
    expect(liveErrorText(new ApiError(409, "result_entered", "x"))).toMatch(/already has a result/);
    expect(liveErrorText(new ApiError(429, "rate_limited", "Slow down."))).toBeNull();
    expect(liveErrorText(new ApiError(404, "board_not_found", "x"))).toMatch(/no longer has this board/);
    expect(liveErrorText(new ApiError(422, "invalid_command", "x", { detail: "plies must be 1..20" }))).toBe("The server refused the command. (plies must be 1..20)");
    expect(liveErrorText(new ApiError(500, "boom", "x"))).toBeNull();
    expect(liveErrorText(new Error("x"))).toBeNull();
  });
});

describe("the API calls", () => {
  function fake(body: unknown, status = 200) {
    const seen: { url: string; method: string; body: unknown }[] = [];
    const f: FetchLike = async (url, init = {}) => {
      seen.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body as string) : undefined });
      return new Response(JSON.stringify(body), { status });
    };
    return { f, seen };
  }
  const cmd = { id: 41, kind: "flip", link_id: 4, board: 12, game: "g1", args: { flipped: true }, state: "pending" };

  it("reads the live boards and a game's moves", async () => {
    const { f, seen } = fake({ poll_seconds: 5, round: 3, boxes: [], tables: [], commands: [] });
    const c = client("https://p.example", "tok", f);
    expect((await c.liveBoards(7)).poll_seconds).toBe(5);
    await c.liveGame(7, "a/b");
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "GET https://p.example/api/manubrium/v1/tournaments/7/live-boards",
      "GET https://p.example/api/manubrium/v1/tournaments/7/live-boards/games/a%2Fb",
    ]);
  });

  it("sends a command and unwraps the command object", async () => {
    const { f, seen } = fake({ command: cmd }, 201);
    const c = client("https://p.example", "tok", f);
    const got = await c.sendBoardCommand(7, { kind: "flip", link_id: 4, board: 12, game: "g1", args: { flipped: true } });
    expect(got).toEqual(cmd);
    expect(seen[0]).toMatchObject({ method: "POST", url: "https://p.example/api/manubrium/v1/tournaments/7/live-boards/commands", body: { kind: "flip", link_id: 4 } });
    expect(await c.boardCommand(7, 41)).toEqual(cmd);
    expect(seen[1].url).toBe("https://p.example/api/manubrium/v1/tournaments/7/live-boards/commands/41");
  });

  it("hears a 409 as an ApiError with its code", async () => {
    const { f } = fake({ error: "result_entered", message: "The pairing already has a result." }, 409);
    const error = await client("https://p.example", "tok", f).sendBoardCommand(7, { kind: "accept_result", game: "g1" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "result_entered" });
  });
});

describe("polling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function foreground() {
    let listener: ((active: boolean) => void) | null = null;
    const f: Foreground = (cb) => {
      listener = cb;
      return () => {
        listener = null;
      };
    };
    return { f, set: (a: boolean) => listener?.(a), listening: () => listener !== null };
  }

  it("asks at once, then every poll_seconds the server names", async () => {
    const tick = vi.fn(async () => 3);
    const fg = foreground();
    const p = poll(tick, 5, fg.f);
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("pauses in the background and asks at once on return", async () => {
    const tick = vi.fn(async () => 5);
    const fg = foreground();
    const p = poll(tick, 5, fg.f);
    await vi.advanceTimersByTimeAsync(0);
    fg.set(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(1);
    fg.set(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("stops for good when the screen is left", async () => {
    const tick = vi.fn(async () => 5);
    const fg = foreground();
    const p = poll(tick, 5, fg.f);
    await vi.advanceTimersByTimeAsync(0);
    p.stop();
    expect(fg.listening()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("carries on after a failed tick", async () => {
    const tick = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(5);
    const p = poll(tick, 5, foreground().f);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tick).toHaveBeenCalledTimes(2);
    p.stop();
  });
});
