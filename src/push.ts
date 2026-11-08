// Push notifications: the phone's half. The server decides what to send and
// to whom (OpenPairings' PairingsEngine.Push); this file asks the phone for
// permission at a moment that makes sense, hands the token to every server
// that can use it, and turns a tapped notification back into a screen.
//
// Never at first launch: the first round on screen offers it once, and the
// Servers screen can switch it on later. A server without push keys says so
// (`available: false`) and is left alone.

import type { Client, PushEnvironment, PushEvent, PushPlatform, PushStatus } from "./api";
import type { KeyValue } from "./queue";
import type { SavedServer } from "./servers";

export type Permission = "granted" | "denied" | "prompt";

/** What the phone does; a fake in tests, Capacitor on a phone (pushNative.ts). */
export interface PushBackend {
  /** Null: this build cannot push at all (a browser, an Android build without Firebase). */
  platform: PushPlatform | null;
  environment(): Promise<PushEnvironment>;
  check(): Promise<Permission>;
  request(): Promise<Permission>;
  /** Registers with APNs or FCM and resolves with the device token. */
  token(): Promise<string>;
  /** A notification the person tapped, with the server's `data`. */
  onTap(handler: (data: Record<string, unknown>) => void): void;
}

export const ASKED_KEY = "manubrium.push.asked.v1";
export const TOKEN_KEY = "manubrium.push.token.v1";
export const LIVE_KEY = "manubrium.push.live.v1";

/** Whether this server can push to this kind of phone. */
export function serverCanPush(status: PushStatus | null, platform: PushPlatform | null): boolean {
  return !!(status && platform && status.available && status.platforms[platform]);
}

/** Whether to offer notifications on the round screen: once, and only where they would work. */
export function shouldOffer(o: { platform: PushPlatform | null; permission: Permission; asked: boolean; status: PushStatus | null }): boolean {
  return !o.asked && o.permission === "prompt" && serverCanPush(o.status, o.platform);
}

/** The events with one switched on or off, in the server's order. */
export function withEvent(all: PushEvent[], chosen: PushEvent[], event: PushEvent, on: boolean): PushEvent[] {
  return all.filter((e) => (e === event ? on : chosen.includes(e)));
}

/**
 * Where a tapped notification goes: the server it came from (`tag` is what
 * the app registered with, the server's base) and the tournament. Null when
 * the phone no longer has that server.
 */
export function tapTarget(data: Record<string, unknown>, servers: SavedServer[]): { base: string; tournament: number } | null {
  const tournament = Number(data.tournament);
  if (!Number.isInteger(tournament) || tournament <= 0) return null;
  const tag = typeof data.tag === "string" ? data.tag : "";
  const server = servers.find((s) => s.base === tag) ?? (servers.length === 1 && !tag ? servers[0] : undefined);
  return server ? { base: server.base, tournament } : null;
}

export class PushManager {
  constructor(
    readonly backend: PushBackend,
    private readonly store: KeyValue,
    private readonly api: (server: SavedServer) => Client,
  ) {}

  get platform(): PushPlatform | null {
    return this.backend.platform;
  }

  async asked(): Promise<boolean> {
    return (await this.store.get(ASKED_KEY)) !== null;
  }

  async permission(): Promise<Permission> {
    if (!this.backend.platform) return "denied";
    try {
      return await this.backend.check();
    } catch {
      return "denied";
    }
  }

  /** "Not now": the round screen stops offering. */
  async decline(): Promise<void> {
    await this.store.set(ASKED_KEY, "no");
  }

  /** Asks the phone, and registers with every server that can push if it says yes. */
  async enable(servers: SavedServer[]): Promise<Permission> {
    await this.store.set(ASKED_KEY, "yes");
    if (!this.backend.platform) return "denied";
    const answer = await this.backend.request().catch((): Permission => "denied");
    if (answer === "granted") await this.refresh(servers);
    return answer;
  }

  /**
   * With permission already given: fetches the token (it can change) and
   * registers it with every server that can push. Leaves each server's
   * choice of events as it is. Quiet: a server out of reach tries again on
   * the next start.
   */
  async refresh(servers: SavedServer[]): Promise<void> {
    if ((await this.permission()) !== "granted") return;
    const platform = this.backend.platform!;
    let token: string;
    try {
      token = await this.backend.token();
    } catch {
      return;
    }
    await this.store.set(TOKEN_KEY, token);
    const environment = await this.backend.environment();
    await Promise.all(
      servers.map(async (s) => {
        try {
          const api = this.api(s);
          if (!serverCanPush(await api.pushStatus(), platform)) return;
          await api.registerPush({ platform, token, environment, tag: s.base });
        } catch {
          // Offline, or an older server without /push: nothing to do.
        }
      }),
    );
  }

  /** Changes which events one server sends this phone. Null when the phone has no token yet. */
  async setEvents(server: SavedServer, events: PushEvent[]): Promise<PushStatus | null> {
    const token = await this.store.get(TOKEN_KEY);
    if (!token || !this.backend.platform) return null;
    return this.api(server).registerPush({
      platform: this.backend.platform,
      token,
      environment: await this.backend.environment(),
      events,
      tag: server.base,
    });
  }

  /** The lock-screen round progress, on unless switched off. */
  async liveActivities(): Promise<boolean> {
    return (await this.store.get(LIVE_KEY)) !== "off";
  }

  async setLiveActivities(on: boolean): Promise<void> {
    await this.store.set(LIVE_KEY, on ? "on" : "off");
  }
}
