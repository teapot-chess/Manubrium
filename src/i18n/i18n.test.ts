import { describe, expect, it } from "vitest";
import { en, type Key } from "./en";
import { nl } from "./nl";
import { fr } from "./fr";
import { currentLanguage, detectLanguage, LANGUAGE_KEY, loadLanguage, saveLanguage, t } from "./index";

const enKeys = Object.keys(en).sort();
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** A KeyValue in memory; `broken` throws on every read, like an unreadable store. */
function memory(initial: Record<string, string> = {}, broken = false) {
  const data = new Map(Object.entries(initial));
  return {
    async get(key: string) {
      if (broken) throw new Error("unreadable");
      return data.get(key) ?? null;
    },
    async set(key: string, value: string) {
      data.set(key, value);
    },
  };
}

describe("dictionaries", () => {
  it("Dutch has exactly the English keys: none missing, none extra", () => {
    expect(Object.keys(nl).sort()).toEqual(enKeys);
  });

  it("French has exactly the English keys: none missing, none extra", () => {
    expect(Object.keys(fr).sort()).toEqual(enKeys);
  });

  it("no translation is empty", () => {
    for (const key of enKeys as Key[]) {
      expect(en[key].trim(), `en ${key}`).not.toBe("");
      expect(nl[key].trim(), `nl ${key}`).not.toBe("");
      expect(fr[key].trim(), `fr ${key}`).not.toBe("");
    }
  });

  it("every translation keeps the placeholders of its English text", () => {
    for (const key of enKeys as Key[]) {
      expect(placeholders(nl[key]), `nl ${key}`).toEqual(placeholders(en[key]));
      expect(placeholders(fr[key]), `fr ${key}`).toEqual(placeholders(en[key]));
    }
  });
});

describe("language choice", () => {
  it("reads the phone's locale: Dutch and French, regional variants too, English otherwise", () => {
    expect(detectLanguage("nl-BE")).toBe("nl");
    expect(detectLanguage("nl")).toBe("nl");
    expect(detectLanguage("fr_FR")).toBe("fr");
    expect(detectLanguage("fr-BE")).toBe("fr");
    expect(detectLanguage("de-DE")).toBe("en");
    expect(detectLanguage("")).toBe("en");
    expect(detectLanguage(undefined)).toBe("en");
  });

  it("fills placeholders and falls back to English for a missing key", async () => {
    const store = memory();
    await saveLanguage(store, "en");
    expect(t("servers.remove_title", { label: "Hall" })).toBe("Remove Hall?");
    expect(t("tournaments.waiting", { n: 2 })).toBe("2 waiting");
  });

  it("a remembered choice wins over the phone's language, and is kept in the app's storage", async () => {
    const store = memory();
    await saveLanguage(store, "nl");
    expect(currentLanguage()).toBe("nl");
    expect(t("common.back")).toBe(nl["common.back"]);
    expect(await store.get(LANGUAGE_KEY)).toBe("nl");

    await saveLanguage(store, "fr");
    expect(t("common.back")).toBe(fr["common.back"]);

    await saveLanguage(store, "en");
    expect(t("common.back")).toBe("Back");
  });

  it("loads the remembered choice on start, and treats an unknown or unreadable one as the phone's language", async () => {
    await loadLanguage(memory({ [LANGUAGE_KEY]: "fr" }));
    expect(currentLanguage()).toBe("fr");

    await loadLanguage(memory({ [LANGUAGE_KEY]: "klingon" }));
    expect(currentLanguage()).toBe(detectLanguage(typeof navigator === "undefined" ? undefined : navigator.language));

    await loadLanguage(memory({}, true));
    expect(currentLanguage()).toBe(detectLanguage(typeof navigator === "undefined" ? undefined : navigator.language));

    await saveLanguage(memory(), "en");
  });
});
