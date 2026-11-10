// The app's long-lived stores, shared by the shell and the lock screen.

import { secureStorage } from "./platform";
import { PendingRevokes } from "./revoke";
import { ServerList } from "./servers";

/** Tokens: Keychain / Keystore. */
export const serverList = new ServerList(secureStorage);
export const pendingRevokes = new PendingRevokes(secureStorage);
