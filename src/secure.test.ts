import { describe, expect, it } from "vitest";
import { secureKeyValue, type PlainBackend, type SecureBackend } from "./secure";

function plainStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const store: PlainBackend & { data: Map<string, string> } = {
    data,
    async get(key) {
      return data.get(key) ?? null;
    },
    async set(key, value) {
      data.set(key, value);
    },
    async remove(key) {
      data.delete(key);
    },
  };
  return store;
}

function vault(initial: Record<string, string> = {}, failing: Partial<Record<"get" | "set" | "remove", boolean>> = {}) {
  const data = new Map(Object.entries(initial));
  const calls: string[] = [];
  const store: SecureBackend & { data: Map<string, string>; calls: string[] } = {
    data,
    calls,
    async getItem(key) {
      calls.push(`get ${key}`);
      if (failing.get) throw new Error("keychain locked");
      return data.get(key) ?? null;
    },
    async setItem(key, value) {
      calls.push(`set ${key}`);
      if (failing.set) throw new Error("keystore gone");
      data.set(key, value);
    },
    async removeItem(key) {
      calls.push(`remove ${key}`);
      data.delete(key);
    },
  };
  return store;
}

describe("secureKeyValue", () => {
  it("writes and reads the vault only", async () => {
    const secure = vault();
    const plain = plainStore();
    const kv = secureKeyValue({ secure, plain });

    await kv.set("servers", "[token]");
    expect(await kv.get("servers")).toBe("[token]");
    expect(secure.data.get("servers")).toBe("[token]");
    expect(plain.data.size).toBe(0);
  });

  it("moves a value from preferences into the vault once", async () => {
    const secure = vault();
    const plain = plainStore({ servers: "[old]" });
    const kv = secureKeyValue({ secure, plain });

    expect(await kv.get("servers")).toBe("[old]");
    expect(secure.data.get("servers")).toBe("[old]");
    expect(plain.data.has("servers")).toBe(false);

    // The second read never looks at preferences again.
    expect(await kv.get("servers")).toBe("[old]");
    expect(secure.calls).toEqual(["get servers", "set servers", "get servers"]);
  });

  it("prefers the vault when both have a value", async () => {
    const secure = vault({ servers: "[new]" });
    const plain = plainStore({ servers: "[stale]" });
    const kv = secureKeyValue({ secure, plain });

    expect(await kv.get("servers")).toBe("[new]");
    expect(plain.data.get("servers")).toBe("[stale]"); // untouched: nothing was migrated
  });

  it("returns null when neither has the key", async () => {
    const kv = secureKeyValue({ secure: vault(), plain: plainStore() });
    expect(await kv.get("missing")).toBeNull();
  });

  it("uses preferences alone when there is no vault (web)", async () => {
    const plain = plainStore();
    const kv = secureKeyValue({ secure: null, plain });

    await kv.set("servers", "[web]");
    expect(await kv.get("servers")).toBe("[web]");
    expect(plain.data.get("servers")).toBe("[web]");
  });

  it("falls back to preferences for the session when the vault fails to read", async () => {
    const secure = vault({}, { get: true });
    const plain = plainStore({ servers: "[kept]" });
    const warnings: string[] = [];
    const kv = secureKeyValue({ secure, plain, warn: (m) => warnings.push(m) });

    expect(await kv.get("servers")).toBe("[kept]");
    await kv.set("servers", "[later]");
    expect(plain.data.get("servers")).toBe("[later]");
    expect(secure.calls).toEqual(["get servers"]); // never asked again
    expect(warnings).toHaveLength(1);
  });

  it("keeps the old value in preferences when the migration write fails", async () => {
    const secure = vault({}, { set: true });
    const plain = plainStore({ servers: "[old]" });
    const kv = secureKeyValue({ secure, plain });

    expect(await kv.get("servers")).toBe("[old]");
    expect(plain.data.get("servers")).toBe("[old]"); // not removed: the copy did not land
  });

  it("falls back to preferences when the vault fails to write", async () => {
    const secure = vault({}, { set: true });
    const plain = plainStore();
    const kv = secureKeyValue({ secure, plain });

    await kv.set("servers", "[x]");
    expect(plain.data.get("servers")).toBe("[x]");
    expect(await kv.get("servers")).toBe("[x]");
  });
});
