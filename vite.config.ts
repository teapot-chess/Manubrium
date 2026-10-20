import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// The bundle Capacitor copies into the native projects (`webDir: "dist"`).
// `npm run dev` serves it on :5173, which an OpenPairings dev server lets
// call its API (`:manubrium_dev_origins` in its config/dev.exs).
export default defineConfig({
  plugins: [preact()],
  server: { port: 5173, strictPort: true },
  build: { target: "es2022", outDir: "dist" },
});
