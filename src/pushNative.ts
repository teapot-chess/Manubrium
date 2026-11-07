// The phone's push backend for push.ts: @capacitor/push-notifications.
//
// iOS hands over the APNs device token; the environment (sandbox for a build
// from Xcode, production for TestFlight and the App Store) comes from the
// RoundActivity plugin, which knows how it was compiled.
//
// Android pushes through Firebase, and Firebase without google-services.json
// does not start: registering would crash the app. So an Android build
// pushes only when it was built with the file and VITE_ANDROID_PUSH=1
// (.github/workflows/android.yml sets both from the GOOGLE_SERVICES_JSON
// secret; docs/releasing.md). Without it this build says it cannot push.

import { PushNotifications } from "@capacitor/push-notifications";
import type { PushPlatform } from "./api";
import { RoundActivity } from "./liveActivity";
import { native, platform } from "./platform";
import type { Permission, PushBackend } from "./push";

function pushPlatform(): PushPlatform | null {
  if (!native) return null;
  if (platform === "ios") return "apns";
  if (platform === "android" && import.meta.env.VITE_ANDROID_PUSH === "1") return "fcm";
  return null;
}

const asPermission = (state: string): Permission => (state === "granted" ? "granted" : state === "denied" ? "denied" : "prompt");

export function nativePushBackend(): PushBackend {
  return {
    platform: pushPlatform(),
    async environment() {
      if (platform !== "ios") return "production";
      try {
        return (await RoundActivity.info()).environment;
      } catch {
        return "production";
      }
    },
    async check() {
      return asPermission((await PushNotifications.checkPermissions()).receive);
    },
    async request() {
      return asPermission((await PushNotifications.requestPermissions()).receive);
    },
    token() {
      return new Promise<string>((resolve, reject) => {
        const done: Promise<{ remove: () => Promise<void> }>[] = [];
        const finish = () => done.forEach((h) => h.then((x) => x.remove()));
        done.push(
          PushNotifications.addListener("registration", ({ value }) => {
            finish();
            resolve(value);
          }),
        );
        done.push(
          PushNotifications.addListener("registrationError", ({ error }) => {
            finish();
            reject(new Error(error));
          }),
        );
        PushNotifications.register().catch((e) => {
          finish();
          reject(e);
        });
      });
    },
    onTap(handler) {
      if (!pushPlatform()) return;
      PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => handler(notification.data ?? {}));
    },
  };
}
