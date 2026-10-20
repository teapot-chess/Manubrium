// The servers this phone is connected to, each with its own device token.
// Kept in the app's preferences (see platform.ts and the README's note on
// where tokens live).

import type { KeyValue } from "./queue";
import type { ServerInfo, UserInfo } from "./api";

export interface SavedServer {
  /** The base URL; also the server's id in the app. */
  base: string;
  token: string;
  label: string;
  user: UserInfo;
  info: ServerInfo;
  deviceId: number;
  addedAt: string;
}

const KEY = "manubrium.servers.v1";
const CURRENT = "manubrium.current.v1";

export class ServerList {
  constructor(private readonly store: KeyValue) {}

  async all(): Promise<SavedServer[]> {
    const raw = await this.store.get(KEY);
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** Adds a server, or replaces the one at the same address (a reconnect). */
  async put(server: SavedServer): Promise<void> {
    const rest = (await this.all()).filter((s) => s.base !== server.base);
    await this.store.set(KEY, JSON.stringify([...rest, server]));
    await this.setCurrent(server.base);
  }

  async remove(base: string): Promise<void> {
    const rest = (await this.all()).filter((s) => s.base !== base);
    await this.store.set(KEY, JSON.stringify(rest));
    if ((await this.current()) === base) await this.setCurrent(rest[0]?.base ?? "");
  }

  async current(): Promise<string | null> {
    return (await this.store.get(CURRENT)) || null;
  }

  async setCurrent(base: string): Promise<void> {
    await this.store.set(CURRENT, base);
  }
}

/** A name for a server in the list: its host, or the account's server name. */
export function labelFor(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}
