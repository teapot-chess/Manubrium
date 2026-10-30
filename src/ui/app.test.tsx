// @vitest-environment happy-dom
//
// The shell: a connect link from outside the app waits for a yes, a second
// link is not swallowed by the first, and a sign-out the server never heard
// is said out loud.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfflineError } from "../api";
import { resetBack } from "../back";

const h = vi.hoisted(() => {
  const store = () => {
    const data = new Map<string, string>();
    return {
      data,
      get: async (k: string) => data.get(k) ?? null,
      set: async (k: string, v: string) => void data.set(k, v),
    };
  };
  return {
    secure: store(),
    plain: store(),
    openLink: null as null | ((url: string) => void),
    connect: vi.fn(),
    signOut: vi.fn(),
  };
});

vi.mock("../platform", () => ({
  secureStorage: h.secure,
  storage: h.plain,
  native: false,
  platform: "web",
  deviceName: async () => "Test phone",
  scanQr: async () => null,
  onOpenLink: (handler: (url: string) => void) => {
    h.openLink = handler;
  },
  onBackButton: () => () => undefined,
  onResume: () => () => undefined,
  takePhoto: async () => null,
  shareText: async () => "shared",
}));

vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  connect: h.connect,
  client: () => ({
    tournaments: async () => [],
    signOut: h.signOut,
  }),
}));

import { App } from "./App";

const saved = {
  base: "https://pairings.example",
  token: "mnb_t",
  label: "pairings.example",
  user: { email: "a@example.org", name: null },
  info: { name: "OpenPairings", version: "1", api: 1, desktop: false },
  deviceId: 1,
  addedAt: "2026-10-21T00:00:00Z",
};

const link = (host: string, secret = "s3cret") => `manubrium://connect?server=${encodeURIComponent(`https://${host}`)}&secret=${secret}`;
const answer = (host: string) => ({ token: `tok-${host}`, user: saved.user, server: saved.info, device: { id: 2 } });

beforeEach(() => {
  h.secure.data.clear();
  h.plain.data.clear();
  h.secure.data.set("manubrium.servers.v1", JSON.stringify([saved]));
  h.secure.data.set("manubrium.current.v1", saved.base);
  h.openLink = null;
  h.connect.mockReset();
  h.signOut.mockReset();
});

afterEach(() => {
  cleanup();
  resetBack();
});

const el = (selector: string) =>
  waitFor(() => {
    const found = document.querySelector(selector);
    if (!found) throw new Error(`${selector} not rendered`);
    return found;
  });

async function opened() {
  render(<App />);
  await screen.findByText("Tournaments");
  await waitFor(() => expect(h.openLink).not.toBeNull());
}

describe("a connect link from outside the app", () => {
  it("asks first, and connects to nothing until the answer is yes", async () => {
    await opened();
    h.openLink!(link("other.example"));
    await screen.findByText("Connect to other.example?");
    expect(h.connect).not.toHaveBeenCalled();
    // The screen underneath was not thrown away.
    expect(document.querySelector("#switch-server")).not.toBeNull();

    fireEvent.click(document.querySelector("#connect-link-no")!);
    expect(h.connect).not.toHaveBeenCalled();
    expect(screen.queryByText("Connect to other.example?")).toBeNull();
    expect(document.querySelector("#switch-server")).not.toBeNull();
  });

  it("connects after a yes", async () => {
    h.connect.mockResolvedValue(answer("other.example"));
    await opened();
    h.openLink!(link("other.example"));
    fireEvent.click(await el("#connect-link-yes"));
    await waitFor(() => expect(h.connect).toHaveBeenCalledTimes(1));
    expect(h.connect.mock.calls[0].slice(0, 2)).toEqual(["https://other.example", "s3cret"]);
  });

  it("does not let a second link be swallowed by the first", async () => {
    h.connect.mockRejectedValueOnce(new OfflineError()).mockResolvedValue(answer("second.example"));
    await opened();
    h.openLink!(link("first.example", "one"));
    fireEvent.click(await el("#connect-link-yes"));
    await waitFor(() => expect(h.connect).toHaveBeenCalledTimes(1));

    h.openLink!(link("second.example", "two"));
    await screen.findByText("Connect to second.example?");
    fireEvent.click(document.querySelector("#connect-link-yes")!);
    await waitFor(() => expect(h.connect).toHaveBeenCalledTimes(2));
    expect(h.connect.mock.calls[1].slice(0, 2)).toEqual(["https://second.example", "two"]);
  });

  it("sends a link that is no connect link to the add screen, which connects to nothing", async () => {
    await opened();
    h.openLink!("manubrium://elsewhere?x=1");
    await waitFor(() => expect(document.querySelector("#link")).not.toBeNull());
    expect(h.connect).not.toHaveBeenCalled();
  });
});

describe("signing a server out", () => {
  async function removeFirst() {
    await opened();
    fireEvent.click(document.querySelector("#switch-server")!);
    fireEvent.click(await screen.findByLabelText("Remove pairings.example"));
    fireEvent.click(await screen.findByText("Sign out and remove"));
  }

  it("says so when the server was never told", async () => {
    h.signOut.mockRejectedValue(new OfflineError());
    h.secure.data.set("manubrium.servers.v1", JSON.stringify([saved, { ...saved, base: "https://b.example", label: "b.example" }]));
    await removeFirst();
    await screen.findByText(/could not be reached, so this phone's access there may still be active/);
  });
});

describe("a stored server address", () => {
  it("is checked again on load: plain http to a public address is left out, with a word", async () => {
    h.secure.data.set(
      "manubrium.servers.v1",
      JSON.stringify([saved, { ...saved, base: "http://public.example", label: "public.example" }]),
    );
    await opened();
    fireEvent.click(document.querySelector("#switch-server")!);
    await screen.findByText(/public\.example is saved with an address this app no longer accepts/);
    expect(screen.queryByLabelText("Remove public.example")).toBeNull();
  });
});
