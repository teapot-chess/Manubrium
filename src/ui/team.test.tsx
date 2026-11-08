// @vitest-environment happy-dom
//
// Several arbiters on the round screen: who else is here and the warning,
// the handover notes, a collision as "keep theirs / use mine", a board's
// history with Undo - each against a fake API that answers what the
// contract's examples show.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ApiError, type Board, type Client, type Round, type Team, type Tournament } from "../api";
import { useState } from "preact/hooks";
import { Outbox, type KeyValue } from "../queue";
import type { SavedServer } from "../servers";
import type { Ctx } from "./App";
import { resetBack } from "../back";
import { RoundScreen } from "./RoundScreen";

const phone = vi.hoisted(() => {
  const kv = () => {
    const data = new Map<string, string>();
    return { data, get: async (k: string) => data.get(k) ?? null, set: async (k: string, v: string) => void data.set(k, v) };
  };
  return { storage: kv(), vault: kv() };
});

vi.mock("../platform", () => ({
  native: true,
  platform: "web",
  storage: phone.storage,
  secureStorage: phone.vault,
  onResume: () => () => undefined,
  onPause: () => () => undefined,
  awayOnPurpose: () => false,
  takePhoto: vi.fn(async () => null),
  shareText: vi.fn(async () => "shared"),
  scanQr: vi.fn(async () => null),
  remindAt: vi.fn(async () => true),
  cancelReminder: vi.fn(async () => undefined),
  deviceUnlockAvailable: async () => false,
  deviceUnlock: async () => false,
}));

class Memory implements KeyValue {
  data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
  }
}

const server: SavedServer = {
  base: "https://pairings.example",
  token: "mnb_t",
  label: "pairings.example",
  user: { email: "arbiter@example.org", name: null },
  info: { name: "OpenPairings", version: "1", api: 1, desktop: false },
  deviceId: 1,
  addedAt: "2026-10-21T00:00:00Z",
};

const player = (id: number, name: string) => ({ id, name, title: null, rating: 2000, score: 0 });
const board = (id: number, result = ""): Board => ({
  id,
  board: id,
  label: String(id),
  white: player(id * 10 + 1, `White ${id}`),
  black: player(id * 10 + 2, `Black ${id}`),
  bye: false,
  vacant: false,
  empty: false,
  result,
  clearable: false,
  phone: null,
});
const round = (boards: Board[]): Round => ({
  number: 1,
  latest: true,
  publish_level: 1,
  boards,
  byes: [],
  pool: [],
  hand_edits: { open: false, pibe: null },
  results: ["1-0", "1/2-1/2", "0-1"],
});
const tournament = (): Tournament =>
  ({
    id: 7,
    name: "Hall Open",
    role: "arbiter",
    status: "running",
    rounds_count: 5,
    paired_rounds: 1,
    can: ["results", "incidents"],
    read_only: false,
    archived: false,
    handed_off: false,
    pairing_system: "swiss",
    team: false,
    rounds: [{ number: 1, publish_level: 1, missing_results: 2 }],
    next_round: null,
    settings: {},
  }) as Tournament;

const alone: Team = { others: [], heartbeat_seconds: 30 };
const colleague: Team = {
  heartbeat_seconds: 30,
  others: [{ id: 2, label: "Cora Chief", initials: "CC", device: "desk", page: "pairings", round: 1, entering_results: true, entering_here: true }],
};
const note = (id: number, body: string, pinned: boolean) => ({ id, body, round: 1, pinned, resolved: false, author: "Cora Chief", created_at: "2026-11-08T14:00:00Z" });

type FakeApi = { [K in keyof Client]: Mock };

function fakeApi(boards: Board[], extra: Partial<FakeApi> = {}): FakeApi {
  return {
    round: vi.fn(async () => round(boards)),
    sync: vi.fn(async (_id: number, entries: { cid: string }[]) => entries.map((e) => ({ cid: e.cid, status: "saved", reason: "saved", message: "" }))),
    team: vi.fn(async () => alone),
    notes: vi.fn(async () => []),
    createNote: vi.fn(async (_id: number, n: { body: string }) => note(9, n.body, false)),
    updateNote: vi.fn(async () => note(1, "x", false)),
    boardHistory: vi.fn(async () => ({ title: "Round 1, board 1", entries: [] })),
    undo: vi.fn(async () => "Undone: the board is back to 1-0."),
    arrivals: vi.fn(async () => []),
    incidents: vi.fn(async () => []),
    ...extra,
  } as never;
}

let outbox: Outbox;
let n = 0;
// `bump` is how the app redraws after the outbox changed; so does the test.
function Harness(props: { api: FakeApi }) {
  const [, again] = useState(0);
  const ctx: Ctx = { server, api: props.api as unknown as Client, outbox, bump: () => again((x) => x + 1) };
  return <RoundScreen ctx={ctx} t={tournament()} reloadTournament={async () => undefined} />;
}
const el = (selector: string) =>
  waitFor(() => {
    const found = document.querySelector(selector);
    if (!found) throw new Error(`${selector} not rendered`);
    return found;
  });
const show = (api: FakeApi) => render(<Harness api={api} />);

beforeEach(async () => {
  phone.storage.data.clear();
  phone.vault.data.clear();
  n = 0;
  outbox = new Outbox(new Memory(), () => `cid-${++n}`);
  await outbox.load();
});

afterEach(() => {
  cleanup();
  resetBack();
});

describe("who else is here", () => {
  it("says where this phone is, and shows the others with a warning for the same round", async () => {
    const api = fakeApi([board(1)], { team: vi.fn(async () => colleague), notes: vi.fn(async () => []) });
    show(api);

    await el("#team-2");
    expect(api.team).toHaveBeenCalledWith(7, 1);
    expect(document.querySelector("#team-2")!.className).toContain("is-entering");
    expect(document.querySelector("#team-entering")!.textContent).toContain("Cora Chief is entering results in this round too");
  });

  it("stays out of the way when nobody else is here", async () => {
    const api = fakeApi([board(1)]);
    show(api);
    await el("#team-strip");
    expect(document.querySelector("#team-faces")).toBeNull();
    expect(document.querySelector("#team-entering")).toBeNull();
  });

  it("draws nothing at all on a server that has never heard of it", async () => {
    const api = fakeApi([board(1)], { team: vi.fn(async () => Promise.reject(new ApiError(404, "not_found", "No such route."))) });
    show(api);
    await el("#board-1");
    expect(document.querySelector("#team-strip")).toBeNull();
  });
});

describe("handover notes", () => {
  it("shows a pinned note at the top and resolves it", async () => {
    const notes = vi.fn().mockResolvedValueOnce([note(1, "Board 7 disputed", true)]).mockResolvedValue([]);
    const api = fakeApi([board(1)], { notes });
    show(api);

    await screen.findByText("Board 7 disputed");
    fireEvent.click(document.querySelector("#note-resolve-1")!);
    await waitFor(() => expect(api.updateNote).toHaveBeenCalledWith(7, 1, { resolved: true }));
    await waitFor(() => expect(document.querySelector("#note-pinned-1")).toBeNull());
  });

  it("writes a note for this round and pins it", async () => {
    const api = fakeApi([board(1)]);
    show(api);

    fireEvent.click(await el("#notes-open"));
    fireEvent.input(await el("#note-body"), { target: { value: "Clocks on board 3 need batteries" } });
    fireEvent.click(document.querySelector("#note-this-round")!);
    fireEvent.click(document.querySelector("#note-pin")!);
    fireEvent.submit(document.querySelector("#note-form")!);

    await waitFor(() => expect(api.createNote).toHaveBeenCalledWith(7, { body: "Clocks on board 3 need batteries", round: 1, pinned: true }));
  });
});

describe("a collision", () => {
  const conflict = (cid: string, current: string | null | undefined) => ({
    cid,
    status: "refused",
    reason: "conflict",
    message: "Board 1: not saved - the board now says 1-0.",
    ...(current === undefined ? {} : { current }),
  });

  async function enterOnBoardOne(api: FakeApi) {
    show(api);
    fireEvent.click(await el("#board-1"));
    fireEvent.click(await screen.findByText("0-1"));
  }

  it("asks keep theirs or use mine, and mine expects what the board holds", async () => {
    const sync = vi
      .fn()
      .mockImplementationOnce(async (_id: number, entries: { cid: string }[]) => [conflict(entries[0].cid, "1-0")])
      .mockImplementation(async (_id: number, entries: { cid: string }[]) => entries.map((e) => ({ cid: e.cid, status: "saved", reason: "saved", message: "" })));
    const api = fakeApi([board(1, "1-0")], { sync });
    await enterOnBoardOne(api);

    await el("#conflict-mine");
    expect(document.querySelector(".conflict")!.textContent).toContain("You entered 0-1, but the board now says 1-0");
    fireEvent.click(document.querySelector("#conflict-mine")!);

    await waitFor(() => expect(sync).toHaveBeenCalledTimes(2));
    const second = sync.mock.calls[1][1] as { result: string; expected: string }[];
    expect(second[0]).toMatchObject({ result: "0-1", expected: "1-0" });
    await waitFor(() => expect(document.querySelector(".conflict")).toBeNull());
  });

  it("keeping theirs drops the entry and writes nothing", async () => {
    const sync = vi.fn(async (_id: number, entries: { cid: string }[]) => [conflict(entries[0].cid, "1-0")]);
    const api = fakeApi([board(1, "1-0")], { sync });
    await enterOnBoardOne(api);

    fireEvent.click(await el("#conflict-keep"));
    await waitFor(() => expect(document.querySelector(".conflict")).toBeNull());
    expect(sync).toHaveBeenCalledTimes(1);
    expect(outbox.list(server.base, 7)).toEqual([]);
  });

  it("reads what the board holds off the round when the refusal is a replay", async () => {
    const sync = vi.fn(async (_id: number, entries: { cid: string }[]) => [conflict(entries[0].cid, null)]);
    const api = fakeApi([board(1, "½-½".replace(/½/g, "1/2"))], { sync });
    await enterOnBoardOne(api);

    await el("#conflict-mine");
    expect(document.querySelector(".conflict")!.textContent).toContain("½-½");
  });
});

describe("a board's history", () => {
  const history = {
    title: "Round 1, board 1",
    entries: [
      { id: 2, who: "cora@example.org", at: "2026-11-08T14:00:00Z", text: "Changed result on board 1 from 1-0 to 0-1.", undo: { status: "ok", reason: null } },
      { id: 1, who: "ann@example.org", at: "2026-11-08T13:50:00Z", text: "Entered result 1-0 on board 1.", undo: { status: "refused", reason: "The result has changed again since (it is now 0-1)." } },
    ],
  };

  it("offers Undo only where the server says yes, and shows the reason otherwise", async () => {
    const api = fakeApi([board(1, "0-1")], { boardHistory: vi.fn(async () => history) });
    show(api);

    fireEvent.click(await el("#board-1"));
    fireEvent.click(await el("#board-history"));
    await el("#history-list");
    expect(api.boardHistory).toHaveBeenCalledWith(7, 1, 1);
    expect(document.querySelector("#history-undo-2")).not.toBeNull();
    expect(document.querySelector("#history-undo-1")).toBeNull();
    expect(document.querySelector("#history-reason-1")!.textContent).toContain("changed again since");
  });

  it("undoes, says so, and reads the round again", async () => {
    const api = fakeApi([board(1, "0-1")], { boardHistory: vi.fn(async () => history) });
    show(api);

    fireEvent.click(await el("#board-1"));
    fireEvent.click(await el("#board-history"));
    fireEvent.click(await el("#history-undo-2"));

    await waitFor(() => expect(api.undo).toHaveBeenCalledWith(7, 1, 1, 2));
    await screen.findByText("Undone: the board is back to 1-0.");
    expect(document.querySelector("#history-list")).toBeNull();
  });

  it("shows the desk's reason when the undo is refused", async () => {
    const undo = vi.fn(async () => Promise.reject(new ApiError(409, "undo_refused", "Round 2 was paired with this result counted.")));
    const api = fakeApi([board(1, "0-1")], { boardHistory: vi.fn(async () => history), undo });
    show(api);

    fireEvent.click(await el("#board-1"));
    fireEvent.click(await el("#board-history"));
    fireEvent.click(await el("#history-undo-2"));

    await screen.findByText("Round 2 was paired with this result counted.");
  });
});

describe("the default time and the reminder", () => {
  const manager = {
    platform: "apns",
    permission: async () => "granted",
    asked: async () => true,
    liveActivities: async () => false,
  };
  const status = { available: true, platforms: { apns: true, fcm: true }, events: [], registration: null };

  it("offers the default time this phone keeps as the first reminder, so it is typed once", async () => {
    // Stored by the Default time card: 40 minutes for this tournament.
    // Its own server: the push status is remembered per address for the app's lifetime.
    const mine = { ...server, base: "https://reminder.example" };
    phone.storage.data.set(`manubrium.defaulttime.v1.${mine.base}#7`, "40");
    const api = fakeApi([board(1)], { pushStatus: vi.fn(async () => status), setDefaultTime: vi.fn(async () => undefined) });
    const { RoundPush } = await import("./Notifications");
    render(<RoundPush ctx={{ server: mine, api: api as unknown as Client, outbox, bump: () => undefined }} t={tournament()} round={round([board(1)])} manager={manager as never} />);

    fireEvent.click(await el("#push-reminder-set"));
    const first = await el("#push-reminder-default");
    expect(first.textContent).toContain("40 minutes");

    fireEvent.click(first);
    await waitFor(() => expect(api.setDefaultTime).toHaveBeenCalledTimes(1));
    const [id, number, at] = api.setDefaultTime.mock.calls[0];
    expect([id, number]).toEqual([7, 1]);
    expect(Date.parse(at) - Date.now()).toBeGreaterThan(39 * 60_000);
    expect(Date.parse(at) - Date.now()).toBeLessThan(41 * 60_000);
  });
});
