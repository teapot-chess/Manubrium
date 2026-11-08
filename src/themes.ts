// The app's colour themes: the set OpenPairings offers (assets/css/app.css,
// `[data-theme=...]`), each as a light and a dark palette. OpenPairings has
// some themes in only one of the two (Slate is dark, Paper light); the
// missing halves are drawn here in the same pigments, because on a phone the
// phone decides light or dark, not the theme. The palettes are CSS variable
// sets, applied to <html>; styles.css only ever reads the variables.

import type { KeyValue } from "./queue";

export type ThemeId = "slate" | "classic" | "tomw" | "paper" | "board" | "contrast";

/** In the order the picker shows them. */
export const THEMES: ThemeId[] = ["slate", "classic", "tomw", "paper", "board", "contrast"];

/** Cool grey-blue: calm in a bright hall and at night, and no longer green. */
export const DEFAULT_THEME: ThemeId = "slate";

export const THEME_KEY = "manubrium.theme.v1";

/** The variables styles.css reads. A palette must set every one. */
export const TOKENS = [
  "bg",
  "surface",
  "surface-alt",
  "border",
  "text",
  "text-soft",
  "accent",
  "accent-hover",
  "accent-soft",
  "accent-ink",
  "danger",
  "danger-soft",
  "warn",
  "warn-soft",
  "ok-soft",
  "shadow",
  "mark-centre",
] as const;

export type Token = (typeof TOKENS)[number];
export type Palette = Record<Token, string>;

const lightShadow = (rgb: string) => `0 1px 2px rgba(${rgb}, 0.06), 0 6px 20px rgba(${rgb}, 0.06)`;
const darkShadow = "0 1px 2px rgba(0, 0, 0, 0.4)";

const PALETTES: Record<ThemeId, { light: Palette; dark: Palette }> = {
  // OpenPairings' Slate for the dark half; the light half is the same
  // steel blue on a paler, cooler page.
  slate: {
    light: {
      bg: "#f3f5f8",
      surface: "#ffffff",
      "surface-alt": "#f7f9fb",
      border: "#dbe1e8",
      text: "#18202a",
      "text-soft": "#5a6676",
      accent: "#2d5f8f",
      "accent-hover": "#234d75",
      "accent-soft": "#e4edf6",
      "accent-ink": "#ffffff",
      danger: "#b3261e",
      "danger-soft": "#fbe9e7",
      warn: "#7a5200",
      "warn-soft": "#fbf1dc",
      "ok-soft": "#e3f1ea",
      shadow: lightShadow("24, 32, 42"),
      "mark-centre": "#a0412a",
    },
    dark: {
      bg: "#12161c",
      surface: "#1a2029",
      "surface-alt": "#1f2732",
      border: "#2b3542",
      text: "#dde5ef",
      "text-soft": "#98a3b0",
      accent: "#7fb2e5",
      "accent-hover": "#9ac4ec",
      "accent-soft": "rgba(127, 178, 229, 0.18)",
      "accent-ink": "#0d141b",
      danger: "#e58b8b",
      "danger-soft": "rgba(229, 139, 139, 0.14)",
      warn: "#e5c07f",
      "warn-soft": "rgba(229, 192, 127, 0.16)",
      "ok-soft": "rgba(127, 214, 168, 0.16)",
      shadow: "0 1px 3px rgba(0, 0, 0, 0.55)",
      "mark-centre": "#e2a08c",
    },
  },
  // OpenPairings' own light and dark: the board green of 1.0 and 1.1.
  classic: {
    light: {
      bg: "#f7f6f3",
      surface: "#ffffff",
      "surface-alt": "#faf9f6",
      border: "#e3e1db",
      text: "#24211c",
      "text-soft": "#6f6a60",
      accent: "#2e5e44",
      "accent-hover": "#24503a",
      "accent-soft": "#e8f0eb",
      "accent-ink": "#ffffff",
      danger: "#b3261e",
      "danger-soft": "#fbe9e7",
      warn: "#8a5a00",
      "warn-soft": "#fdf3e0",
      "ok-soft": "#e8f0eb",
      shadow: lightShadow("36, 33, 28"),
      "mark-centre": "#7a2e1e",
    },
    dark: {
      bg: "#0e1210",
      surface: "#161b18",
      "surface-alt": "#1b211d",
      border: "#29312b",
      text: "#e9ebe6",
      "text-soft": "#98a29b",
      accent: "#60bd8c",
      "accent-hover": "#76cb9e",
      "accent-soft": "rgba(96, 189, 140, 0.16)",
      "accent-ink": "#0e1210",
      danger: "#f2b8b5",
      "danger-soft": "rgba(242, 184, 181, 0.12)",
      warn: "#f0c36a",
      "warn-soft": "rgba(240, 195, 106, 0.12)",
      "ok-soft": "rgba(96, 189, 140, 0.14)",
      shadow: darkShadow,
      "mark-centre": "#e2a08c",
    },
  },
  // Pale sky and royal blue; at night a navy hall with the blue lit up.
  tomw: {
    light: {
      bg: "#eaf2fc",
      surface: "#f9fbff",
      "surface-alt": "#f1f6fd",
      border: "#c7d7ee",
      text: "#13254f",
      "text-soft": "#4a5b7e",
      accent: "#2352c4",
      "accent-hover": "#1b42a3",
      "accent-soft": "#e2ecfb",
      "accent-ink": "#ffffff",
      danger: "#b3261e",
      "danger-soft": "#fbe9e7",
      warn: "#6f4c08",
      "warn-soft": "#f6eedb",
      "ok-soft": "#e3f1e9",
      shadow: lightShadow("19, 37, 79"),
      "mark-centre": "#b3261e",
    },
    dark: {
      bg: "#0b1328",
      surface: "#121c36",
      "surface-alt": "#17223f",
      border: "#24315a",
      text: "#e3eaf9",
      "text-soft": "#9aa8c9",
      accent: "#7ea2ff",
      "accent-hover": "#98b5ff",
      "accent-soft": "rgba(126, 162, 255, 0.18)",
      "accent-ink": "#0b1328",
      danger: "#f2a29c",
      "danger-soft": "rgba(242, 162, 156, 0.12)",
      warn: "#f0c36a",
      "warn-soft": "rgba(240, 195, 106, 0.12)",
      "ok-soft": "rgba(120, 210, 160, 0.14)",
      shadow: darkShadow,
      "mark-centre": "#f2a29c",
    },
  },
  // Off-white and brick, like the pairing sheet; at night, brick embers.
  paper: {
    light: {
      bg: "#fbfbfa",
      surface: "#ffffff",
      "surface-alt": "#f6f6f4",
      border: "#dcdcd8",
      text: "#1b1b1a",
      "text-soft": "#6a6a68",
      accent: "#7a2e1e",
      "accent-hover": "#5f2317",
      "accent-soft": "#f4eae7",
      "accent-ink": "#fdf5f2",
      danger: "#9b2c2c",
      "danger-soft": "#f8e7e7",
      warn: "#88591e",
      "warn-soft": "#f4ece0",
      "ok-soft": "#e8efea",
      shadow: lightShadow("27, 27, 26"),
      "mark-centre": "#2f5d43",
    },
    dark: {
      bg: "#161413",
      surface: "#1e1b1a",
      "surface-alt": "#242120",
      border: "#36312e",
      text: "#ece7e3",
      "text-soft": "#a69d96",
      accent: "#e29a85",
      "accent-hover": "#eab09f",
      "accent-soft": "rgba(226, 154, 133, 0.16)",
      "accent-ink": "#1a1210",
      danger: "#f2a3a3",
      "danger-soft": "rgba(242, 163, 163, 0.12)",
      warn: "#e8b56a",
      "warn-soft": "rgba(232, 181, 106, 0.14)",
      "ok-soft": "rgba(140, 200, 160, 0.14)",
      shadow: darkShadow,
      "mark-centre": "#8cc8a0",
    },
  },
  // Cream and board green, the colours of the equipment; at night, walnut.
  board: {
    light: {
      bg: "#f2ece0",
      surface: "#fbf7ee",
      "surface-alt": "#f6f1e4",
      border: "#d3c9b4",
      text: "#1f2a22",
      "text-soft": "#5e6b60",
      accent: "#2f5d43",
      "accent-hover": "#24503a",
      "accent-soft": "#e3ece5",
      "accent-ink": "#f4f9f5",
      danger: "#96342a",
      "danger-soft": "#f6e4e0",
      warn: "#795312",
      "warn-soft": "#f2e9d5",
      "ok-soft": "#e3eee4",
      shadow: lightShadow("63, 54, 36"),
      "mark-centre": "#96342a",
    },
    dark: {
      bg: "#17140f",
      surface: "#201c16",
      "surface-alt": "#26211a",
      border: "#3a3327",
      text: "#efe7d6",
      "text-soft": "#b0a58f",
      accent: "#8cc59f",
      "accent-hover": "#a2d3b2",
      "accent-soft": "rgba(140, 197, 159, 0.16)",
      "accent-ink": "#13180f",
      danger: "#e8907f",
      "danger-soft": "rgba(232, 144, 127, 0.13)",
      warn: "#e2b866",
      "warn-soft": "rgba(226, 184, 102, 0.14)",
      "ok-soft": "rgba(140, 197, 159, 0.14)",
      shadow: darkShadow,
      "mark-centre": "#e8907f",
    },
  },
  // Not a flavour: black on white (white on black), heavy borders.
  contrast: {
    light: {
      bg: "#ffffff",
      surface: "#ffffff",
      "surface-alt": "#f2f2f2",
      border: "#767676",
      text: "#000000",
      "text-soft": "#3d3d3d",
      accent: "#0b4fa8",
      "accent-hover": "#073a7d",
      "accent-soft": "#dbe6f6",
      "accent-ink": "#ffffff",
      danger: "#b3000f",
      "danger-soft": "#fbe3e5",
      warn: "#7a4c00",
      "warn-soft": "#f4e7cf",
      "ok-soft": "#d8ecdb",
      shadow: "0 0 0 1px #000000",
      "mark-centre": "#b3000f",
    },
    dark: {
      bg: "#000000",
      surface: "#000000",
      "surface-alt": "#141414",
      border: "#a0a0a0",
      text: "#ffffff",
      "text-soft": "#d0d0d0",
      accent: "#8cc4ff",
      "accent-hover": "#b0d6ff",
      "accent-soft": "#0f2540",
      "accent-ink": "#000000",
      danger: "#ff8a8a",
      "danger-soft": "#3a0d0d",
      warn: "#ffcf66",
      "warn-soft": "#2e2300",
      "ok-soft": "#0e2a14",
      shadow: "0 0 0 1px #ffffff",
      "mark-centre": "#ff8a8a",
    },
  },
};

export function isTheme(id: unknown): id is ThemeId {
  return typeof id === "string" && (THEMES as string[]).includes(id);
}

export function palette(id: ThemeId, dark: boolean): Palette {
  return PALETTES[id][dark ? "dark" : "light"];
}

/** Sets `id`'s palette on `root` (the <html> element), and the browser bar's colour. */
export function applyTheme(id: ThemeId, dark: boolean, root: HTMLElement = document.documentElement): void {
  const p = palette(id, dark);
  for (const token of TOKENS) root.style.setProperty(`--${token}`, p[token]);
  root.style.setProperty("color-scheme", dark ? "dark" : "light");
  root.dataset.theme = id;
  const doc = root.ownerDocument;
  for (const meta of Array.from(doc.querySelectorAll('meta[name="theme-color"]'))) meta.setAttribute("content", p.bg);
}

let current: ThemeId = DEFAULT_THEME;

function phoneIsDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

export function currentTheme(): ThemeId {
  return current;
}

/**
 * Applies `id` now and again whenever the phone switches between light and
 * dark. Called once on start; `setTheme` changes the id it follows.
 */
export function startTheme(id: ThemeId = DEFAULT_THEME): void {
  current = id;
  applyTheme(current, phoneIsDark());
  if (typeof matchMedia === "function") {
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", (e) => applyTheme(current, e.matches));
  }
}

export function setTheme(id: ThemeId): void {
  current = id;
  applyTheme(current, phoneIsDark());
}

/** The remembered theme; the default for none, or for one this version does not know. */
export async function loadTheme(store: KeyValue): Promise<ThemeId> {
  try {
    const saved = await store.get(THEME_KEY);
    return isTheme(saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export async function saveTheme(store: KeyValue, id: ThemeId): Promise<void> {
  setTheme(id);
  await store.set(THEME_KEY, id);
}
