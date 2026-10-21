# Manubrium's mark

The hall apps share one logo family: a 3 x 3 board on a 24 x 24 grid
(squares 6, gaps 1, origin 2/9/16), ink squares, outlined empty squares
(inset 0.6, stroke 1.2) and one accent square. The family's sources live in
the shared `brand/marks` folder next to the repositories; this folder holds
Manubrium's own and what the phone needs cut from it.

Manubrium's mark is the **handle** (the Latin word): one filled column down
the middle of an empty board, the accent in the centre. The proposal from
`brand/marks/manubrium.svg`, unchanged.

| File | What |
|---|---|
| `manubrium-mark.svg` | the mark, themeable (`currentColor`, `--accent`) |
| `icon.svg` | the app icon: the mark in cream (#f4ead8) on the app's green (#2e5e44), accent in the family rust's night shade (#e2a08c, since the tile is dark) |
| `icon-foreground.svg`, `icon-background.svg` | the same split into the two layers of an Android adaptive icon; the foreground is drawn for the 72 dp safe square, inside the inscribed circle |
| `splash.svg`, `splash-dark.svg` | launch screens: the mark in the accent on the app's light (#f7f6f3) and dark (#0e1210) backgrounds, centred so any crop keeps it |
| `render.mjs` | renders the five SVGs to `assets/*.png` at the sizes `@capacitor/assets` wants |
| `assets/` | those PNGs, committed so a checkout without sharp still has them |

`npm run assets` renders and then writes every size into
`ios/App/App/Assets.xcassets` and `android/app/src/main/res`. Commit the
result; the native projects are checked in, generated files included.
