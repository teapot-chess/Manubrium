// @vitest-environment happy-dom
//
// The round view's new work - a Lite phone's result to confirm or reject,
// hand edits with the desk's questions, the pool, finishing the edits - and
// the More tab's settings and incident photos, each against a fake API.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ApiError, type Board, type Client, type Round, type Tournament } from "../api";
import { Outbox, type KeyValue } from "../queue";
import type { SavedServer } from "../servers";
import type { Ctx } from "./App";
import { MoreScreen } from "./MoreScreen";
import { RoundScreen } from "./RoundScreen";
import { changes, initial, SettingsEditor } from "./SettingsEditor";

vi.mock("../platform", () => ({
  onResume: () => () => undefined,
  takePhoto: vi.fn(async () => "/9j/PHOTO"),
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

const p = (id: number, name: string) => ({ id, name, title: null, rating: 2000, score: 0 });

function board(id: number, n: number, extra: Partial<Board> = {}): Board {
  return {
    id,
    board: n,
    label: String(n),
    white: p(id * 10 + 1, `White ${n}`),
    black: p(id * 10 + 2, `Black ${n}`),
    bye: false,
    vacant: false,
    empty: false,
    result: "",
    clearable: false,
    phone: null,
    ...extra,
  };
}

function round(boards: Board[], extra: Partial<Round> = {}): Round {
  return {
    number: 1,
    latest: true,
    publish_level: 1,
    boards,
    byes: [],
    pool: [],
    hand_edits: { open: false, pibe: null },
    results: ["1-0", "1/2-1/2", "0-1", "+-", "-+"],
    ...extra,
  };
}

function tournament(role: "owner" | "arbiter", settings: Record<string, unknown> = {}): Tournament {
  return {
    id: 7,
    name: "Hall Open",
    role,
    status: "active",
    start_date: null,
    end_date: null,
    city: null,
    rounds_count: 5,
    paired_rounds: 1,
    can: role === "owner" ? ["results", "incidents", "pair", "publish", "players", "standings", "settings"] : ["results", "incidents"],
    read_only: false,
    archived: false,
    handed_off: false,
    pairing_system: "swiss",
    team: false,
    rounds: [{ number: 1, publish_level: 1, missing_results: 2 }],
    next_round: null,
    settings,
  };
}

type FakeApi = { [K in keyof Client]: Mock };

function fakeApi(r: Round): FakeApi {
  return {
    round: vi.fn(async () => r),
    sync: vi.fn(async (_id: number, entries: { cid: string }[]) =>
      entries.map((e) => ({ cid: e.cid, status: "saved", reason: null, message: "" })),
    ),
    confirmResult: vi.fn(async () => undefined),
    rejectResult: vi.fn(async () => undefined),
    edit: vi.fn(async () => r),
    finishEdits: vi.fn(async () => ({ pibe: null, round: r })),
    updateSettings: vi.fn(async () => ({})),
    attachPhoto: vi.fn(async () => ({})),
    photo: vi.fn(async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" })),
    incidents: vi.fn(async () => []),
  } as never;
}

let outbox: Outbox;
let n = 0;

function ctxWith(api: FakeApi): Ctx {
  return { server, api: api as unknown as Client, outbox, bump: () => undefined };
}

// The element, once the screen has rendered it.
const el = (selector: string) =>
  waitFor(() => {
    const found = document.querySelector(selector);
    if (!found) throw new Error(`${selector} not rendered`);
    return found;
  });

const needs = (body: Record<string, unknown>) => new ApiError(409, "needs_acknowledgement", "Confirm first.", { error: "needs_acknowledgement", ...body });

beforeEach(async () => {
  n = 0;
  outbox = new Outbox(new Memory(), () => `cid-${++n}`);
  await outbox.load();
});

afterEach(cleanup);

describe("a Lite phone's result in the round", () => {
  const fromPhone = () =>
    round([board(1, 1, { result: "1-0", clearable: true, phone: { by: "Hall phone", state: "unconfirmed", at: "2026-10-21T10:00:00" } }), board(2, 2)]);

  it("is marked, counted, and confirmed with what the board showed", async () => {
    const api = fakeApi(fromPhone());
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("arbiter")} reloadTournament={async () => undefined} />);

    await screen.findByText(/1 result from a phone to check/);
    expect(document.querySelector("#board-1")!.className).toContain("from-phone");

    fireEvent.click(document.querySelector("#board-1")!);
    expect(screen.getByText(/was entered on the phone/).textContent).toContain("Hall phone");
    fireEvent.click(document.querySelector("#confirm-result")!);

    await waitFor(() => expect(api.confirmResult).toHaveBeenCalledWith(7, 1, 1, "1-0"));
    await screen.findByText(/confirmed\./);
  });

  it("is rejected, which the server turns into a cleared board", async () => {
    const api = fakeApi(fromPhone());
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("arbiter")} reloadTournament={async () => undefined} />);

    fireEvent.click(await el("#board-1"));
    fireEvent.click(document.querySelector("#reject-result")!);

    await waitFor(() => expect(api.rejectResult).toHaveBeenCalledWith(7, 1, 1, "1-0"));
    await screen.findByText(/rejected and cleared/);
  });

  it("shows the server's refusal when the board changed meanwhile", async () => {
    const api = fakeApi(fromPhone());
    api.confirmResult.mockRejectedValueOnce(new ApiError(409, "conflict", "Not done: the board now says 0-1, entered elsewhere."));
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("owner")} reloadTournament={async () => undefined} />);

    fireEvent.click(await el("#board-1"));
    fireEvent.click(document.querySelector("#confirm-result")!);
    await screen.findByText(/the board now says 0-1/);
  });
});

describe("hand edits", () => {
  it("swaps two players, asking first when the server has a question", async () => {
    const r = round([board(1, 1), board(2, 2)]);
    const api = fakeApi(r);
    api.edit.mockRejectedValueOnce(
      needs({ confirm: ["pairing_rules"], summary: "White 1  ⇄  White 2", warnings: ["White 2 and Black 1 already played each other, in round 1."] }),
    );
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("owner")} reloadTournament={async () => undefined} />);

    fireEvent.click(await el("#board-1"));
    fireEvent.click(document.querySelector("#edit-pairing")!);
    fireEvent.click(document.querySelector("#swap-11")!);
    fireEvent.click(document.querySelector("#swap-with-21")!);

    await screen.findByText(/already played each other/);
    expect(api.edit).toHaveBeenCalledWith(7, 1, { kind: "swap", a: 11, b: 21 }, []);
    fireEvent.click(document.querySelector("#ask-yes")!);

    await waitFor(() => expect(api.edit).toHaveBeenLastCalledWith(7, 1, { kind: "swap", a: 11, b: 21 }, ["pairing_rules"]));
    await screen.findByText(/White 1 and White 2 swapped/);
  });

  it("marks a player as not playing, then gives the opponent the bye", async () => {
    const r = round([board(1, 1, { black: null, vacant: true }), board(2, 2)], { pool: [{ player: p(12, "Black 1"), type: "absent", absent: false }] });
    const api = fakeApi(r);
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("owner")} reloadTournament={async () => undefined} />);

    fireEvent.click(await el("#board-1"));
    fireEvent.click(document.querySelector("#give-bye")!);
    await waitFor(() => expect(api.edit).toHaveBeenCalledWith(7, 1, { kind: "bye", pairing: 1 }, []));
  });

  it("fills an empty seat from the pool", async () => {
    const r = round([board(1, 1, { black: null, vacant: true })], { pool: [{ player: p(12, "Black 1"), type: "absent", absent: false }] });
    const api = fakeApi(r);
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("owner")} reloadTournament={async () => undefined} />);

    fireEvent.click(await el("#board-1"));
    fireEvent.click(document.querySelector("#fill-seat")!);
    fireEvent.click(document.querySelector("#fill-with-12")!);
    await waitFor(() => expect(api.edit).toHaveBeenCalledWith(7, 1, { kind: "fill", pairing: 1, player: 12 }, []));
  });

  it("vacates a seat, with the bye type where the tournament asks it", async () => {
    const api = fakeApi(round([board(1, 1)]));
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("owner", { ask_bye_type: true })} reloadTournament={async () => undefined} />);

    fireEvent.click(await el("#board-1"));
    fireEvent.click(document.querySelector("#edit-pairing")!);
    fireEvent.click(document.querySelector("#vacate-12")!);
    fireEvent.change(document.querySelector("#vacate-type")!, { target: { value: "requested-half" } });
    fireEvent.click(document.querySelector("#vacate-confirm")!);

    await waitFor(() => expect(api.edit).toHaveBeenCalledWith(7, 1, { kind: "vacate", player: 12, bye_type: "requested-half" }, []));
  });

  it("pairs two players from the pool on a new board", async () => {
    const r = round([board(1, 1)], {
      pool: [
        { player: p(31, "Late One"), type: null, absent: false },
        { player: p(32, "Late Two"), type: null, absent: false },
      ],
    });
    const api = fakeApi(r);
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("owner")} reloadTournament={async () => undefined} />);

    fireEvent.click(await el("#pool-31"));
    expect(document.querySelector("#pool-bye")).not.toBeNull();
    fireEvent.click(document.querySelector("#pool-32")!);
    fireEvent.click(document.querySelector("#pool-pair")!);

    await waitFor(() => expect(api.edit).toHaveBeenCalledWith(7, 1, { kind: "pool_pair", a: 31, b: 32 }, []));
  });

  it("finishes the edits, keeping the checker's disagreement only when told to", async () => {
    const api = fakeApi(round([board(1, 1)], { hand_edits: { open: true, pibe: null } }));
    api.finishEdits.mockRejectedValueOnce(
      needs({ confirm: ["mpa_pibe"], checker: { checked: true, line: "MPA 1 ...", missing: ["White 1 - Black 2"], added: ["White 1 - Black 1"], warnings: [] } }),
    );
    api.finishEdits.mockResolvedValueOnce({ pibe: "MPA 1 ...", round: round([board(1, 1)]) });
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("owner")} reloadTournament={async () => undefined} />);

    fireEvent.click(await el("#finish-edits"));
    await screen.findByText(/would pair this round differently/);
    fireEvent.click(document.querySelector("#ask-yes")!);

    await waitFor(() => expect(api.finishEdits).toHaveBeenLastCalledWith(7, 1, ["mpa_pibe"]));
    await screen.findByText(/recorded as MPA 1/);
  });

  it("are not offered to an arbiter", async () => {
    const api = fakeApi(round([board(1, 1), board(2, 2, { black: null, bye: true, result: "bye" })], { pool: [{ player: p(9, "X"), type: null, absent: false }] }));
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("arbiter")} reloadTournament={async () => undefined} />);

    fireEvent.click(await el("#board-1"));
    expect(document.querySelector("#edit-pairing")).toBeNull();
    expect(document.querySelector("#pool")).toBeNull();
    expect((document.querySelector("#board-2") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("an incident photo", () => {
  it("travels with the incident through the outbox", async () => {
    const api = fakeApi(round([board(1, 1)]));
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("arbiter")} reloadTournament={async () => undefined} />);

    fireEvent.click(await el("#log-incident"));
    fireEvent.click(document.querySelector("#incident-photo")!);
    await waitFor(() => expect(document.querySelector(".photo-preview img")).not.toBeNull());
    fireEvent.submit(document.querySelector("form.form")!);

    await waitFor(() =>
      expect(api.sync).toHaveBeenCalledWith(7, [expect.objectContaining({ kind: "incident", photo: "/9j/PHOTO", type: "arbiter_call" })]),
    );
  });

  it("is added to a logged incident and shown from the More tab", async () => {
    const api = fakeApi(round([]));
    api.incidents.mockResolvedValue([
      { id: 3, round: 1, board: 2, kind: "clock", note: "", white: null, black: null, occurred_at: "", by: null, has_photo: false },
      { id: 4, round: 1, board: 1, kind: "illegal_move", note: "", white: null, black: null, occurred_at: "", by: null, has_photo: true },
    ]);
    URL.createObjectURL = vi.fn(() => "blob:photo");
    URL.revokeObjectURL = vi.fn();
    render(<MoreScreen ctx={ctxWith(api)} t={tournament("owner")} />);

    fireEvent.click(await el("#add-photo-3"));
    await waitFor(() => expect(api.attachPhoto).toHaveBeenCalledWith(7, 3, "/9j/PHOTO"));
    await screen.findByText("Photo added.");

    fireEvent.click(document.querySelector("#photo-4")!);
    await waitFor(() => expect(api.photo).toHaveBeenCalledWith(7, 4));
    await waitFor(() => expect(document.querySelector("#incident-photo-view")!.getAttribute("src")).toBe("blob:photo"));
  });
});

describe("settings", () => {
  const settings = {
    time_control: "90+30",
    chief_arbiter: "IA Somebody",
    deputy_arbiter: null,
    rounds_count: 5,
    bye_value: 1,
    ask_bye_type: false,
    shared_places: false,
    tiebreaks: ["BH-C1"],
    configured_tiebreaks: ["BH-C1"],
    editable: ["time_control", "chief_arbiter", "deputy_arbiter", "venue", "city", "ask_bye_type", "shared_places"],
    tiebreak_options: [
      { code: "BH-C1", name: "Buchholz Cut 1" },
      { code: "SB", name: "Sonneborn-Berger" },
    ],
  };

  it("sends only what changed and the server said it takes", () => {
    const t = tournament("owner", settings);
    expect(changes(t, { ...initial(t), time_control: "60+30", rounds_count: 7, tiebreaks: ["SB"] })).toEqual({ time_control: "60+30" });
  });

  it("is changed from the More tab; locked fields are shown but not editable", async () => {
    const api = fakeApi(round([]));
    const reload = vi.fn(async () => undefined);
    render(<MoreScreen ctx={ctxWith(api)} t={tournament("owner", settings)} reloadTournament={reload} />);

    fireEvent.click(await el("#edit-settings"));
    expect((document.querySelector("#set-rounds_count") as HTMLInputElement).disabled).toBe(true);
    expect(document.querySelector("#set-add-tiebreak")).toBeNull();
    expect((document.querySelector("#settings-save") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.input(document.querySelector("#set-time_control")!, { target: { value: "60+30" } });
    fireEvent.click(document.querySelector("#set-shared_places")!);
    fireEvent.submit(document.querySelector("#settings-form")!);

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith(7, { time_control: "60+30", shared_places: true }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("shows the server's refusal", async () => {
    const api = fakeApi(round([]));
    api.updateSettings.mockRejectedValueOnce(new ApiError(422, "locked_in_fide_mode", "Not saved: this setting is locked in FIDE mode."));
    render(<SettingsEditor ctx={ctxWith(api)} t={tournament("owner", settings)} onClose={() => undefined} onSaved={() => undefined} />);

    fireEvent.input(document.querySelector("#set-time_control")!, { target: { value: "5+3" } });
    fireEvent.submit(document.querySelector("#settings-form")!);
    await screen.findByText(/locked in FIDE mode/);
  });

  it("is read-only for an arbiter", async () => {
    const api = fakeApi(round([]));
    render(<MoreScreen ctx={ctxWith(api)} t={tournament("arbiter", { time_control: "90+30" })} />);
    expect(document.querySelector("#edit-settings")).toBeNull();
  });
});
