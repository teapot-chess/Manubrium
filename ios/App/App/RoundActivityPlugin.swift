// The app's side of the round's Live Activity (src/liveActivity.ts): start,
// update and end it, and hand its push token to the web layer, which sends
// it to the server so the lock screen keeps counting with the app closed.
// Registered by MainViewController; needs iOS 16.2, says so below that.

import Foundation
import Capacitor
#if canImport(ActivityKit)
import ActivityKit
#endif

@objc(RoundActivityPlugin)
public class RoundActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RoundActivityPlugin"
    public let jsName = "RoundActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    /// Which APNs host this build's tokens belong to.
    private static var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    @objc func info(_ call: CAPPluginCall) {
        var supported = false
        var enabled = false
        if #available(iOS 16.2, *) {
            supported = true
            enabled = ActivityAuthorizationInfo().areActivitiesEnabled
        }
        call.resolve(["supported": supported, "enabled": enabled, "environment": Self.environment])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.reject("Live Activities need iOS 16.2") }
        guard let key = call.getString("key"), let round = call.getInt("round") else {
            return call.reject("key and round are required")
        }
        let attributes = RoundActivityAttributes(
            key: key,
            tournament: call.getString("tournament") ?? "",
            round: round,
            title: call.getString("title") ?? "Round \(round)",
            format: call.getString("format") ?? "{done} of {total} results"
        )
        let state = RoundActivityAttributes.ContentState(done: call.getInt("done") ?? 0, total: call.getInt("total") ?? 0)
        Task {
            // One per server and tournament: an activity left over from
            // before the app was last closed goes first.
            for old in Activity<RoundActivityAttributes>.activities where old.attributes.key == key {
                await old.end(nil, dismissalPolicy: .immediate)
            }
            do {
                let activity = try Activity.request(
                    attributes: attributes,
                    content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(2 * 3600)),
                    pushType: .token
                )
                self.watchToken(activity)
                call.resolve()
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.resolve() }
        let (key, state) = Self.keyAndState(call)
        Task {
            for activity in Activity<RoundActivityAttributes>.activities where activity.attributes.key == key {
                await activity.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(2 * 3600)))
            }
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.resolve() }
        let (key, state) = Self.keyAndState(call)
        Task {
            for activity in Activity<RoundActivityAttributes>.activities where activity.attributes.key == key {
                await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(15 * 60)))
            }
            call.resolve()
        }
    }

    @available(iOS 16.2, *)
    private static func keyAndState(_ call: CAPPluginCall) -> (String, RoundActivityAttributes.ContentState) {
        (call.getString("key") ?? "", RoundActivityAttributes.ContentState(done: call.getInt("done") ?? 0, total: call.getInt("total") ?? 0))
    }

    @available(iOS 16.2, *)
    private func watchToken(_ activity: Activity<RoundActivityAttributes>) {
        Task {
            for await data in activity.pushTokenUpdates {
                let token = data.map { String(format: "%02x", $0) }.joined()
                self.notifyListeners("pushToken", data: ["key": activity.attributes.key, "token": token])
            }
        }
    }
}
