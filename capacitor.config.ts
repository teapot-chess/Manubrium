import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "cloud.pairings.manubrium",
  appName: "Manubrium",
  webDir: "dist",
  plugins: {
    // Every fetch() on a phone goes through the platform's own HTTP stack:
    // no browser origin, so no CORS, and plain http to a desktop copy on
    // the hall network is decided by the native rules (see README).
    CapacitorHttp: { enabled: true },
  },
};

export default config;
