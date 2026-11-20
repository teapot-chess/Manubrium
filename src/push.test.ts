import { describe, expect, it, vi } from "vitest";
import { PUSH_EVENTS, type Client, type PushStatus, type Round } from "./api";
import { activityKey, LiveActivities, parseKey, plan, progress, stateOf, type Phase, type RoundActivityPlugin } from "./liveActivity";
import { ASKED_KEY, lockScreenOn, PushManager, serverCanPush, shouldOffer, tapTarget, TOKEN_KEY, withEvent, type PushBackend } from "./push";
import type { KeyValue } from "./queue";
import type { SavedServer } from "./servers";

class Memory implements KeyValue {
  data = new Map<string, string>();
  async get(k: string) {
    return this.data.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.data.set(k, v);
  }
}

const status = (over: Partial<PushStatus> = {}): PushStatus => ({
  available: true,
  platforms: { apns: true, fcm: false },
  events: [...PUSH_EVENTS],
  registration: null,
  ...over,
});

const server = (base: string): SavedServer => ({
  base,
  token: "mnb_x",
  label: base,
  user: { email: "a@b.c", name: null },
  info: { name: "x", version: "1", api: 1, desktop: false },
  deviceId: 1,
  addedAt: "2026-11-08T10:00:00Z",
});

function backend(over: Partial<PushBackend> = {}): PushBackend {
  return {
    platform: "apns",
    environment: async () => "sandbox",
    check: async () => "prompt",
    request: async () => "granted",
    token: async () => "a1b2c3d4e5f60718",
    onTap: () => undefined,
    ...over,
  };
}

describe("when to offer notifications", () => {
  it("offers once, on a server that can push to this phone, before the phone was asked", () => {
    expect(shouldOffer({ platform: "apns", permission: "prompt", asked: false, status: status() })).toBe(true);
    expect(shouldOffer({ platform: "apns", permission: "prompt", asked: true, status: status() })).toBe(false);
    expect(shouldOffer({ platform: "apns", permission: "granted", asked: false, status: status() })).toBe(false);
    expect(shouldOffer({ platform: "fcm", permission: "prompt", asked: false, status: status() })).toBe(false);
    expect(shouldOffer({ platform: null, permission: "prompt", asked: false, status: status() })).toBe(false);
    expect(shouldOffer({ platform: "apns", permission: "prompt", asked: false, status: status({ available: false }) })).toBe(false);
    expect(serverCanPush(null, "apns")).toBe(false);
  });
});

describe("the event switches", () => {
  it("keep the server's order and change only the one touched", () => {
    expect(withEvent(PUSH_EVENTS, ["incident", "round_paired"], "coarbiter_result", true)).toEqual(["round_paired", "incident", "coarbiter_result"]);
    expect(withEvent(PUSH_EVENTS, ["round_paired", "incident"], "incident", false)).toEqual(["round_paired"]);
  });
});

describe("a tapped notification", () => {
  const servers = [server("https://pairings.cloud"), server("https://club.example")];

  it("opens the tournament on the server it came from", () => {
    expect(tapTarget({ tag: "https://club.example", tournament: "12", kind: "incident" }, servers)).toEqual({ base: "https://club.example", tournament: 12 });
  });

  it("goes nowhere for a server this phone no longer has, or without a tournament", () => {
    expect(tapTarget({ tag: "https://gone.example", tournament: "12" }, servers)).toBeNull();
    expect(tapTarget({ tag: "https://club.example" }, servers)).toBeNull();
    expect(tapTarget({ tournament: "12" }, servers)).toBeNull();
    expect(tapTarget({ tournament: "12" }, [servers[0]])).toEqual({ base: "https://pairings.cloud", tournament: 12 });
  });
});

describe("PushManager", () => {
  const apiFor = (calls: unknown[], st: PushStatus | Error = status()) =>
    vi.fn(
      () =>
        ({
          pushStatus: async () => {
            if (st instanceof Error) throw st;
            return st;
          },
          registerPush: async (p: unknown) => {
            calls.push(p);
            return status({ registration: { platform: "apns", environment: "sandbox", events: ["incident"], tag: "x" } });
          },
        }) as unknown as Client,
    );

  it("asks, then registers the token with every server that can push, tagged with the server", async () => {
    const calls: unknown[] = [];
    const store = new Memory();
    const m = new PushManager(backend({ check: async () => "granted" }), store, apiFor(calls));
    expect(await m.enable([server("https://a.example"), server("https://b.example")])).toBe("granted");
    expect(calls).toEqual([
      { platform: "apns", token: "a1b2c3d4e5f60718", environment: "sandbox", tag: "https://a.example" },
      { platform: "apns", token: "a1b2c3d4e5f60718", environment: "sandbox", tag: "https://b.example" },
    ]);
    expect(store.data.get(TOKEN_KEY)).toBe("a1b2c3d4e5f60718");
    expect(await m.asked()).toBe(true);
  });

  it("registers nothing when the phone says no, or the server has no keys", async () => {
    const calls: unknown[] = [];
    const no = new PushManager(backend({ request: async () => "denied" }), new Memory(), apiFor(calls));
    expect(await no.enable([server("https://a.example")])).toBe("denied");
    const off = new PushManager(backend({ check: async () => "granted" }), new Memory(), apiFor(calls, status({ available: false })));
    await off.refresh([server("https://a.example")]);
    const offline = new PushManager(backend({ check: async () => "granted" }), new Memory(), apiFor(calls, new Error("offline")));
    await offline.refresh([server("https://a.example")]);
    expect(calls).toEqual([]);
  });

  it("does nothing at all in a build that cannot push", async () => {
    const request = vi.fn(async () => "granted" as const);
    const m = new PushManager(backend({ platform: null, request }), new Memory(), apiFor([]));
    expect(await m.permission()).toBe("denied");
    expect(await m.enable([server("https://a.example")])).toBe("denied");
    expect(request).not.toHaveBeenCalled();
  });

  it("'Not now' is remembered", async () => {
    const store = new Memory();
    const m = new PushManager(backend(), store, apiFor([]));
    expect(await m.asked()).toBe(false);
    await m.decline();
    expect(store.data.get(ASKED_KEY)).toBe("no");
    expect(await m.asked()).toBe(true);
  });

  it("sends a server the events chosen, with the token it has", async () => {
    const calls: unknown[] = [];
    const store = new Memory();
    const m = new PushManager(backend(), store, apiFor(calls));
    expect(await m.setEvents(server("https://a.example"), ["incident"])).toBeNull();
    await store.set(TOKEN_KEY, "a1b2c3d4e5f60718");
    await m.setEvents(server("https://a.example"), ["incident"]);
    expect(calls).toEqual([{ platform: "apns", token: "a1b2c3d4e5f60718", environment: "sandbox", events: ["incident"], tag: "https://a.example" }]);
  });

  it("keeps the lock-screen switch, on by default", async () => {
    const m = new PushManager(backend(), new Memory(), apiFor([]));
    expect(await m.liveActivities()).toBe(true);
    await m.setLiveActivities(false);
    expect(await m.liveActivities()).toBe(false);
  });
});

// ---------------------------------------------------------------------------

const player = (id: number) => ({ id, name: `P${id}`, title: null, rating: null, score: 0 });
const board = (id: number, result: string, over: object = {}) => ({
  id,
  board: id,
  label: String(id),
  white: player(id * 2),
  black: player(id * 2 + 1),
  bye: false,
  result,
  clearable: false,
  ...over,
});
const round = (n: number, results: string[], over: Partial<Round> = {}): Round => ({
  number: n,
  latest: true,
  publish_level: 0,
  boards: results.map((r, i) => board(i + 1, r)),
  byes: [],
  results: [],
  ...over,
});

describe("the round's progress", () => {
  it("counts games, not byes or empty seats", () => {
    const r = round(5, ["1-0", "", "0-1"]);
    r.boards.push(board(4, "", { black: null, bye: true }), board(5, "", { black: null, vacant: true }));
    expect(progress(r)).toEqual({ done: 2, total: 3 });
  });

  it("follows the tournament: a complete round stays, the next one moves it on, the end ends it", () => {
    const at = (round: number, done: number, total: number, phase: Phase = done === 0 ? "paired" : done >= total ? "complete" : "playing") => ({ round, done, total, phase });
    expect(plan(round(5, ["", ""]), undefined, false)).toBe("start");
    expect(plan(round(5, ["1-0", ""]), at(5, 0, 2), false)).toBe("update");
    expect(plan(round(5, ["1-0", ""]), at(5, 1, 2), false)).toBe("none");
    expect(plan(round(5, ["1-0", "0-1"]), at(5, 1, 2), false)).toBe("update");
    expect(plan(round(5, ["1-0", "0-1"]), at(5, 2, 2), false)).toBe("none");
    expect(plan(round(5, ["1-0", "0-1"]), undefined, false)).toBe("start");
    expect(plan(round(6, ["", ""]), at(5, 2, 2), false)).toBe("update");
    expect(plan(round(5, ["", ""]), at(6, 0, 2), false)).toBe("none");
    expect(plan(round(4, ["", ""], { latest: false }), undefined, false)).toBe("none");
    expect(plan(round(7, ["1-0", "0-1"]), at(7, 2, 2), true)).toBe("end");
    expect(plan(round(7, ["1-0", "0-1"]), undefined, true)).toBe("none");
  });

  it("names the phase, and reads a key back", () => {
    expect(stateOf(round(3, ["", ""]), false)).toEqual({ round: 3, done: 0, total: 2, phase: "paired" });
    expect(stateOf(round(3, ["1-0", ""]), false).phase).toBe("playing");
    expect(stateOf(round(3, ["1-0", "½-½"]), false).phase).toBe("complete");
    expect(stateOf(round(3, ["1-0", "½-½"]), true).phase).toBe("finished");
    expect(parseKey(activityKey("https://pairings.cloud", 7))).toEqual({ base: "https://pairings.cloud", tournament: 7 });
    expect(parseKey("nonsense")).toBeNull();
  });
});

describe("LiveActivities", () => {
  const STRINGS = { title: "Round {n}", format: "{done} of {total} results", complete: "All results in" };
  const BASE = "https://pairings.cloud";

  function fakePlugin(supported = true) {
    const calls: [string, unknown][] = [];
    const handlers: Record<string, (e: never) => void> = {};
    const plugin = {
      info: async () => ({ supported, enabled: true, pushToStart: true, environment: "production" as const }),
      start: async (o: unknown) => void calls.push(["start", o]),
      update: async (o: unknown) => void calls.push(["update", o]),
      end: async (o: unknown) => void calls.push(["end", o]),
      addListener: async (e: string, h: (e: never) => void) => {
        handlers[e] = h;
        return { remove: async () => undefined };
      },
    } as unknown as RoundActivityPlugin;
    return {
      plugin,
      calls,
      token: (key: string, token: string, round?: number) => handlers.pushToken?.({ key, token, round } as never),
      startToken: (token: string) => handlers.startToken?.({ token } as never),
    };
  }

  const api = (over: Partial<PushStatus> = {}) => {
    const sent: unknown[] = [];
    const deleted: number[] = [];
    const starts: unknown[] = [];
    return {
      sent,
      deleted,
      starts,
      api: {
        putLiveActivity: async (id: number, a: unknown) => void sent.push([id, a]),
        deleteLiveActivity: async (id: number) => void deleted.push(id),
        pushStatus: async () => status(over),
        putLiveActivityStart: async (s: unknown) => void starts.push(s),
        deleteLiveActivityStart: async () => void starts.push("deleted"),
      } as unknown as Client,
    };
  };

  const sync = (l: LiveActivities, a: Client, r: Round, on = true, finished = false) =>
    l.sync({ base: BASE, api: a, tournament: 7, name: "Hall Open", round: r, finished, strings: STRINGS, on });

  it("starts once, keeps it across rounds, hands the token over, and ends with the tournament", async () => {
    const { plugin, calls, token } = fakePlugin();
    const { api: a, sent, deleted } = api();
    const l = new LiveActivities(plugin);
    await sync(l, a, round(5, ["", "1-0"]));
    expect(calls[0]).toEqual([
      "start",
      { key: activityKey(BASE, 7), tournament: "Hall Open", round: 5, done: 1, total: 2, phase: "playing", title: "Round 5", format: "{done} of {total} results", roundTitle: "Round {n}", complete: "All results in" },
    ]);
    await token(`${BASE}#7`, "80f1a2b3c4d5e6f7", 5);
    await vi.waitFor(() => expect(sent).toEqual([[7, { round: 5, token: "80f1a2b3c4d5e6f7", environment: "production", follows: "tournament" }]]));
    await sync(l, a, round(5, ["1-0", "1-0"]));
    expect(calls[1]).toEqual(["update", { key: `${BASE}#7`, round: 5, done: 2, total: 2, phase: "complete" }]);
    await sync(l, a, round(6, ["", ""]));
    expect(calls[2]).toEqual(["update", { key: `${BASE}#7`, round: 6, done: 0, total: 2, phase: "paired" }]);
    expect(deleted).toEqual([]);
    await sync(l, a, round(6, ["1-0", "0-1"]), true, true);
    expect(calls[3]).toEqual(["end", { key: `${BASE}#7`, round: 6, done: 2, total: 2, phase: "finished" }]);
    expect(deleted).toEqual([7]);
  });

  it("ends the activity when switched off, and does nothing where unsupported", async () => {
    const one = fakePlugin();
    const { api: a, deleted } = api();
    const l = new LiveActivities(one.plugin);
    await sync(l, a, round(5, ["", ""]));
    await sync(l, a, round(5, ["", ""]), false);
    expect(one.calls.map(([k]) => k)).toEqual(["start", "end"]);
    expect(deleted).toEqual([7]);

    // Off from the start: whatever is left from before goes, once.
    const fresh = fakePlugin();
    const l2 = new LiveActivities(fresh.plugin);
    await sync(l2, a, round(5, ["", ""]), false);
    await sync(l2, a, round(5, ["", ""]), false);
    expect(fresh.calls.map(([k]) => k)).toEqual(["end"]);

    const none = fakePlugin(false);
    await sync(new LiveActivities(none.plugin), a, round(5, ["", ""]));
    expect(none.calls).toEqual([]);
  });

  it("sends the token of one the server started to the server it names", async () => {
    const { plugin, token } = fakePlugin();
    const { api: a, sent } = api();
    const l = new LiveActivities(plugin);
    const server = { base: BASE, token: "mnb_x", label: "Cloud" } as unknown as SavedServer;
    await l.connect({ servers: [server], api: () => a, on: true, strings: STRINGS });
    await token(`${BASE}#9`, "aa11bb22cc33dd44", 3);
    await token("https://elsewhere.example#9", "ee55ff66aa77bb88", 3);
    await vi.waitFor(() => expect(sent).toEqual([[9, { round: 3, token: "aa11bb22cc33dd44", environment: "production", follows: "tournament" }]]));
  });

  it("gives the push-to-start token to servers that can push, and takes it back when switched off", async () => {
    const { plugin, startToken } = fakePlugin();
    const pushing = api();
    const silent = api({ available: false });
    const l = new LiveActivities(plugin);
    const servers = [{ base: BASE }, { base: "https://club.example" }] as unknown as SavedServer[];
    const apiFor = (s: SavedServer) => (s.base === BASE ? pushing.api : silent.api);
    await l.connect({ servers, api: apiFor, on: true, strings: STRINGS });
    await startToken("5a5a5a5a5a5a5a5a");
    await vi.waitFor(() => expect(pushing.starts).toEqual([{ token: "5a5a5a5a5a5a5a5a", environment: "production", tag: BASE, ...STRINGS }]));
    expect(silent.starts).toEqual([]);

    await l.connect({ servers, api: apiFor, on: false, strings: STRINGS });
    expect(pushing.starts.at(-1)).toBe("deleted");
    expect(silent.starts).toEqual(["deleted"]);
  });
});

describe("lockScreenOn", () => {
  it("keeps the round off the lock screen where the server cannot push", () => {
    expect(lockScreenOn(true, null, "apns")).toBeNull();
    expect(lockScreenOn(true, status({ available: false }), "apns")).toBe(false);
    expect(lockScreenOn(true, status(), "apns")).toBe(true);
    expect(lockScreenOn(false, status(), "apns")).toBe(false);
  });
});
