import type { CapacitorConfig } from "@capacitor/cli";

// The identity. The bundle id / application id is also hard-coded in the
// native projects (ios/App/App.xcodeproj, android/app/build.gradle) because
// `cap sync` does not rewrite it after `cap add`; change all three together.
// The version is package.json's; the build number comes from CI's run
// number (see .github/workflows and docs/releasing.md).
const config: CapacitorConfig = {
  appId: "cloud.pairings.manubrium",
  appName: "Manubrium",
  webDir: "dist",
  plugins: {
    // Every fetch() on a phone goes through the platform's own HTTP stack:
    // no browser origin, so no CORS, and plain http to a desktop copy on
    // the hall network is decided by the native rules (see README).
    CapacitorHttp: { enabled: true },
    // A notification that arrives while the app is open still shows: an
    // incident on board 12 is news even to someone looking at board 3.
    PushNotifications: { presentationOptions: ["alert", "sound"] },
  },
};

export default config;
