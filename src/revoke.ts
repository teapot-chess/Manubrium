// Sign-outs the server has not heard yet. Removing a server while the phone
// is offline throws the token away locally, which would leave the device
// valid on the account with nobody holding its key. So the token goes here
// first (the Keychain / Keystore, like every other token) and the revoke is
// retried until the server answers or says it no longer knows the phone.

import { ApiError, client as makeClient, type Client } from "./api";
import type { KeyValue } from "./queue";

export const REVOKE_KEY = "manubrium.revoke.v1";

/** A server that never answers is given up on after this long. */
export const REVOKE_GIVE_UP_MS = 90 * 24 * 3600 * 1000;

export interface PendingRevoke {
  base: string;
  token: string;
  label: string;
  addedAt: number;
}

type Revoker = Pick<Client, "signOut" | "unregisterPush">;

const gone = (e: unknown) => e instanceof ApiError && (e.status === 401 || e.status === 403);

export class PendingRevokes {
  private running: Promise<number> | null = null;

  constructor(
    private readonly store: KeyValue,
    private readonly make: (base: string, token: string) => Revoker = makeClient,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<PendingRevoke[]> {
    try {
      const parsed = JSON.parse((await this.store.get(REVOKE_KEY)) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.base === "string" && typeof p.token === "string") : [];
    } catch {
      return [];
    }
  }

  private save(all: PendingRevoke[]): Promise<void> {
    return this.store.set(REVOKE_KEY, JSON.stringify(all));
  }

  async add(base: string, token: string, label: string): Promise<void> {
    const rest = (await this.list()).filter((p) => !(p.base === base && p.token === token));
    await this.save([...rest, { base, token, label, addedAt: this.now() }]);
  }

  /** Tries every pending revoke once; resolves to how many are still waiting. */
  retry(): Promise<number> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<number> {
    const all = await this.list();
    const waiting: PendingRevoke[] = [];
    for (const p of all) {
      if (this.now() - p.addedAt > REVOKE_GIVE_UP_MS) continue;
      if (!(await this.revoke(p))) waiting.push(p);
    }
    // Entries added while this ran must not be lost.
    const fresh = (await this.list()).filter((p) => !all.some((a) => a.base === p.base && a.token === p.token));
    await this.save([...waiting, ...fresh]);
    return waiting.length + fresh.length;
  }

  /** True when the server is done with this phone: revoked now, or no longer knowing it. */
  private async revoke(p: PendingRevoke): Promise<boolean> {
    const api = this.make(p.base, p.token);
    try {
      await api.unregisterPush();
    } catch (e) {
      if (gone(e)) return true;
      // "No push registration here" is not a reason to keep the phone signed in.
      const refused = e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
      if (!refused) return false;
    }
    try {
      await api.signOut();
      return true;
    } catch (e) {
      return gone(e);
    }
  }
}
