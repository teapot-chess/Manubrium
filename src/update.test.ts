import { describe, expect, it } from "vitest";
import { CHECK_EVERY, checkForUpdate, newer, parseVersion, releaseUpdate, RELEASES_API, UPDATE_KEY } from "./update";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(key: string) {
      return data.get(key) ?? null;
    },
    async set(key: string, value: string) {
      data.set(key, value);
    },
  };
}

const release = (tag: string, assets: { name: string; browser_download_url: string }[], extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets,
  ...extra,
});
const apk = (tag: string) => ({ name: "manubrium.apk", browser_download_url: `https://github.com/teapot-chess/Manubrium/releases/download/${tag}/manubrium.apk` });

function answering(body: unknown, status = 200) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("versions", () => {
  it("reads a tag or a version, and nothing else", () => {
    expect(parseVersion("v1.7.0")).toEqual([1, 7, 0]);
    expect(parseVersion("1.12.3")).toEqual([1, 12, 3]);
    expect(parseVersion("1.7")).toBeNull();
    expect(parseVersion("v1.7.0-beta")).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });

  it("compares numerically, not as text", () => {
    expect(newer("1.10.0", "1.9.9")).toBe(true);
    expect(newer("1.7.0", "1.7.0")).toBe(false);
    expect(newer("1.6.9", "1.7.0")).toBe(false);
    expect(newer("2.0.0", "garbage")).toBe(false);
  });
});

describe("the latest release", () => {
  it("offers the release's manubrium.apk", () => {
    expect(releaseUpdate(release("v1.7.0", [apk("v1.7.0")]))).toEqual({ version: "1.7.0", url: apk("v1.7.0").browser_download_url });
  });

  it("ignores a release without the apk, a draft, a pre-release and an apk somewhere else", () => {
    expect(releaseUpdate(release("v1.7.0", [{ name: "Manubrium-1.7.0-9.apk", browser_download_url: "https://github.com/x" }]))).toBeNull();
    expect(releaseUpdate(release("v1.7.0", [apk("v1.7.0")], { draft: true }))).toBeNull();
    expect(releaseUpdate(release("v1.7.0", [apk("v1.7.0")], { prerelease: true }))).toBeNull();
    expect(releaseUpdate(release("v1.7.0", [{ name: "manubrium.apk", browser_download_url: "https://evil.example/manubrium.apk" }]))).toBeNull();
    expect(releaseUpdate({ message: "Not Found" })).toBeNull();
    expect(releaseUpdate(null)).toBeNull();
  });
});

describe("checkForUpdate", () => {
  const now = 1_800_000_000_000;

  it("offers a newer release and remembers when it asked", async () => {
    const store = memory();
    const { f, calls } = answering(release("v1.7.0", [apk("v1.7.0")]));
    const answer = await checkForUpdate({ current: "1.6.1", store, fetch: f, now });
    expect(answer).toEqual({ kind: "update", update: { version: "1.7.0", url: apk("v1.7.0").browser_download_url } });
    expect(calls).toEqual([RELEASES_API]);
    expect(JSON.parse(store.data.get(UPDATE_KEY)!)).toEqual({ at: now });
  });

  it("says current when the installed version is the newest", async () => {
    const { f } = answering(release("v1.7.0", [apk("v1.7.0")]));
    expect(await checkForUpdate({ current: "1.7.0", store: memory(), fetch: f, now })).toEqual({ kind: "current" });
  });

  it("asks at most once a day, unless forced", async () => {
    const store = memory({ [UPDATE_KEY]: JSON.stringify({ at: now - CHECK_EVERY + 1000 }) });
    const { f, calls } = answering(release("v1.7.0", [apk("v1.7.0")]));
    expect(await checkForUpdate({ current: "1.6.1", store, fetch: f, now })).toEqual({ kind: "skipped" });
    expect(calls).toEqual([]);
    expect((await checkForUpdate({ current: "1.6.1", store, fetch: f, now, force: true })).kind).toBe("update");
    expect((await checkForUpdate({ current: "1.6.1", store, fetch: f, now: now + CHECK_EVERY })).kind).toBe("update");
  });

  it("a clock set back does not silence it for good", async () => {
    const store = memory({ [UPDATE_KEY]: JSON.stringify({ at: now + 10 * CHECK_EVERY }) });
    const { f } = answering(release("v1.7.0", [apk("v1.7.0")]));
    expect((await checkForUpdate({ current: "1.6.1", store, fetch: f, now })).kind).toBe("update");
  });

  it("a failed request does not count as having asked", async () => {
    const store = memory();
    const offline = (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    expect(await checkForUpdate({ current: "1.6.1", store, fetch: offline, now })).toEqual({ kind: "failed" });
    expect(await checkForUpdate({ current: "1.6.1", store, fetch: answering({}, 403).f, now })).toEqual({ kind: "failed" });
    expect(store.data.has(UPDATE_KEY)).toBe(false);
  });
});
