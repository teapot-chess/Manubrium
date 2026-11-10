// The way out when the lock's code cannot be read any more (the Keystore lost
// its key, a restore brought the settings but not the Keychain). Reinstalling
// would do it, and would also throw away the results still waiting to be
// sent; this does not touch the outbox.

import type { PendingRevokes } from "./revoke";
import type { ServerList } from "./servers";

/**
 * Signs the phone out of every server: each token is parked for a revoke the
 * server will hear when it can (see revoke.ts), then the server list is
 * emptied. The outbox is left alone: connect the same server again and what
 * is waiting goes out.
 */
export async function signOutEverywhere(servers: ServerList, pending: PendingRevokes): Promise<number> {
  const all = await servers.all().catch(() => []);
  for (const s of all) {
    await pending.add(s.base, s.token, s.label);
    await servers.remove(s.base);
  }
  void pending.retry().catch(() => undefined);
  return all.length;
}
