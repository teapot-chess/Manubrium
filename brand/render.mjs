// Renders the SVG sources into the PNGs @capacitor/assets wants
// (brand/assets/), then `npm run assets` lets it cut every size for both
// platforms. Needs only sharp, which @capacitor/assets already brings.
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "assets");

const sources = [
  ["icon.svg", "icon-only.png", 1024],
  ["icon-foreground.svg", "icon-foreground.png", 1024],
  ["icon-background.svg", "icon-background.png", 1024],
  ["splash.svg", "splash.png", 2732],
  ["splash-dark.svg", "splash-dark.png", 2732],
];

for (const [svg, png, size] of sources) {
  const buffer = await readFile(join(here, svg));
  await sharp(buffer).resize(size, size).png().toFile(join(out, png));
  console.log(`${svg} -> assets/${png} (${size}px)`);
}
