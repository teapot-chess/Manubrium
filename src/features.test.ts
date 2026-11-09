// @vitest-environment happy-dom
//
// 1.2's logic without a screen: themes, the app lock, the default-time
// list and clock, the scan codes and a player's colour history.

import { describe, expect, it } from "vitest";
import type { Board, PlayerCard, Round } from "./api";
import type { KeyValue } from "./queue";
import { applyTheme, DEFAULT_THEME, loadTheme, palette, saveTheme, THEME_KEY, THEMES, TOKENS } from "./themes";
import { checkCode, loadLock, loadThrottle, missed, saveThrottle, LOCK_MISSES_KEY, LOCK_OFF, lockOnReturn, saveLock, storeCode, validCode, waitAfter, LOCK_CODE_KEY } from "./lock";
import {
  DEFAULT_MINUTES,
  forfeitChoices,
  forfeitFor,
  formatLeft,
  loadDefaultTime,
  notificationId,
  parseMinutes,
  remaining,
  saveDefaultTime,
  startAt,
  started,
  waitingBoards,
} from "./defaultTime";
import { boardOf, parseScan } from "./scan";
import { colourHistory } from "./ui/PlayerSheet";
import { loadPhoneSettings, PHONE_DEFAULTS, savePhoneSettings } from "./phoneSettings";

class Memory implements KeyValue {
  data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
  }
}

const p = (id: number) => ({ id, name: `P${id}`, title: null, rating: null, score: 0 });

function board(id: number, extra: Partial<Board> = {}): Board {
  return {
    id,
    board: id,
    label: String(id),
    white: p(id * 10 + 1),
    black: p(id * 10 + 2),
    bye: false,
    vacant: false,
    empty: false,
    result: "",
    clearable: false,
    phone: null,
    ...extra,
  };
}

const CODES = ["1-0", "1/2-1/2", "0-1", "1-0FF", "0-1FF", "0-0FF"];

function round(boards: Board[]): Round {
  return { number: 2, latest: true, publish_level: 1, boards, byes: [], pool: [], hand_edits: { open: false, pibe: null }, results: CODES };
}

describe("themes", () => {
  it("defaults to Slate, which is not the old green", () => {
    expect(DEFAULT_THEME).toBe("slate");
    expect(palette("slate", false).accent).not.toBe(palette("classic", false).accent);
  });

  it("has every token in both halves of every theme", () => {
    for (const id of THEMES) for (const dark of [false, true]) for (const token of TOKENS) expect(palette(id, dark)[token], `${id} ${dark} ${token}`).toBeTruthy();
  });

  it("sets the tokens, the colour scheme and the bar colour on the page", () => {
    document.head.innerHTML = '<meta name="theme-color" content="#000">';
    const root = document.documentElement;
    applyTheme("paper", true, root);
    expect(root.style.getPropertyValue("--accent")).toBe(palette("paper", true).accent);
    expect(root.style.getPropertyValue("color-scheme")).toBe("dark");
    expect(root.dataset.theme).toBe("paper");
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute("content")).toBe(palette("paper", true).bg);
  });

  it("remembers the choice, and treats an unknown one as the default", async () => {
    const store = new Memory();
    expect(await loadTheme(store)).toBe("slate");
    await saveTheme(store, "board");
    expect(await loadTheme(store)).toBe("board");
    store.data.set(THEME_KEY, "neon");
    expect(await loadTheme(store)).toBe("slate");
  });
});

describe("the app lock", () => {
  it("is off until switched on, and reads back what was saved", async () => {
    const store = new Memory();
    expect(await loadLock(store)).toEqual(LOCK_OFF);
    await saveLock(store, { enabled: true, after: 15 });
    expect(await loadLock(store)).toEqual({ enabled: true, after: 15 });
    store.data.set("manubrium.lock.v1", JSON.stringify({ enabled: true, after: 7 }));
    expect((await loadLock(store)).after).toBe(LOCK_OFF.after);
    store.data.set("manubrium.lock.v1", "{");
    expect(await loadLock(store)).toEqual(LOCK_OFF);
  });

  it("locks on return only after the chosen time away", () => {
    const on = { enabled: true, after: 5 };
    expect(lockOnReturn(on, null, 1_000_000)).toBe(false);
    expect(lockOnReturn(on, 0, 4 * 60_000)).toBe(false);
    expect(lockOnReturn(on, 0, 5 * 60_000)).toBe(true);
    expect(lockOnReturn({ enabled: true, after: 0 }, 10, 10)).toBe(true);
    expect(lockOnReturn({ enabled: false, after: 0 }, 0, 99 * 60_000)).toBe(false);
  });

  it("takes 4 to 8 digits as a code", () => {
    expect(validCode("1234")).toBe(true);
    expect(validCode("12345678")).toBe(true);
    expect(validCode("123")).toBe(false);
    expect(validCode("123456789")).toBe(false);
    expect(validCode("12a4")).toBe(false);
  });

  it("keeps only a salted hash of the code, and checks against it", async () => {
    const vault = new Memory();
    expect(await checkCode(vault, "1234")).toBe(false);
    await storeCode(vault, "2468");
    const stored = vault.data.get(LOCK_CODE_KEY)!;
    expect(stored).not.toContain("2468");
    expect(stored).toMatch(/^[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(await checkCode(vault, "2468")).toBe(true);
    expect(await checkCode(vault, "2469")).toBe(false);
    const again = new Memory();
    await storeCode(again, "2468");
    expect(again.data.get(LOCK_CODE_KEY)).not.toBe(stored);
  });

  it("makes guessing slow after five misses, up to a ceiling", () => {
    expect(waitAfter(4)).toBe(0);
    expect(waitAfter(5)).toBe(30_000);
    expect(waitAfter(6)).toBe(60_000);
    expect(waitAfter(30)).toBe(15 * 60_000);
  });

  it("remembers the misses across a restart, so a force quit buys no fresh tries", async () => {
    const store = new Memory();
    let t = { misses: 0, blockedUntil: 0 };
    for (let i = 0; i < 5; i++) t = missed(t, 1_000_000);
    expect(t).toEqual({ misses: 5, blockedUntil: 1_030_000 });
    await saveThrottle(store, t);
    expect(await loadThrottle(store)).toEqual(t);
    store.data.set(LOCK_MISSES_KEY, "not json");
    expect(await loadThrottle(store)).toEqual({ misses: 0, blockedUntil: 0 });
  });
});

describe("the default time", () => {
  it("lists the boards with a player not checked in, or a hall board still set up", () => {
    const r = round([
      board(1),
      board(2),
      board(3, { result: "1-0" }),
      board(4, { board_report: { status: "waiting" } as Board["board_report"] }),
      board(5, { board_report: { status: "live", moves_count: 3 } as Board["board_report"] }),
      board(6, { bye: true, black: null }),
      board(7),
    ]);
    const present = new Map([
      [21, false],
      [31, false],
      [72, false],
    ]);
    const list = waitingBoards(r, present, new Set([7]));
    expect(list.map((w) => [w.board.id, w.missing])).toEqual([
      [2, ["white"]],
      [4, []],
    ]);
    expect(waitingBoards(r, null).map((w) => w.board.id)).toEqual([4]);
  });

  it("knows a game has begun from a result or the hall board", () => {
    expect(started(board(1))).toBe(false);
    expect(started(board(1, { result: "0-1" }))).toBe(true);
    expect(started(board(1, { board_report: { status: "waiting", moves_count: 1 } as Board["board_report"] }))).toBe(true);
    expect(started(board(1, { board_report: { status: "finished" } as Board["board_report"] }))).toBe(true);
  });

  it("gives the absent side the loss, when the server takes the code", () => {
    expect(forfeitFor(["white"], CODES)).toBe("0-1FF");
    expect(forfeitFor(["black"], CODES)).toBe("1-0FF");
    expect(forfeitFor(["white", "black"], CODES)).toBe("0-0FF");
    expect(forfeitFor([], CODES)).toBeNull();
    expect(forfeitFor(["white"], ["1-0", "0-1"])).toBeNull();
    expect(forfeitChoices(["1-0", "0-1FF"])).toEqual(["0-1FF"]);
  });

  it("counts down to the second and stops at zero", () => {
    const clock = { start: 0, minutes: 30 };
    expect(remaining(clock, 0)).toBe(30 * 60_000);
    expect(remaining(clock, 31 * 60_000)).toBe(0);
    expect(formatLeft(65_000)).toBe("1:05");
    expect(formatLeft(3_725_000)).toBe("1:02:05");
    expect(formatLeft(400)).toBe("0:01");
  });

  it("reads minutes and a start time as typed", () => {
    expect(parseMinutes(" 15 ")).toBe(15);
    expect(parseMinutes("0")).toBe(0);
    expect(parseMinutes("241")).toBeNull();
    expect(parseMinutes("1.5")).toBeNull();
    const now = new Date(2026, 10, 8, 14, 30).getTime();
    expect(startAt("14:00", now)).toBe(new Date(2026, 10, 8, 14, 0).getTime());
    expect(startAt("23:50", now)).toBe(new Date(2026, 10, 7, 23, 50).getTime());
    expect(startAt("25:00", now)).toBeNull();
    expect(startAt("noon", now)).toBeNull();
  });

  it("remembers the minutes per tournament and the clock per round", async () => {
    const store = new Memory();
    const base = "https://pairings.example";
    expect(await loadDefaultTime(store, base, 7, 2)).toEqual({ minutes: DEFAULT_MINUTES, clock: null, cleared: [] });
    await saveDefaultTime(store, base, 7, 2, { minutes: 15, clock: { start: 1000, minutes: 15 }, cleared: [4] });
    expect(await loadDefaultTime(store, base, 7, 2)).toEqual({ minutes: 15, clock: { start: 1000, minutes: 15 }, cleared: [4] });
    expect(await loadDefaultTime(store, base, 7, 3)).toEqual({ minutes: 15, clock: null, cleared: [] });
    expect(await loadDefaultTime(store, base, 8, 2)).toEqual({ minutes: DEFAULT_MINUTES, clock: null, cleared: [] });
  });

  it("gives each round its own notification id, within Android's range", () => {
    const a = notificationId("https://x", 1, 1);
    expect(a).toBe(notificationId("https://x", 1, 1));
    expect(a).not.toBe(notificationId("https://x", 1, 2));
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(2 ** 31);
  });

  it("keeps the reminder off until asked", async () => {
    const store = new Memory();
    expect(await loadPhoneSettings(store)).toEqual(PHONE_DEFAULTS);
    await savePhoneSettings(store, { remindDefaultTime: true });
    expect((await loadPhoneSettings(store)).remindDefaultTime).toBe(true);
  });
});

describe("scan codes", () => {
  it("reads a result slip and a place card, in either case", () => {
    expect(parseScan("OP1:B:7:3:1042")).toEqual({ kind: "board", tournament: 7, round: 3, pairing: 1042 });
    expect(parseScan(" op1:p:7:55 ")).toEqual({ kind: "player", tournament: 7, player: 55 });
  });

  it("refuses anything else", () => {
    for (const text of [null, "", "https://pairings.example", "OP1:B:7:3", "OP2:B:7:3:1", "OP1:X:7:1", "manubrium://connect?x=1"]) expect(parseScan(text)).toBeNull();
  });

  it("finds a player's board, not their bye", () => {
    const r = round([board(1), board(2, { bye: true, black: null })]);
    expect(boardOf(r, 12)?.id).toBe(1);
    expect(boardOf(r, 21)).toBeNull();
    expect(boardOf(r, 99)).toBeNull();
  });
});

describe("a player's colours", () => {
  it("reads by round, with a dash for a round without a game", () => {
    const card: PlayerCard = {
      player: { id: 1, name: "A" } as PlayerCard["player"],
      rank: 1,
      score: 2,
      games: [
        { round: 1, opponent: null, colour: "w", result: "1" },
        { round: 2, opponent: null, colour: null, result: "1 bye" },
        { round: 4, opponent: null, colour: "b", result: "0" },
      ],
    };
    expect(colourHistory(card)).toBe("W--B");
    expect(colourHistory({ ...card, games: [] })).toBe("");
  });
});
