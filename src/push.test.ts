import { describe, expect, it, vi } from "vitest";
import { PUSH_EVENTS, type Client, type PushStatus, type Round } from "./api";
import { activityKey, LiveActivities, plan, progress, type RoundActivityPlugin } from "./liveActivity";
import { ASKED_KEY, PushManager, serverCanPush, shouldOffer, tapTarget, TOKEN_KEY, withEvent, type PushBackend } from "./push";
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

  it("starts, updates and ends the activity as results come in", () => {
    expect(plan(round(5, ["", ""]), undefined)).toBe("start");
    expect(plan(round(5, ["1-0", ""]), { round: 5, done: 0, total: 2 })).toBe("update");
    expect(plan(round(5, ["1-0", ""]), { round: 5, done: 1, total: 2 })).toBe("none");
    expect(plan(round(5, ["1-0", "0-1"]), { round: 5, done: 1, total: 2 })).toBe("end");
    expect(plan(round(5, ["1-0", "0-1"]), undefined)).toBe("none");
    expect(plan(round(6, ["", ""]), { round: 5, done: 1, total: 2 })).toBe("start");
    expect(plan(round(4, ["", ""], { latest: false }), undefined)).toBe("none");
  });
});

describe("LiveActivities", () => {
  function fakePlugin(supported = true) {
    const calls: [string, unknown][] = [];
    let tokenHandler: ((e: { key: string; token: string }) => void) | null = null;
    const plugin: RoundActivityPlugin = {
      info: async () => ({ supported, enabled: true, environment: "production" }),
      start: async (o) => void calls.push(["start", o]),
      update: async (o) => void calls.push(["update", o]),
      end: async (o) => void calls.push(["end", o]),
      addListener: async (_e, h) => {
        tokenHandler = h;
        return { remove: async () => undefined };
      },
    };
    return { plugin, calls, token: (key: string, token: string) => tokenHandler?.({ key, token }) };
  }

  const api = () => {
    const sent: unknown[] = [];
    const deleted: number[] = [];
    return {
      sent,
      deleted,
      api: {
        putLiveActivity: async (id: number, a: unknown) => void sent.push([id, a]),
        deleteLiveActivity: async (id: number) => void deleted.push(id),
      } as unknown as Client,
    };
  };

  const sync = (l: LiveActivities, a: Client, r: Round, on = true) =>
    l.sync({ base: "https://pairings.cloud", api: a, tournament: 7, name: "Hall Open", round: r, title: `Round ${r.number}`, format: "{done} of {total} results", on });

  it("starts with the round, hands the token to the server, and ends with the last result", async () => {
    const { plugin, calls, token } = fakePlugin();
    const { api: a, sent, deleted } = api();
    const l = new LiveActivities(plugin);
    await sync(l, a, round(5, ["", "1-0"]));
    expect(calls[0]).toEqual(["start", { key: activityKey("https://pairings.cloud", 7), tournament: "Hall Open", round: 5, title: "Round 5", format: "{done} of {total} results", done: 1, total: 2 }]);
    await token("https://pairings.cloud#7", "80f1a2b3c4d5e6f7");
    await vi.waitFor(() => expect(sent).toEqual([[7, { round: 5, token: "80f1a2b3c4d5e6f7", environment: "production" }]]));
    await sync(l, a, round(5, ["1-0", "1-0"]));
    expect(calls[1]).toEqual(["end", { key: "https://pairings.cloud#7", done: 2, total: 2 }]);
    expect(deleted).toEqual([7]);
  });

  it("ends the activity when switched off, and does nothing where unsupported", async () => {
    const one = fakePlugin();
    const { api: a } = api();
    const l = new LiveActivities(one.plugin);
    await sync(l, a, round(5, ["", ""]));
    await sync(l, a, round(5, ["", ""]), false);
    expect(one.calls.map(([k]) => k)).toEqual(["start", "end"]);

    const none = fakePlugin(false);
    await sync(new LiveActivities(none.plugin), a, round(5, ["", ""]));
    expect(none.calls).toEqual([]);
  });
});
