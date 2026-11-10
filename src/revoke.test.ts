import { describe, expect, it } from "vitest";
import { ApiError, OfflineError } from "./api";
import type { KeyValue } from "./queue";
import { PendingRevokes, REVOKE_GIVE_UP_MS } from "./revoke";

class Memory implements KeyValue {
  data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
  }
}

function fake(script: { signOut?: () => Promise<void>; unregisterPush?: () => Promise<void> }) {
  const calls: string[] = [];
  const make = () => ({
    unregisterPush: async () => {
      calls.push("unregisterPush");
      await (script.unregisterPush ?? (async () => undefined))();
    },
    signOut: async () => {
      calls.push("signOut");
      await (script.signOut ?? (async () => undefined))();
    },
  });
  return { calls, make };
}

const S = "https://pairings.example";

describe("PendingRevokes", () => {
  it("keeps a revoke the server could not hear, and drops it once it can", async () => {
    const store = new Memory();
    let online = false;
    const f = fake({
      signOut: async () => {
        if (!online) throw new OfflineError();
      },
      unregisterPush: async () => {
        if (!online) throw new OfflineError();
      },
    });
    const pending = new PendingRevokes(store, f.make);
    await pending.add(S, "tok", "pairings.example");
    expect(await pending.retry()).toBe(1);
    expect(await pending.list()).toHaveLength(1);
    online = true;
    expect(await pending.retry()).toBe(0);
    expect(await pending.list()).toHaveLength(0);
    // Push registration goes first, then the sign-out.
    expect(f.calls.slice(-2)).toEqual(["unregisterPush", "signOut"]);
  });

  it("counts a server that no longer knows the phone (401/403) as done", async () => {
    const f = fake({ unregisterPush: async () => { throw new ApiError(401, "unauthorized", "no"); } });
    const pending = new PendingRevokes(new Memory(), f.make);
    await pending.add(S, "tok", "x");
    expect(await pending.retry()).toBe(0);
  });

  it("keeps a 5xx for later, but a missing push registration does not hold the sign-out back", async () => {
    const down = fake({ signOut: async () => { throw new ApiError(503, "down", "down"); } });
    const a = new PendingRevokes(new Memory(), down.make);
    await a.add(S, "tok", "x");
    expect(await a.retry()).toBe(1);

    const noPush = fake({ unregisterPush: async () => { throw new ApiError(404, "not_found", "none"); } });
    const b = new PendingRevokes(new Memory(), noPush.make);
    await b.add(S, "tok", "x");
    expect(await b.retry()).toBe(0);
    expect(noPush.calls).toContain("signOut");
  });

  it("gives up on a server that never answers after ninety days", async () => {
    let now = 1_000;
    const f = fake({ signOut: async () => { throw new OfflineError(); } });
    const pending = new PendingRevokes(new Memory(), f.make, () => now);
    await pending.add(S, "tok", "x");
    expect(await pending.retry()).toBe(1);
    now += REVOKE_GIVE_UP_MS + 1;
    expect(await pending.retry()).toBe(0);
  });

  it("does not duplicate the same token", async () => {
    const pending = new PendingRevokes(new Memory(), fake({}).make);
    await pending.add(S, "tok", "x");
    await pending.add(S, "tok", "x");
    expect(await pending.list()).toHaveLength(1);
  });
});
