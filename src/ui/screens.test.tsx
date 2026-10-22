// @vitest-environment happy-dom
//
// The round view's new work - a Lite phone's result to confirm or reject,
// hand edits with the desk's questions, the pool, finishing the edits - and
// the More tab's settings and incident photos, each against a fake API.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ApiError, OfflineError, type Board, type Client, type Player, type Round, type SearchHit, type Tournament } from "../api";
import { Outbox, type KeyValue } from "../queue";
import type { SavedServer } from "../servers";
import type { Ctx } from "./App";
import { incidentKind, MoreScreen, settingValue } from "./MoreScreen";
import { goBack, pushBack, resetBack } from "../back";
import { Sheet } from "./common";
import { TournamentView } from "./TournamentView";
import { Tournaments } from "./Tournaments";
import { NewTournament } from "./NewTournament";
import { PlayersScreen } from "./PlayersScreen";
import { RoundScreen } from "./RoundScreen";
import { StandingsScreen } from "./StandingsScreen";
import { changes, initial, SettingsEditor } from "./SettingsEditor";

vi.mock("../platform", () => ({
  onResume: () => () => undefined,
  takePhoto: vi.fn(async () => "/9j/PHOTO"),
  shareText: vi.fn(async () => "shared"),
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
    status: "running",
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
    players: vi.fn(async () => []),
    updatePlayer: vi.fn(async () => ({})),
    createPlayer: vi.fn(async () => ({})),
    setByes: vi.fn(async () => null),
    tournamentOptions: vi.fn(async () => ({
      systems: [
        { id: "swiss_dutch", label: "Swiss (Dutch)" },
        { id: "round_robin", label: "Round robin" },
      ],
      player_sources: [
        { id: "fide", label: "FIDE" },
        { id: "bel", label: "Belgian" },
      ],
      defaults: { federation: "BEL", rounds_count: 7, time_control: "90+30", rated: true },
    })),
    searchPlayers: vi.fn(async () => []),
    addPlayerFrom: vi.fn(async () => ({})),
    boardLinks: vi.fn(async () => []),
    createBoardLink: vi.fn(async () => ({ link: { id: 3, kind: "relay", label: "Top boards", reach: null, created_at: "", last_seen_at: null }, code: "alnasl_ONCE" })),
    revokeBoardLink: vi.fn(async () => undefined),
    createTournament: vi.fn(async () => ({ id: 9, name: "Hall Open" })),
    standings: vi.fn(async () => ({ tiebreaks: [], rows: [] })),
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

afterEach(() => {
  cleanup();
  resetBack();
});

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
    // It asks first: nothing has gone to the server yet.
    await screen.findByText(/Reject the result on board 1\?/);
    expect(api.rejectResult).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector("#reject-confirm")!);

    await waitFor(() => expect(api.rejectResult).toHaveBeenCalledWith(7, 1, 1, "1-0"));
    await screen.findByText(/rejected and cleared/);
  });

  it("is kept when the question is answered with Keep it", async () => {
    const api = fakeApi(fromPhone());
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("arbiter")} reloadTournament={async () => undefined} />);

    fireEvent.click(await el("#board-1"));
    fireEvent.click(document.querySelector("#reject-result")!);
    fireEvent.click(await el("#ask-keep"));

    expect(await el("#reject-result")).toBeTruthy();
    expect(api.rejectResult).not.toHaveBeenCalled();
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

describe("clearing a result", () => {
  it("asks first, naming the result that goes", async () => {
    const api = fakeApi(round([board(1, 1, { result: "1-0", clearable: true })]));
    (api as unknown as { clear: Mock }).clear = vi.fn(async () => undefined);
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("arbiter")} reloadTournament={async () => undefined} />);

    fireEvent.click(await el("#board-1"));
    fireEvent.click(document.querySelector("#clear-result")!);
    await screen.findByText(/Clear board 1\?/);
    expect(api.clear).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector("#clear-confirm")!);
    await waitFor(() => expect(api.clear).toHaveBeenCalledWith(7, 1, 1, "1-0"));
    await screen.findByText("Board 1: cleared.");
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
    fireEvent.change(document.querySelector("#incident-board")!, { target: { value: "1" } });
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

describe("an incident put right", () => {
  const logged = { id: 3, round: 1, board: 2, kind: "clock", note: "Flag fell", white: null, black: null, occurred_at: "", by: null, has_photo: true };

  it("is changed from the More tab: its type and its note", async () => {
    const api = fakeApi(round([]));
    api.incidents.mockResolvedValue([logged]);
    (api as unknown as { updateIncident: Mock }).updateIncident = vi.fn(async () => ({ ...logged, kind: "time_added" }));
    render(<MoreScreen ctx={ctxWith(api)} t={tournament("owner")} />);

    fireEvent.click(await el("#edit-incident-3"));
    fireEvent.change(await el("#incident-edit-type"), { target: { value: "time_added" } });
    fireEvent.input(document.querySelector("#incident-edit-note")!, { target: { value: " Two minutes to Black " } });
    fireEvent.submit(document.querySelector("#incident-edit-form")!);

    await waitFor(() => expect(api.updateIncident).toHaveBeenCalledWith(7, 3, { kind: "time_added", note: "Two minutes to Black" }));
    await screen.findByText("Incident changed.");
    expect(api.incidents).toHaveBeenCalledTimes(2);
  });

  it("is deleted after a question, and a refusal is shown where it was asked", async () => {
    const api = fakeApi(round([]));
    api.incidents.mockResolvedValue([logged]);
    const deleteIncident = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, "archived", "The tournament is archived."))
      .mockResolvedValue(undefined);
    (api as unknown as { deleteIncident: Mock }).deleteIncident = deleteIncident;
    render(<MoreScreen ctx={ctxWith(api)} t={tournament("owner")} />);

    fireEvent.click(await el("#edit-incident-3"));
    fireEvent.click(await el("#incident-delete"));
    await screen.findByText(/its photo with it/);
    expect(deleteIncident).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector("#incident-delete-confirm")!);
    await screen.findByText("The tournament is archived.");

    fireEvent.click(document.querySelector("#incident-delete-confirm")!);
    await waitFor(() => expect(deleteIncident).toHaveBeenCalledTimes(2));
    expect(deleteIncident).toHaveBeenCalledWith(7, 3);
    await screen.findByText("Incident deleted.");
  });

  it("is not offered on a read-only tournament", async () => {
    const api = fakeApi(round([]));
    api.incidents.mockResolvedValue([logged]);
    render(<MoreScreen ctx={ctxWith(api)} t={{ ...tournament("owner"), read_only: true }} />);

    await el("#incident-list");
    expect(document.querySelector("#edit-incident-3")).toBeNull();
  });
});

describe("the offline queue on the organiser's phone", () => {
  it("asks which board a round-level incident is about, and sends that board", async () => {
    const api = fakeApi(round([board(1, 1), board(2, 2)]));
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("owner")} reloadTournament={async () => undefined} />);

    fireEvent.click(await el("#log-incident"));
    expect((document.querySelector("form.form button[type=submit]") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(document.querySelector("form.form")!);
    expect(api.sync).not.toHaveBeenCalledWith(7, [expect.objectContaining({ kind: "incident" })]);

    fireEvent.change(document.querySelector("#incident-board")!, { target: { value: "2" } });
    fireEvent.submit(document.querySelector("form.form")!);

    await waitFor(() =>
      expect(api.sync).toHaveBeenCalledWith(7, [expect.objectContaining({ kind: "incident", pairing: 2, board: 2 })]),
    );
  });

  it("names the board of a refused result even when the server could not, and never says 'check with the arbiter'", async () => {
    const api = fakeApi(round([board(1, 1), board(2, 2)]));
    api.sync.mockImplementation(async (_id: number, entries: { cid: string }[]) =>
      entries.map((e) => ({ cid: e.cid, status: "refused", reason: "not_saved", message: "Board ?: not saved. Check with the arbiter." })),
    );
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("owner")} reloadTournament={async () => undefined} />);

    fireEvent.click(await el("#board-2"));
    fireEvent.click(await el(".result-grid button"));

    // Still there until somebody reads it: refused is not dropped.
    await waitFor(() => expect(outbox.list(server.base, 7)).toMatchObject([{ state: "refused", reason: "not_saved" }]));

    // The app re-renders on its outbox bump; the fake context does not, so look again.
    cleanup();
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("owner")} reloadTournament={async () => undefined} />);
    const notice = await screen.findByText(/Not accepted/);
    expect(notice.textContent).toContain("Board 2: not saved.");
    expect(notice.textContent).not.toContain("?");
    expect(notice.textContent).not.toMatch(/check with the arbiter/i);
  });
});

describe("standings with a round in progress", () => {
  const row = (id: number, name: string, points: number, bh: number) => ({
    rank: id,
    player: { id, name, title: null, rating: 2000 },
    points,
    tiebreaks: { BHC1: 0, BH: bh, SB: 0 },
  });
  const tiebreaks = [
    { code: "BHC1", name: "Buchholz Cut-1" },
    { code: "BH", name: "Buchholz" },
    { code: "SB", name: "Sonneborn-Berger" },
  ];

  it("shows each tie-break under its own column and says they stop at the last complete round", async () => {
    const api = fakeApi(round([]));
    api.standings.mockResolvedValue({
      tiebreaks,
      rows: [row(1, "Bosmans", 2, 0), row(2, "Peeters", 0, 1)],
      tiebreaks_through: 1,
      rounds_paired: 2,
    });
    render(<StandingsScreen ctx={ctxWith(api)} t={tournament("owner")} />);

    const note = await el("#standings-tiebreak-note");
    expect(note.textContent).toContain("up to round 1");
    const head = Array.from(document.querySelectorAll("#standings thead th")).map((th) => th.textContent);
    const peeters = Array.from(document.querySelectorAll("#standings tbody tr")[1].querySelectorAll("td")).map((td) => td.textContent);
    expect(peeters[head.indexOf("BH")]).toBe("1");
    expect(peeters[head.indexOf("BHC1")]).toBe("0");
  });

  it("says nothing once every paired round is complete, or on a server that does not tell", async () => {
    const api = fakeApi(round([]));
    api.standings.mockResolvedValue({ tiebreaks, rows: [row(1, "Bosmans", 2, 1)], tiebreaks_through: 2, rounds_paired: 2 });
    render(<StandingsScreen ctx={ctxWith(api)} t={tournament("owner")} />);
    await el("#standings");
    expect(document.querySelector("#standings-tiebreak-note")).toBeNull();

    cleanup();
    api.standings.mockResolvedValue({ tiebreaks, rows: [row(1, "Bosmans", 2, 1)] });
    render(<StandingsScreen ctx={ctxWith(api)} t={tournament("owner")} />);
    await el("#standings");
    expect(document.querySelector("#standings-tiebreak-note")).toBeNull();
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

function player(id: number, name: string, extra: Partial<Player> = {}): Player {
  return {
    id,
    name,
    title: null,
    sex: null,
    federation: "BEL",
    club: null,
    birth_year: null,
    fide_id: null,
    fide_rating: null,
    national_rating: null,
    rating: 1800,
    pairing_number: id,
    start_round: null,
    status: "active",
    absent: false,
    absent_rounds: [],
    present: false,
    byes: [],
    ...extra,
  };
}

describe("check-in", () => {
  it("ticks players present, counts them, and filters to who is not here yet", async () => {
    const api = fakeApi(round([]));
    api.players.mockResolvedValue([player(1, "Ann"), player(2, "Bob", { present: true }), player(3, "Cy", { status: "withdrawn" })]);
    api.updatePlayer.mockImplementation(async (_t: number, id: number, c: Record<string, unknown>) => player(id, "Ann", c));
    render(<PlayersScreen ctx={ctxWith(api)} t={tournament("owner")} />);

    expect((await el("#checkin-count")).textContent).toBe("1 of 2 present");
    fireEvent.click(document.querySelector("#checkin-toggle")!);
    fireEvent.click(document.querySelector("#present-1")!);

    await waitFor(() => expect(api.updatePlayer).toHaveBeenCalledWith(7, 1, { present: true }));
    await waitFor(() => expect(document.querySelector("#checkin-count")!.textContent).toBe("2 of 2 present"));

    fireEvent.click(document.querySelector("#checkin-missing")!);
    expect(document.querySelector("#present-1")).toBeNull();
    await screen.findByText("Everybody is here.");
  });

  it("puts the tick back when the server says no", async () => {
    const api = fakeApi(round([]));
    api.players.mockResolvedValue([player(1, "Ann")]);
    api.updatePlayer.mockRejectedValueOnce(new ApiError(422, "locked", "Not saved: the tournament is archived."));
    render(<PlayersScreen ctx={ctxWith(api)} t={tournament("owner")} />);

    fireEvent.click(await el("#checkin-toggle"));
    fireEvent.click(document.querySelector("#present-1")!);
    await screen.findByText(/archived/);
    expect(document.querySelector("#checkin-count")!.textContent).toBe("0 of 1 present");
  });
});

describe("adding players from a list", () => {
  const hit = (extra: Partial<SearchHit>): SearchHit => ({
    source: "fide",
    fide_id: 1503014,
    national_id: null,
    name: "Carlsen, Magnus",
    federation: "NOR",
    title: "GM",
    sex: "m",
    birth_year: 1990,
    fide_rating: 2830,
    national_rating: null,
    club: null,
    already_in: false,
    ...extra,
  });

  it("waits for three letters and the thumbs to stop, then adds the tapped one", async () => {
    const api = fakeApi(round([]));
    api.searchPlayers.mockResolvedValue([hit({}), hit({ fide_id: 2, name: "Carlsen, Henrik", already_in: true })]);
    render(<PlayersScreen ctx={ctxWith(api)} t={tournament("owner")} />);

    fireEvent.click(await el("#add-player"));
    await el("#source-bel");
    const input = document.querySelector("#player-search")!;
    fireEvent.input(input, { target: { value: "ca" } });
    fireEvent.input(input, { target: { value: "car" } });
    fireEvent.input(input, { target: { value: "carl" } });

    await el("#search-hits");
    expect(api.searchPlayers).toHaveBeenCalledTimes(1);
    expect(api.searchPlayers).toHaveBeenCalledWith(7, "carl", "fide");
    expect((document.querySelector("#hit-1") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(document.querySelector("#hit-0")!);
    await waitFor(() => expect(api.addPlayerFrom).toHaveBeenCalledWith(7, { source: "fide", fide_id: 1503014 }));
    await screen.findByText("Added");
    expect(api.players).toHaveBeenCalledTimes(2);
  });

  it("searches the Belgian list by its own id when switched to it", async () => {
    const api = fakeApi(round([]));
    api.searchPlayers.mockResolvedValue([hit({ source: "bel", national_id: 12345 })]);
    render(<PlayersScreen ctx={ctxWith(api)} t={tournament("owner")} />);

    fireEvent.click(await el("#add-player"));
    fireEvent.click(await el("#source-bel"));
    fireEvent.input(document.querySelector("#player-search")!, { target: { value: "Carlsen" } });
    fireEvent.click(await el("#hit-0"));

    await waitFor(() => expect(api.addPlayerFrom).toHaveBeenCalledWith(7, { source: "bel", national_id: 12345 }));
    expect(api.searchPlayers).toHaveBeenCalledWith(7, "Carlsen", "bel");
  });

  it("keeps entering by hand as the way out", async () => {
    const api = fakeApi(round([]));
    render(<PlayersScreen ctx={ctxWith(api)} t={tournament("owner")} />);

    fireEvent.click(await el("#add-player"));
    fireEvent.click(await el("#add-by-hand"));
    fireEvent.input(await el("#p-name"), { target: { value: "Hand, Made" } });
    fireEvent.submit(document.querySelector("form.form")!);
    await waitFor(() => expect(api.createPlayer).toHaveBeenCalledWith(7, expect.objectContaining({ name: "Hand, Made" })));
  });
});

describe("withdrawing a player", () => {
  it("asks first; re-entering does not", async () => {
    const api = fakeApi(round([]));
    api.players.mockResolvedValue([player(1, "Ann"), player(2, "Bob", { status: "withdrawn" })]);
    render(<PlayersScreen ctx={ctxWith(api)} t={tournament("owner")} />);

    fireEvent.click(await el("#player-1"));
    fireEvent.click(await el("#withdraw-player"));
    await screen.findByText(/Ann is left out of the next pairing/);
    expect(api.updatePlayer).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector("#withdraw-keep")!);
    fireEvent.click(await el("#withdraw-player"));
    fireEvent.click(await el("#withdraw-confirm"));
    await waitFor(() => expect(api.updatePlayer).toHaveBeenCalledWith(7, 1, { withdrawn: true }, []));
  });

  it("re-enters at once", async () => {
    const api = fakeApi(round([]));
    api.players.mockResolvedValue([player(2, "Bob", { status: "withdrawn" })]);
    render(<PlayersScreen ctx={ctxWith(api)} t={tournament("owner")} />);

    fireEvent.click(await el("#player-2"));
    fireEvent.click(await el("#withdraw-player"));
    await waitFor(() => expect(api.updatePlayer).toHaveBeenCalledWith(7, 2, { withdrawn: false }, []));
  });
});

describe("byes", () => {
  const kinds = {
    bye_kinds: [
      { id: "half", label: "Half-point bye" },
      { id: "zero", label: "Zero-point bye" },
    ],
  };

  it("are edited for unpaired rounds only, and the server's refusal is shown as it is", async () => {
    const api = fakeApi(round([]));
    api.players.mockResolvedValue([player(1, "Ann", { byes: [{ round: 1, kind: "half" }] })]);
    api.setByes.mockRejectedValueOnce(new ApiError(422, "bye_not_allowed", "Round 5 takes no half-point bye: it is one of the last two."));
    render(<PlayersScreen ctx={ctxWith(api)} t={{ ...tournament("owner"), ...kinds }} />);

    fireEvent.click(await el("#player-1"));
    expect((await el("#bye-1")).tagName).toBe("SPAN");
    expect(document.querySelector("#bye-1")!.textContent).toContain("Half-point bye");
    expect((document.querySelector("#save-byes") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(document.querySelector("#bye-5")!, { target: { value: "half" } });
    fireEvent.click(document.querySelector("#save-byes")!);

    await waitFor(() => expect(api.setByes).toHaveBeenCalledWith(7, 1, [{ round: 5, kind: "half" }]));
    await screen.findByText("Round 5 takes no half-point bye: it is one of the last two.");
  });
});

describe("the hall boards' word", () => {
  it("is shown beside the pairing, red when it differs, and never entered", async () => {
    const r = round([
      board(1, 1, { result: "1-0", board_report: { status: "finished", result: "0-1", mismatch: true, moves_count: 41, updated_at: "2026-11-07T14:32:05Z" } }),
      board(2, 2, { board_report: { status: "live", result: null, mismatch: false, moves_count: 23, updated_at: "2026-11-07T14:32:05Z" } }),
    ]);
    const api = fakeApi(r);
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("owner")} reloadTournament={async () => undefined} />);

    const one = await el("#board-report-1");
    expect(one.className).toContain("mismatch");
    expect(one.textContent).toContain("board 0-1");
    expect(document.querySelector("#board-report-2")!.textContent).toContain("playing · 23 moves");

    fireEvent.click(document.querySelector("#board-2")!);
    expect(document.querySelector(".result-grid .btn.primary")).toBeNull();
    expect(api.sync).not.toHaveBeenCalled();
    expect(outbox.count(server.base, 7)).toBe(0);
  });
});

describe("sharing", () => {
  it("shares the round's pairings with the OpenResults link", async () => {
    const { shareText } = await import("../platform");
    const api = fakeApi(round([board(1, 1, { result: "1-0" })]));
    const t = { ...tournament("arbiter"), openresults_url: "https://openresults.cloud/t/7" };
    render(<RoundScreen ctx={ctxWith(api)} t={t} reloadTournament={async () => undefined} />);

    fireEvent.click(await el("#share-round"));
    await waitFor(() => expect(shareText).toHaveBeenCalledWith("Hall Open, round 1", expect.stringContaining(" 1  White 1  1-0  Black 1")));
    expect((shareText as Mock).mock.calls.at(-1)![1]).toContain("https://openresults.cloud/t/7");
  });
});

describe("hall board codes", () => {
  it("makes a code, shows it once as a QR code, and revokes one after asking", async () => {
    const api = fakeApi(round([]));
    api.boardLinks.mockResolvedValue([{ id: 2, kind: "relay", label: "Bottom boards", reach: "hall", created_at: "", last_seen_at: null }]);
    render(<MoreScreen ctx={ctxWith(api)} t={tournament("owner")} />);

    fireEvent.click(await el("#new-board-link"));
    fireEvent.input(document.querySelector("#board-link-label")!, { target: { value: "Top boards" } });
    fireEvent.submit(document.querySelector("#board-link-form")!);

    await waitFor(() => expect(api.createBoardLink).toHaveBeenCalledWith(7, "Top boards"));
    expect((await el("#board-link-code")).textContent).toBe("alnasl_ONCE");
    await waitFor(() => expect(document.querySelector("#board-link-qr svg")).not.toBeNull());
    await screen.findByText(/Shown once/);

    fireEvent.click(await el("#revoke-link-2"));
    expect(api.revokeBoardLink).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector("#revoke-confirm")!);
    await waitFor(() => expect(api.revokeBoardLink).toHaveBeenCalledWith(7, 2));
  });

  it("are not offered to an arbiter", async () => {
    const api = fakeApi(round([]));
    render(<MoreScreen ctx={ctxWith(api)} t={tournament("arbiter")} />);
    expect(document.querySelector("#board-links-section")).toBeNull();
    expect(api.boardLinks).not.toHaveBeenCalled();
  });
});

describe("a new tournament", () => {
  it("starts from the server's defaults and opens what it made", async () => {
    const api = fakeApi(round([]));
    const created = vi.fn();
    render(<NewTournament ctx={ctxWith(api)} onCancel={() => undefined} onCreated={created} />);

    fireEvent.input(await el("#nt-name"), { target: { value: "  Hall Open  " } });
    fireEvent.input(document.querySelector("#nt-city")!, { target: { value: "Gent" } });
    fireEvent.change(document.querySelector("#nt-system")!, { target: { value: "round_robin" } });
    fireEvent.submit(document.querySelector("#new-tournament")!);

    await waitFor(() => expect(created).toHaveBeenCalledWith({ id: 9, name: "Hall Open" }));
    expect(api.createTournament).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Hall Open",
        city: "Gent",
        venue: null,
        system: "round_robin",
        rounds_count: 7,
        time_control: "90+30",
        federation: "BEL",
        rated: true,
      }),
    );
  });

  it("says it needs a connection rather than queueing it", async () => {
    const api = fakeApi(round([]));
    api.tournamentOptions.mockRejectedValueOnce(new OfflineError());
    render(<NewTournament ctx={ctxWith(api)} onCancel={() => undefined} onCreated={() => undefined} />);
    await screen.findByText(/No connection/);
    expect(document.querySelector("#new-tournament")).toBeNull();
  });
});

describe("the way back", () => {
  it("closes the sheet on top before it goes back a screen, and says when there is nothing left", () => {
    const screenBack = vi.fn();
    const sheetBack = vi.fn();
    const undoScreen = pushBack(screenBack, "screen");
    const undoSheet = pushBack(sheetBack);
    expect(goBack()).toBe(true);
    expect(sheetBack).toHaveBeenCalledTimes(1);
    expect(screenBack).not.toHaveBeenCalled();
    undoSheet();
    expect(goBack()).toBe(true);
    expect(screenBack).toHaveBeenCalledTimes(1);
    undoScreen();
    expect(goBack()).toBe(false);
  });

  it("closes a sheet, which takes the focus while it is open", async () => {
    const closed = vi.fn();
    render(
      <Sheet title="A sheet" onClose={closed}>
        <p>Inside</p>
      </Sheet>,
    );
    await waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("dialog"));
    expect(goBack()).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("leaves a sticky sheet alone, from the back button and from the backdrop", () => {
    const closed = vi.fn();
    render(
      <Sheet title="The code" onClose={closed} sticky>
        <p>Shown once</p>
      </Sheet>,
    );
    expect(goBack()).toBe(true); // the step is taken, and goes nowhere
    fireEvent.click(document.querySelector(".sheet-backdrop")!);
    expect(closed).not.toHaveBeenCalled();
  });

  it("keeps a hall board code on screen when the backdrop is tapped", async () => {
    const api = fakeApi(round([]));
    render(<MoreScreen ctx={ctxWith(api)} t={tournament("owner")} />);
    fireEvent.click(await el("#new-board-link"));
    fireEvent.submit(document.querySelector("#board-link-form")!);
    await el("#board-link-code");
    fireEvent.click(document.querySelector(".sheet-backdrop")!);
    expect(document.querySelector("#board-link-code")).not.toBeNull();
  });
});

describe("a load that failed", () => {
  it("offers the tournaments again", async () => {
    const api = fakeApi(round([]));
    (api as unknown as { tournaments: Mock }).tournaments = vi.fn().mockRejectedValueOnce(new OfflineError()).mockResolvedValue([]);
    render(<Tournaments ctx={ctxWith(api)} onServers={() => undefined} onNew={() => undefined} onOpen={() => undefined} />);
    fireEvent.click(await el("#tournaments-retry"));
    await screen.findByText(/No tournaments/);
  });

  it("offers the tournament again", async () => {
    const api = fakeApi(round([]));
    (api as unknown as { tournament: Mock }).tournament = vi.fn().mockRejectedValueOnce(new OfflineError()).mockResolvedValue(tournament("arbiter"));
    render(<TournamentView ctx={ctxWith(api)} line={{ id: 7, name: "Hall Open" } as never} onBack={() => undefined} />);
    fireEvent.click(await el("#tournament-retry"));
    await el("#boards");
  });

  it("offers the standings and the players again", async () => {
    const api = fakeApi(round([]));
    api.standings.mockRejectedValueOnce(new OfflineError());
    render(<StandingsScreen ctx={ctxWith(api)} t={tournament("owner")} />);
    fireEvent.click(await el("#standings-retry"));
    await screen.findByText("No players yet.");

    cleanup();
    api.players.mockRejectedValueOnce(new OfflineError());
    render(<PlayersScreen ctx={ctxWith(api)} t={tournament("owner")} />);
    fireEvent.click(await el("#players-retry"));
    await screen.findByText("No players yet.");
  });
});

describe("a read-only tournament", () => {
  it("says why nothing can be tapped", async () => {
    const api = fakeApi(round([board(1, 1)]));
    (api as unknown as { tournament: Mock }).tournament = vi.fn().mockResolvedValue({ ...tournament("owner"), read_only: true, archived: true });
    render(<TournamentView ctx={ctxWith(api)} line={{ id: 7, name: "Hall Open" } as never} onBack={() => undefined} />);
    await screen.findByText(/This tournament is archived/);
    expect(((await el("#board-1")) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("words, not tokens", () => {
  it("names incident kinds and settings as a person would", () => {
    expect(incidentKind("illegal_move")).toBe("Illegal move");
    expect(incidentKind("brand_new")).toBe("brand new");
    expect(settingValue("type", "team-swiss")).toBe("Team Swiss");
    expect(settingValue("publish_mode", "manual")).toBe("By hand");
    expect(settingValue("bye_value", 0.5)).toBe("½ point");
    expect(settingValue("fide_rated", true)).toBe("Yes");
    expect(settingValue("city", "Gent")).toBe("Gent");
  });

  it("shows the outbox's results with the glyph, and lets a refused one be dismissed under More", async () => {
    const api = fakeApi(round([]));
    await outbox.addResult(server.base, 7, { round: 1, pairing: 1, board: 1, white: 11, black: 12, result: "1/2-1/2", expected: "" }, "1");
    await outbox.flush(server.base, 7, async (entries) =>
      entries.map((e) => ({ cid: e.cid, status: "refused" as const, reason: "changed", message: "Board 1: changed meanwhile." })),
    );
    render(<MoreScreen ctx={ctxWith(api)} t={tournament("arbiter")} />);
    await screen.findByText(/board 1: ½-½/);
    fireEvent.click(await el("#dismiss-cid-1"));
    await waitFor(() => expect(outbox.count(server.base, 7)).toBe(0));
  });

  it("shows tie-breaks by name and incident kinds by label", async () => {
    const api = fakeApi(round([]));
    api.incidents.mockResolvedValue([
      { id: 1, round: 1, board: 2, kind: "illegal_move", note: "", white: null, black: null, occurred_at: "", by: null, has_photo: true },
    ]);
    const t = { ...tournament("owner"), settings: { tiebreaks: ["BH"], tiebreak_options: [{ code: "BH", name: "Buchholz" }] } };
    render(<MoreScreen ctx={ctxWith(api)} t={t} />);
    await screen.findByText(/Illegal move/);
    expect(document.querySelector("#settings")!.textContent).toContain("Buchholz");
  });

  it("shows an unrated player's score without a stray dot", async () => {
    const api = fakeApi(round([board(1, 1, { white: { id: 11, name: "Unrated", title: null, rating: null, score: 1.5 } })]));
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("arbiter")} reloadTournament={async () => undefined} />);
    expect((await el("#board-1 .name small")).textContent).toBe("1.5");
  });
});

describe("saving byes", () => {
  it("keeps the player's sheet open, with what was typed above it", async () => {
    const api = fakeApi(round([]));
    api.players.mockResolvedValue([player(1, "Ann")]);
    const t = { ...tournament("owner"), bye_kinds: [{ id: "half", label: "Half-point bye" }] };
    render(<PlayersScreen ctx={ctxWith(api)} t={t} />);

    fireEvent.click(await el("#player-1"));
    fireEvent.input(await el("#p-club"), { target: { value: "KSK" } });
    fireEvent.change(document.querySelector("#bye-3")!, { target: { value: "half" } });
    fireEvent.click(document.querySelector("#save-byes")!);

    await screen.findByText("Byes saved.");
    expect((document.querySelector("#p-club") as HTMLInputElement).value).toBe("KSK");
    expect((document.querySelector("#save-byes") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("undoing a round", () => {
  it("can be called off from the question itself", async () => {
    const api = fakeApi(round([board(1, 1)]));
    render(<RoundScreen ctx={ctxWith(api)} t={tournament("owner")} reloadTournament={async () => undefined} />);
    fireEvent.click(await el("#desk-actions"));
    fireEvent.click(await screen.findByText("Undo round 1"));
    fireEvent.click(await el("#unpair-keep"));
    await screen.findByText("Undo round 1");
  });
});
