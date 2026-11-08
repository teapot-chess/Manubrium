import { describe, expect, it } from "vitest";
import { defaultReminder } from "./defaultTime";
import { Outbox, type KeyValue } from "./queue";

class Memory implements KeyValue {
  data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
  }
}

const result = { round: 1, pairing: 101, board: 1, white: 11, black: 12, result: "0-1", expected: "" };

describe("a refused conflict in the outbox", () => {
  it("keeps what the board held, and 'use mine' queues the result again expecting it", async () => {
    let n = 0;
    const box = new Outbox(new Memory(), () => `cid-${++n}`);
    await box.addResult("https://s", 2, result, "1");

    await box.flush("https://s", 2, async (entries) =>
      entries.map((e) => ({ cid: e.cid, status: "refused" as const, reason: "conflict", message: "no", current: "1-0" })),
    );
    const [refused] = box.list("https://s", 2);
    expect(refused).toMatchObject({ state: "refused", reason: "conflict", current: "1-0" });

    const again = await box.useMine(refused.entry.cid, "1-0");
    expect(again).toMatchObject({ state: "waiting", label: "1" });
    expect(again!.entry).toMatchObject({ kind: "result", result: "0-1", expected: "1-0" });
    expect(again!.entry.cid).not.toBe(refused.entry.cid);
    // The refusal is gone; only the new entry waits.
    expect(box.list("https://s", 2)).toHaveLength(1);
  });

  it("does nothing for an entry that is not a result", async () => {
    const box = new Outbox(new Memory(), () => "cid-1");
    await box.addIncident("https://s", 2, { round: 1, pairing: 101, board: 1, type: "clock", note: "x" });
    expect(await box.useMine("cid-1", "")).toBeNull();
    expect(await box.useMine("nope", "")).toBeNull();
  });
});

describe("the reminder the Notifications card suggests from the default time", () => {
  const now = Date.parse("2026-11-08T14:00:00Z");

  it("is the running clock's moment, when it is still ahead", () => {
    const got = defaultReminder({ minutes: 30, clock: { start: now - 10 * 60_000, minutes: 30 } }, now);
    expect(got).toMatchObject({ fromClock: true, minutes: 20 });
    expect(got!.at.getTime()).toBe(now + 20 * 60_000);
  });

  it("is the phone's minutes from now when no clock runs, or the clock has run out", () => {
    expect(defaultReminder({ minutes: 45, clock: null }, now)).toMatchObject({ fromClock: false, minutes: 45 });
    expect(defaultReminder({ minutes: 30, clock: { start: now - 40 * 60_000, minutes: 30 } }, now)).toMatchObject({ fromClock: false, minutes: 30 });
  });

  it("is nothing when the default time is zero", () => {
    expect(defaultReminder({ minutes: 0, clock: null }, now)).toBeNull();
  });
});
