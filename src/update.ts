// The update check of the Android build, which does not come from a store
// and so has nobody else to tell it about a new version. On start, at most
// once a day, it asks GitHub for the latest release of Manubrium and offers
// the release's manubrium.apk when that is newer than what is installed.
//
// The download goes to the phone's browser, not to an installer of our
// own: Capacitor hands any link off the app's own origin to the system
// (Bridge.launchIntent, ACTION_VIEW), the browser downloads the file with
// its own progress and resume, and tapping it brings up Android's package
// installer - the same screen REQUEST_INSTALL_PACKAGES and a FileProvider
// would have led to, minus a sensitive permission, a native plug-in and a
// half-downloaded file in our cache when the hall's wifi drops. Android
// checks the signature: an apk signed with any other key than ours does
// not install over the app.
//
// The request carries nothing about the phone, the account or the
// tournaments: an anonymous GET of a public URL (store/privacy-policy.md).

import type { KeyValue } from "./queue";

export const RELEASES_API = "https://api.github.com/repos/teapot-chess/Manubrium/releases/latest";
export const APK_NAME = "manubrium.apk";
export const UPDATE_KEY = "manubrium.update.v1";
export const CHECK_EVERY = 24 * 60 * 60 * 1000;

export interface Update {
  version: string;
  url: string;
}

/** "v1.7.0" or "1.7.0" as [1, 7, 0]; null for anything that is not three numbers. */
export function parseVersion(text: string | null | undefined): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec((text ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Whether `latest` is a later version than `current`; false when either is unreadable. */
export function newer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** The update in GitHub's answer for the latest release, or null: a draft, a pre-release, no apk. */
export function releaseUpdate(body: unknown): Update | null {
  if (!body || typeof body !== "object") return null;
  const r = body as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };
  if (r.draft === true || r.prerelease === true || typeof r.tag_name !== "string") return null;
  const version = parseVersion(r.tag_name);
  if (!version || !Array.isArray(r.assets)) return null;
  const apk = r.assets.find((a) => a && typeof a === "object" && (a as { name?: unknown }).name === APK_NAME) as
    | { browser_download_url?: unknown }
    | undefined;
  const url = apk?.browser_download_url;
  if (typeof url !== "string" || !url.startsWith("https://github.com/")) return null;
  return { version: version.join("."), url };
}

interface Checked {
  at: number;
}

async function lastChecked(store: KeyValue): Promise<number> {
  try {
    const raw = await store.get(UPDATE_KEY);
    const at = raw ? (JSON.parse(raw) as Partial<Checked>).at : undefined;
    return typeof at === "number" && Number.isFinite(at) ? at : 0;
  } catch {
    return 0;
  }
}

export type UpdateAnswer = { kind: "update"; update: Update } | { kind: "current" } | { kind: "skipped" } | { kind: "failed" };

/**
 * Asks GitHub whether there is a newer Manubrium than `current`. Without
 * `force` it asks at most once per CHECK_EVERY; only an answer counts as
 * having asked, so a phone that starts offline asks again on the next start.
 */
export async function checkForUpdate(o: {
  current: string;
  store: KeyValue;
  fetch: typeof fetch;
  now?: number;
  force?: boolean;
}): Promise<UpdateAnswer> {
  const now = o.now ?? Date.now();
  if (!o.force) {
    const at = await lastChecked(o.store);
    if (at <= now && now - at < CHECK_EVERY) return { kind: "skipped" };
  }
  let body: unknown;
  try {
    const res = await o.fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Manubrium" } });
    if (!res.ok) return { kind: "failed" };
    body = await res.json();
  } catch {
    return { kind: "failed" };
  }
  await o.store.set(UPDATE_KEY, JSON.stringify({ at: now } satisfies Checked)).catch(() => undefined);
  const update = releaseUpdate(body);
  return update && newer(update.version, o.current) ? { kind: "update", update } : { kind: "current" };
}
