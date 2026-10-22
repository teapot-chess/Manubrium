// The phone's language: English, Dutch or French. No library - a dictionary
// per language, a `t(key, vars)` that looks a key up, and the choice kept in
// the same Preferences the app keeps its settings in. Missing keys fall back
// to English, so a half-translated dictionary still reads.
//
// Plurals: pick the key by count in the caller (`n === 1 ? "x_one" : "x_other"`),
// because Dutch and French do not agree on zero the way English does.
// Placeholders are written {name}.

import type { KeyValue } from "../queue";
import { en, type Key } from "./en";
import { nl } from "./nl";
import { fr } from "./fr";

export type { Key } from "./en";
export type Lang = "en" | "nl" | "fr";
export type LangChoice = "auto" | Lang;

export const LANGUAGES: Lang[] = ["en", "nl", "fr"];
/** Each language in its own words, for the picker. */
export const LANGUAGE_NAMES: Record<Lang, string> = { en: "English", nl: "Nederlands", fr: "Français" };
export const LANGUAGE_KEY = "manubrium.language.v1";

const dictionaries: Record<Lang, Record<Key, string>> = { en, nl, fr };

/** The language a phone's locale asks for; English for anything not translated. */
export function detectLanguage(locale: string | null | undefined): Lang {
  const base = (locale ?? "").toLowerCase().split(/[-_]/)[0];
  return base === "nl" || base === "fr" ? base : "en";
}

function phoneLocale(): string | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.language;
}

let choice: LangChoice = "auto";
let active: Lang = detectLanguage(phoneLocale());
const listeners = new Set<() => void>();

export function currentLanguage(): Lang {
  return active;
}

export function currentChoice(): LangChoice {
  return choice;
}

/** The locale for dates: the phone's own for English, so an English phone keeps its formats. */
export function dateLocale(): string | undefined {
  return active === "en" ? undefined : active === "nl" ? "nl-NL" : "fr-FR";
}

/** Translates `key`, filling `{name}` placeholders from `vars`. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  let text = dictionaries[active][key] ?? en[key];
  if (vars) text = text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
  return text;
}

/** Called when the language changes, so the whole screen can be drawn again. */
export function onLanguageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function apply(next: LangChoice): void {
  choice = next;
  active = next === "auto" ? detectLanguage(phoneLocale()) : next;
  if (typeof document !== "undefined") document.documentElement.lang = active;
  for (const listener of listeners) listener();
}

/** Reads the remembered choice; an unreadable or unknown one means "the phone's language". */
export async function loadLanguage(store: KeyValue): Promise<void> {
  let saved: string | null = null;
  try {
    saved = await store.get(LANGUAGE_KEY);
  } catch {
    saved = null;
  }
  apply(saved === "en" || saved === "nl" || saved === "fr" ? saved : "auto");
}

export async function saveLanguage(store: KeyValue, next: LangChoice): Promise<void> {
  apply(next);
  await store.set(LANGUAGE_KEY, next);
}
