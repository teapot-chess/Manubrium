import { beforeEach, describe, expect, it } from "vitest";
import { ApiError, OfflineError, type Entry, type EntryAnswer } from "./api";
import { Outbox, refusalText, type KeyValue, type Queued } from "./queue";

class Memory implements KeyValue {
  data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
  }
}

const S = "https://pairings.example";

function result(pairing: number, value: string, expected = "") {
  return { round: 1, pairing, board: pairing, white: 1, black: 2, result: value, expected };
}

describe("Outbox", () => {
  let store: Memory;
  let box: Outbox;
  let n: number;

  beforeEach(() => {
    store = new Memory();
    n = 0;
    box = new Outbox(store, () => `cid-${++n}`);
  });

  it("gives each entry a client id and keeps it across a restart", async () => {
    await box.addResult(S, 7, result(10, "1-0"));

    const again = new Outbox(store);
    await again.load();
    const [q] = again.list(S, 7);
    expect(q.entry).toMatchObject({ cid: "cid-1", kind: "result", pairing: 10, result: "1-0", expected: "" });
    expect(again.count(S, 7)).toBe(1);
  });

  it("chains a second result for the same board onto the first", async () => {
    await box.addResult(S, 7, result(10, "1-0", ""));
    await box.addResult(S, 7, result(10, "0-1", ""));
    await box.addResult(S, 7, result(11, "1/2-1/2", "1-0"));

    const entries = box.list(S, 7).map((q) => q.entry);
    expect(entries[1]).toMatchObject({ result: "0-1", expected: "1-0" });
    expect(entries[2]).toMatchObject({ expected: "1-0" });
  });

  it("sends in order, removes what was saved and keeps a refusal with its sentence", async () => {
    await box.addResult(S, 7, result(10, "1-0"));
    await box.addResult(S, 7, result(11, "0-1"));
    const sent: Entry[][] = [];

    const outcome = await box.flush(S, 7, async (entries) => {
      sent.push(entries);
      return [
        { cid: "cid-1", status: "saved", reason: null, message: "Board 10: saved." },
        { cid: "cid-2", status: "refused", reason: "conflict", message: "Board 11: now says 1-0." },
      ];
    });

    expect(sent[0].map((e) => e.cid)).toEqual(["cid-1", "cid-2"]);
    expect(outcome).toEqual({ saved: 1, refused: 1, waiting: 0, offline: false });
    const [left] = box.list(S, 7);
    expect(left).toMatchObject({ state: "refused", message: "Board 11: now says 1-0.", reason: "conflict" });

    await box.dismiss("cid-2");
    expect(box.list(S, 7)).toEqual([]);
  });

  it("sends an incident with a photo in a request of its own", async () => {
    await box.addResult(S, 7, result(10, "1-0"));
    await box.addIncident(S, 7, { round: 1, pairing: 10, type: "clock", note: "", photo: "/9j/AAAA" });
    await box.addResult(S, 7, result(11, "0-1"));
    const sent: Entry[][] = [];

    const outcome = await box.flush(S, 7, async (entries) => {
      sent.push(entries);
      return entries.map((e) => ({ cid: e.cid, status: "saved", reason: null, message: "" }) as EntryAnswer);
    });

    expect(sent.map((b) => b.map((e) => e.cid))).toEqual([["cid-1"], ["cid-2"], ["cid-3"]]);
    expect(sent[1][0]).toMatchObject({ kind: "incident", photo: "/9j/AAAA" });
    expect(outcome.saved).toBe(3);
  });

  it("keeps everything when the network is gone, and resends the same ids later", async () => {
    await box.addResult(S, 7, result(10, "1-0"));

    const offline = await box.flush(S, 7, async () => {
      throw new OfflineError();
    });
    expect(offline).toMatchObject({ offline: true, waiting: 1 });

    const cids: string[] = [];
    await box.flush(S, 7, async (entries) => {
      entries.forEach((e) => cids.push(e.cid));
      return entries.map((e) => ({ cid: e.cid, status: "saved", reason: null, message: "" }) as EntryAnswer);
    });
    expect(cids).toEqual(["cid-1"]);
    expect(box.count(S, 7)).toBe(0);
  });

  it("keeps a retry waiting and stops there, so order holds", async () => {
    for (let i = 0; i < 30; i++) await box.addResult(S, 7, result(100 + i, "1-0"));
    let calls = 0;

    const outcome = await box.flush(S, 7, async (entries) => {
      calls += 1;
      return entries.map((e, i) => ({ cid: e.cid, status: i === 0 ? "retry" : "saved", reason: null, message: "" }) as EntryAnswer);
    });

    expect(calls).toBe(1);
    expect(outcome.saved).toBe(24);
    expect(outcome.waiting).toBe(6);
  });

  it("sends at most 25 per request", async () => {
    for (let i = 0; i < 30; i++) await box.addResult(S, 7, result(100 + i, "1-0"));
    const sizes: number[] = [];

    await box.flush(S, 7, async (entries) => {
      sizes.push(entries.length);
      return entries.map((e) => ({ cid: e.cid, status: "saved", reason: null, message: "" }) as EntryAnswer);
    });

    expect(sizes).toEqual([25, 5]);
  });

  it("runs one flush per tournament at a time", async () => {
    await box.addResult(S, 7, result(10, "1-0"));
    let calls = 0;
    const send = async (entries: Entry[]) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return entries.map((e) => ({ cid: e.cid, status: "saved", reason: null, message: "" }) as EntryAnswer);
    };

    await Promise.all([box.flush(S, 7, send), box.flush(S, 7, send)]);
    expect(calls).toBe(1);
  });

  it("keeps servers and tournaments apart", async () => {
    await box.addResult(S, 7, result(10, "1-0"));
    await box.addResult(S, 8, result(10, "1-0"));
    await box.addIncident("https://other.example", 7, { round: 1, pairing: 10, type: "clock", note: "" });

    expect(box.count(S)).toBe(2);
    expect(box.count(S, 8)).toBe(1);
    expect(box.list("https://other.example", 7)[0].entry).toMatchObject({ kind: "incident", type: "clock" });

    await box.forgetServer(S);
    expect(box.count(S)).toBe(0);
    expect(box.count("https://other.example")).toBe(1);
  });

  it("survives a corrupted store", async () => {
    await store.set("manubrium.outbox.v1", "{not json");
    await box.load();
    expect(box.list(S, 7)).toEqual([]);
  });
});

describe("a batch the server refuses as a whole", () => {
  it("refuses that batch with the server's sentence and sends the ones behind it", async () => {
    const store = new Memory();
    let n = 0;
    const box = new Outbox(store, () => `cid-${++n}`);
    await box.addIncident(S, 7, { round: 1, pairing: 5, board: 5, type: "other", note: "x", photo: "AAAA" });
    await box.addResult(S, 7, result(6, "1-0"));
    const sent: string[][] = [];
    const out = await box.flush(S, 7, async (entries) => {
      sent.push(entries.map((e) => e.cid));
      if (entries[0].kind === "incident") throw new ApiError(413, "too_large", "That request was too big.");
      return entries.map((e) => ({ cid: e.cid, status: "saved" }) as EntryAnswer);
    });
    expect(sent).toEqual([["cid-1"], ["cid-2"]]);
    expect(out).toMatchObject({ saved: 1, refused: 1, waiting: 0 });
    const [q] = box.list(S, 7);
    expect(q).toMatchObject({ state: "refused", message: "That request was too big." });
  });

  it("keeps everything waiting when the device is refused, or the server is struggling", async () => {
    for (const status of [401, 403, 408, 429, 500, 503]) {
      const box = new Outbox(new Memory(), () => `cid-${status}`);
      await box.addResult(S, 7, result(6, "1-0"));
      await expect(box.flush(S, 7, async () => { throw new ApiError(status, "x", "no"); })).rejects.toBeInstanceOf(ApiError);
      expect(box.count(S, 7)).toBe(1);
    }
  });
});

describe("refusalText", () => {
  const refused = (message: string, extra: Partial<Queued> = {}): Queued => ({
    server: S,
    tournament: 7,
    state: "refused",
    message,
    entry: { cid: "c", kind: "result", round: 2, pairing: 12, board: 2, white: 1, black: 2, result: "1-0", expected: "" },
    ...extra,
  });

  it("keeps a sentence that already names its board", () => {
    expect(refusalText(refused("Board 2: not saved - the board now says 0-1."))).toBe("Board 2: not saved - the board now says 0-1.");
  });

  it("names the board the server could not, from the label the round showed", () => {
    expect(refusalText(refused("Board ?: not saved.", { label: "2a" }))).toBe("Board 2a: not saved.");
    expect(refusalText(refused("Board ?: not saved."))).toBe("Board 2: not saved.");
  });

  it("falls back to the round for an entry with no board at all", () => {
    const q = refused("Board ?: not saved.", {
      entry: { cid: "c", kind: "incident", round: 2, pairing: 5, type: "arbiter_call", note: "" },
    });
    expect(refusalText(q)).toBe("Round 2: not saved.");
  });

  it("does not send the arbiter to check with the arbiter", () => {
    expect(refusalText(refused("Board ?: not saved. Check with the arbiter."))).toBe(
      "Board 2: not saved. Look at the board and enter it again if it still stands.",
    );
  });
});
