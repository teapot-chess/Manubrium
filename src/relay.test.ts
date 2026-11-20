// The cloud relay from the phone's side (contract revision 7): every write
// on a relayed tournament comes back as a command for the laptop, carries an
// Idempotency-Key, and is asked about until the laptop has answered.

import { describe, expect, it, vi } from "vitest";
import { ApiError, client, OfflineError, type FetchLike, type Tournament } from "./api";
import {
  acknowledgedRequest,
  CommandBook,
  commandQuestion,
  KeyMemory,
  MAX_POLL_SECONDS,
  pollDelay,
  RelayedWrite,
  relayCommandOf,
  writableWhenRelayed,
  type RelayCommand,
} from "./relay";
import type { KeyValue } from "./queue";
import { examples, problems } from "./contract.testkit";

const BASE = "https://pairings.example";

class Memory implements KeyValue {
  data = new Map<string, string>();
  async get(k: string) {
    return this.data.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.data.set(k, v);
  }
}

const ex = <T>(name: string): T => structuredClone(examples[name]) as T;
const pendingBody = () => ex<{ command: RelayCommand }>("command-response.pending.json");

interface Seen {
  method: string;
  url: string;
  key: string | undefined;
  body: unknown;
}

function fake(answer: (seen: Seen, n: number) => { status: number; body?: unknown } | "offline") {
  const seen: Seen[] = [];
  const fetchImpl: FetchLike = async (url, init = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const s: Seen = { method: init.method ?? "GET", url, key: headers["idempotency-key"], body: init.body ? JSON.parse(init.body as string) : undefined };
    seen.push(s);
    const a = answer(s, seen.length);
    if (a === "offline") throw new TypeError("Failed to fetch");
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status });
  };
  return { fetch: fetchImpl, seen };
}

describe("the contract's command answers", () => {
  it("pass their schema and read as commands", () => {
    for (const name of ["command-response.json", "command-response.pending.json", "command-response.refused.json"]) {
      const body = ex<unknown>(name);
      expect(problems("command-response.schema.json", body), name).toEqual([]);
      expect(relayCommandOf(body), name).toEqual((body as { command: RelayCommand }).command);
    }
  });

  it("are not mistaken for a live board's command, which has no cid", () => {
    expect(relayCommandOf(ex("live-board-command-response.json"))).toBeNull();
    expect(relayCommandOf({ round: {} })).toBeNull();
  });
});

describe("a write on a relayed tournament", () => {
  it("sends an Idempotency-Key with every write, and none with a read", async () => {
    const { fetch, seen } = fake((s) => (s.method === "GET" ? { status: 200, body: ex("tournament-response.json") } : { status: 200, body: ex("player-response.json") }));
    const c = client(BASE, "tok", fetch, { keys: new KeyMemory(() => "k-1") });
    await c.tournament(2);
    await c.updatePlayer(2, 6, { present: false });
    expect(seen[0].key).toBeUndefined();
    expect(seen[1].key).toBe("k-1");
  });

  it("answers 202 with a command: the client hands it on and throws RelayedWrite instead of the usual answer", async () => {
    const { fetch } = fake(() => ({ status: 202, body: pendingBody() }));
    const onCommand = vi.fn();
    const c = client(BASE, "tok", fetch, { onCommand });
    const error = await c.pair(2).catch((e) => e);
    expect(error).toBeInstanceOf(RelayedWrite);
    expect((error as RelayedWrite).command.state).toBe("pending");
    expect(onCommand).toHaveBeenCalledWith(2, pendingBody().command, { method: "POST", path: "/tournaments/2/rounds", body: { acknowledged: [] } });
  });

  it("does the same for a write the app never queues: a hall command, a match decision, a byes change", async () => {
    const { fetch } = fake(() => ({ status: 202, body: pendingBody() }));
    const c = client(BASE, "tok", fetch);
    for (const go of [() => c.hallPrint(2, "pairings"), () => c.decideMatch(2, 1, 3, "forfeit_a"), () => c.setByes(2, 6, [])]) {
      await expect(go()).rejects.toBeInstanceOf(RelayedWrite);
    }
  });

  it("keeps the key of a write whose answer was lost, and spends it once anything answers", async () => {
    let n = 0;
    const keys = new KeyMemory(() => `k-${++n}`);
    const { fetch, seen } = fake((_, i) => (i === 1 ? "offline" : { status: 202, body: pendingBody() }));
    const c = client(BASE, "tok", fetch, { keys });
    await expect(c.publish(2, 1, 2)).rejects.toBeInstanceOf(OfflineError);
    await expect(c.publish(2, 1, 2)).rejects.toBeInstanceOf(RelayedWrite);
    await expect(c.publish(2, 1, 2)).rejects.toBeInstanceOf(RelayedWrite);
    expect(seen.map((s) => s.key)).toEqual(["k-1", "k-1", "k-2"]);
  });

  it("asks GET commands/:cid for where a command stands", async () => {
    const { fetch, seen } = fake(() => ({ status: 200, body: ex("command-response.refused.json") }));
    const got = await client(BASE, "tok", fetch).relayCommand(2, "6d0cecd9-bf5a-4c44-9ec6-5b98ef5cf7e9");
    expect(got.state).toBe("refused");
    expect(seen[0]).toMatchObject({ method: "GET", url: `${BASE}/api/manubrium/v1/tournaments/2/commands/6d0cecd9-bf5a-4c44-9ec6-5b98ef5cf7e9`, key: undefined });
  });

  it("reads a refusal before forwarding (404, 409 desk_only) as the server's own error", async () => {
    const { fetch } = fake(() => ({ status: 409, body: { error: "desk_only", message: "Undo it at the laptop." } }));
    const error = await client(BASE, "tok", fetch).undo(2, 1, 101, 7).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "desk_only", message: "Undo it at the laptop." });
  });

  it("answers the desk's question by sending the write again with acknowledged, under a new key", async () => {
    const refused: RelayCommand = {
      ...pendingBody().command,
      state: "refused",
      status: 409,
      error: "needs_acknowledgement",
      message: "Round 3 was already sent to FIDE.",
      response: { confirm: ["rated"], summary: "Change a rated player?", warnings: ["Round 3 was already sent."] },
    };
    const question = commandQuestion(refused)!;
    expect(question).toEqual({ confirm: ["rated"], summary: "Change a rated player?", warnings: ["Round 3 was already sent."] });
    expect(commandQuestion({ ...refused, error: "conflict" })).toBeNull();

    const request = { method: "PATCH", path: "/tournaments/2/players/6", body: { player: { present: false }, acknowledged: [] } };
    const again = acknowledgedRequest(request, question.confirm);
    expect(again.body).toEqual({ player: { present: false }, acknowledged: ["rated"] });

    const { fetch, seen } = fake(() => ({ status: 202, body: pendingBody() }));
    const keys = new KeyMemory(() => "the-old-key");
    await expect(client(BASE, "tok", fetch, { keys }).resend(again)).rejects.toBeInstanceOf(RelayedWrite);
    expect(seen[0].key).not.toBe("the-old-key");
    expect(seen[0].body).toEqual(again.body);
  });
});

describe("asking about a command", () => {
  it("asks soon, then less often, and never less often than once a minute", () => {
    const delays = Array.from({ length: 12 }, (_, i) => pollDelay(i));
    expect(delays[0]).toBe(2);
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    expect(Math.max(...delays)).toBe(MAX_POLL_SECONDS);
  });

  it("keeps a command across a restart, asks when it is due, backs off while pending, and stops once answered", async () => {
    let now = 1_000_000;
    const store = new Memory();
    const book = new CommandBook(store, () => now);
    const cmd = pendingBody().command;
    await book.add(BASE, 2, cmd, { method: "POST", path: "/tournaments/2/rounds", body: { acknowledged: [] } });

    const again = new CommandBook(store, () => now);
    await again.load();
    expect(again.pendingCount(BASE, 2)).toBe(1);
    expect(again.due(BASE, 2)).toEqual([]);

    now += pollDelay(0) * 1000;
    expect(again.due(BASE, 2)).toHaveLength(1);
    await again.answered(BASE, cmd);
    expect(again.due(BASE, 2)).toEqual([]);
    expect(again.nextDue(BASE, 2)).toBe(now + pollDelay(1) * 1000);

    await again.askFailed(BASE, cmd.cid);
    expect(again.nextDue(BASE, 2)).toBe(now + pollDelay(2) * 1000);

    // Back in the app: everything is asked about at once.
    await again.wake(BASE, 2);
    expect(again.due(BASE, 2)).toHaveLength(1);

    await again.answered(BASE, { ...cmd, state: "accepted", status: 200 });
    expect(again.pendingCount(BASE, 2)).toBe(0);
    expect(again.nextDue(BASE, 2)).toBeNull();
    expect(again.list(BASE, 2)[0].command.state).toBe("accepted");

    await again.dismiss(BASE, cmd.cid);
    expect(again.list(BASE, 2)).toEqual([]);
  });

  it("does not keep a photo's body: it is never sent again", async () => {
    const book = new CommandBook(new Memory());
    const kept = await book.add(BASE, 2, pendingBody().command, { method: "POST", path: "/tournaments/2/incidents/4/photo", body: { photo: "x".repeat(100_000) } });
    expect(kept.request.body).toBeUndefined();
  });

  it("keeps one entry per cid and forgets a removed server", async () => {
    const book = new CommandBook(new Memory());
    const cmd = pendingBody().command;
    await book.add(BASE, 2, cmd, { method: "POST", path: "/tournaments/2/rounds" });
    await book.add(BASE, 2, cmd, { method: "POST", path: "/tournaments/2/rounds" });
    expect(book.list(BASE, 2)).toHaveLength(1);
    await book.forgetServer(BASE);
    expect(book.list(BASE, 2)).toEqual([]);
  });
});

describe("a relayed tournament on screen", () => {
  const relayed = (): Tournament => {
    const t = ex<{ tournament: Tournament }>("tournament-response.json").tournament;
    return {
      ...t,
      read_only: true,
      handed_off: true,
      relay: { label: "laptop Hall", since: null, last_seen_at: null, mirrored_at: null },
      next_round: { number: 2, blocker: "read_only", warnings: [] },
    };
  };

  it("keeps its buttons: the laptop takes the writes and decides", () => {
    const t = writableWhenRelayed(relayed());
    expect(t.read_only).toBe(false);
    expect(t.next_round?.blocker).toBeNull();
  });

  it("leaves every other tournament as the server said, and an archived one read-only", () => {
    const plain = ex<{ tournament: Tournament }>("tournament-response.json").tournament;
    expect(writableWhenRelayed(plain)).toBe(plain);
    const archived = { ...relayed(), archived: true };
    expect(writableWhenRelayed(archived).read_only).toBe(true);
    const otherBlocker = { ...relayed(), next_round: { number: 9, blocker: "all_rounds_paired", warnings: [] } };
    expect(writableWhenRelayed(otherBlocker).next_round?.blocker).toBe("all_rounds_paired");
  });
});
