// @vitest-environment happy-dom
//
// A relayed tournament on screen: the banner, and the writes sent to the
// laptop - waiting for the desk, done, refused, or the desk's question -
// against a fake API that answers what the contract's examples show.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client, Tournament } from "../api";
import { Outbox, type KeyValue } from "../queue";
import { CommandBook, RelayedWrite, type RelayCommand } from "../relay";
import type { SavedServer } from "../servers";
import type { Ctx } from "./App";
import { describeError, Notice } from "./common";
import { RelayBanner, RelayCommands } from "./RelayCommands";
import { HallRoutes } from "../hall";
import { examples } from "../contract.testkit";

vi.mock("../platform", () => ({
  native: false,
  platform: "web",
  onResume: () => () => undefined,
}));

class Memory implements KeyValue {
  data = new Map<string, string>();
  async get(k: string) {
    return this.data.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.data.set(k, v);
  }
}

const server: SavedServer = {
  base: "https://pairings.example",
  token: "tok",
  label: "pairings.example",
  user: { email: "a@b", name: null },
  info: { name: "OpenPairings", version: "1", api: 1, desktop: false },
  deviceId: 1,
  addedAt: "",
};

const tournament = (): Tournament => ({
  ...(structuredClone(examples["tournament-response.json"]) as { tournament: Tournament }).tournament,
  relay: { label: "laptop Hall", since: null, last_seen_at: "2026-11-19T23:40:00Z", mirrored_at: null },
});
const pending = (): RelayCommand => (structuredClone(examples["command-response.pending.json"]) as { command: RelayCommand }).command;

afterEach(cleanup);

async function setup(api: Partial<Client>, command: RelayCommand) {
  const commands = new CommandBook(new Memory(), () => 0);
  await commands.add(server.base, tournament().id, command, { method: "PATCH", path: `/tournaments/${tournament().id}/players/6`, body: { player: { present: false }, acknowledged: [] } });
  const ctx: Ctx = { server, api: api as Client, outbox: new Outbox(new Memory()), commands, bump: () => undefined };
  const answered = vi.fn();
  const view = render(<RelayCommands ctx={ctx} t={tournament()} onAnswered={answered} />);
  return { ctx, commands, answered, view };
}

describe("a relayed tournament", () => {
  it("says at the top that the laptop runs it, through the cloud until the laptop has answered here", () => {
    render(<RelayBanner t={tournament()} base={server.base} routes={new HallRoutes()} />);
    const banner = document.querySelector("#relay-banner")!;
    expect(banner.textContent).toContain("Run from the laptop (laptop Hall).");
    expect(document.querySelector("#relay-path")!.textContent).toBe("Through the cloud.");
    expect(banner.textContent).toContain("Last heard from it at");
  });

  it("says when this phone talks to the laptop in the hall, and when it went back to the cloud", async () => {
    const routes = new HallRoutes();
    const t = tournament();
    routes.set(server.base, t.id, { urls: ["http://192.168.1.20:4748"], tournament_id: 2, seen_at: null, token: "oph1.x", expires_at: "2099-01-01T00:00:00Z" });
    render(<RelayBanner t={t} base={server.base} routes={routes} />);
    expect(document.querySelector("#relay-path")!.textContent).toBe("Through the cloud.");
    act(() => routes.reached(server.base, t.id, "http://192.168.1.20:4748"));
    await waitFor(() => expect(document.querySelector("#relay-path")!.textContent).toBe("Connected to the laptop in the hall."));
    expect(document.querySelector("#relay-banner")!.getAttribute("data-path")).toBe("hall");
    act(() => routes.cloud(server.base, t.id));
    await waitFor(() => expect(document.querySelector("#relay-path")!.textContent).toBe("Through the cloud."));
  });

  it("says nothing for a tournament that is not relayed", () => {
    const { container } = render(<RelayBanner t={{ ...tournament(), relay: null }} base={server.base} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows a write as sent, waiting for the desk, until the laptop has answered; then done", async () => {
    let state: RelayCommand["state"] = "pending";
    const relayCommand = vi.fn(async () => ({ ...pending(), state, status: state === "accepted" ? 200 : null }));
    const { commands, answered, view } = await setup({ relayCommand }, pending());
    await waitFor(() => expect(relayCommand).toHaveBeenCalled());
    expect(document.getElementById(`relay-pending-${pending().cid}`)).toBeTruthy();
    expect(answered).not.toHaveBeenCalled();

    state = "accepted";
    await commands.wake(server.base, tournament().id);
    view.rerender(<RelayCommands ctx={{ server, api: { relayCommand } as unknown as Client, outbox: new Outbox(new Memory()), commands, bump: () => undefined }} t={{ ...tournament() }} onAnswered={answered} />);
    // Waking happens on resume; here the next timer tick asks.
    await waitFor(() => expect(answered).toHaveBeenCalled(), { timeout: 6000 });
    expect(commands.list(server.base, tournament().id)[0].command.state).toBe("accepted");
  });

  it("shows a refusal with the desk's own sentence until it is dismissed", async () => {
    const refused = { ...pending(), state: "refused" as const, status: 400, error: "bad_request", message: "The level is 0, 1, 2 or 3." };
    const { commands } = await setup({ relayCommand: vi.fn() }, refused);
    expect(await screen.findByText(/The level is 0, 1, 2 or 3\./)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Dismiss"));
    await waitFor(() => expect(commands.list(server.base, tournament().id)).toEqual([]));
  });

  it("asks the desk's question, and sends the write again with acknowledged when the arbiter goes ahead", async () => {
    const question: RelayCommand = {
      ...pending(),
      state: "refused",
      status: 409,
      error: "needs_acknowledgement",
      message: "Check first.",
      response: { confirm: ["rated"], summary: "A rated player changes.", warnings: ["Round 3 was already sent."] },
    };
    const resend = vi.fn(async () => {
      throw new RelayedWrite(2, { ...pending(), cid: "new-key" }, { method: "PATCH", path: "/tournaments/2/players/6" });
    });
    const { commands } = await setup({ relayCommand: vi.fn(), resend }, question);
    expect(await screen.findByText(/A rated player changes\./)).toBeTruthy();
    expect(screen.getByText("Round 3 was already sent.")).toBeTruthy();
    fireEvent.click(document.getElementById(`relay-ask-yes-${question.cid}`)!);
    await waitFor(() => expect(resend).toHaveBeenCalled());
    expect(resend).toHaveBeenCalledWith({
      method: "PATCH",
      path: `/tournaments/${tournament().id}/players/6`,
      body: { player: { present: false }, acknowledged: ["rated"] },
    });
    await waitFor(() => expect(commands.list(server.base, tournament().id).map((k) => k.command.cid)).not.toContain(question.cid));
  });

  it("does not show a write sent to the laptop as a failure on the screen that sent it", () => {
    const text = describeError(new RelayedWrite(2, pending(), { method: "POST", path: "/tournaments/2/rounds" }));
    expect(text).toBe("Sent to the laptop, waiting for the desk.");
    render(<Notice kind="error">{text}</Notice>);
    expect(screen.getByRole("status").className).toContain("info");
  });
});
