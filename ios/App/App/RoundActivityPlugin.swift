// The app's side of the tournament's Live Activity (src/liveActivity.ts):
// start, update and end it, and hand its push tokens to the web layer, which
// sends them to the server so the lock screen keeps counting with the app
// closed. Registered by MainViewController; needs iOS 16.2, says so below that.
//
// Two kinds of token. Each activity has its own (pushTokenUpdates), with
// which the server updates and ends it. From iOS 17.2 the app also has a
// push-to-start token (pushToStartTokenUpdates), with which the server starts
// a fresh activity once iOS has ended the last one, eight hours in. An
// activity started that way turns up in activityUpdates the next time the app
// runs; its token goes to the web layer like any other. Both events are kept
// until the web layer listens: it may not be listening yet when they arrive.

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

    /// The activities whose token is already being watched, by id.
    private var watched = Set<String>()
    private let lock = NSLock()

    /// Which APNs host this build's tokens belong to.
    private static var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    public override func load() {
        if #available(iOS 16.2, *) {
            // Whatever is on the lock screen already, started by an earlier
            // run of the app or by the server while the app was closed.
            for activity in Activity<RoundActivityAttributes>.activities {
                watchToken(activity)
            }
            Task {
                for await activity in Activity<RoundActivityAttributes>.activityUpdates {
                    // Started by push: one per server and tournament, so an
                    // older one with the same key goes.
                    let older = Activity<RoundActivityAttributes>.activities.filter {
                        $0.id != activity.id && $0.attributes.key == activity.attributes.key
                    }
                    for old in older {
                        await old.end(nil, dismissalPolicy: .immediate)
                    }
                    self.watchToken(activity)
                }
            }
        }
        if #available(iOS 17.2, *) {
            Task {
                for await data in Activity<RoundActivityAttributes>.pushToStartTokenUpdates {
                    self.notifyListeners("startToken", data: ["token": Self.hex(data)], retainUntilConsumed: true)
                }
            }
        }
    }

    @objc func info(_ call: CAPPluginCall) {
        var supported = false
        var enabled = false
        var pushToStart = false
        if #available(iOS 16.2, *) {
            supported = true
            enabled = ActivityAuthorizationInfo().areActivitiesEnabled
        }
        if #available(iOS 17.2, *) {
            pushToStart = true
        }
        call.resolve([
            "supported": supported,
            "enabled": enabled,
            "pushToStart": pushToStart,
            "environment": Self.environment,
        ])
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
            format: call.getString("format") ?? "{done} of {total} results",
            roundTitle: call.getString("roundTitle"),
            complete: call.getString("complete")
        )
        let state = Self.state(call)
        Task {
            // One per server and tournament. One this build started that is
            // still running is kept and brought up to date: the server may be
            // pushing to it. Anything else with the key goes first.
            let mine = Activity<RoundActivityAttributes>.activities.filter { $0.attributes.key == key }
            let keep = mine.first { $0.activityState == .active && $0.attributes.roundTitle != nil }
            for old in mine where old.id != keep?.id {
                await old.end(nil, dismissalPolicy: .immediate)
            }
            if let keep {
                await keep.update(ActivityContent(state: state, staleDate: Self.staleDate()))
                self.watchToken(keep, again: true)
                return call.resolve()
            }
            do {
                let activity = try Activity.request(
                    attributes: attributes,
                    content: ActivityContent(state: state, staleDate: Self.staleDate()),
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
        let key = call.getString("key") ?? ""
        let state = Self.state(call)
        Task {
            for activity in Activity<RoundActivityAttributes>.activities where activity.attributes.key == key {
                await activity.update(ActivityContent(state: state, staleDate: Self.staleDate()))
            }
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { return call.resolve() }
        let key = call.getString("key") ?? ""
        let state = Self.state(call)
        Task {
            for activity in Activity<RoundActivityAttributes>.activities where activity.attributes.key == key {
                await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }

    /// Four hours: the server's own stale date, for the same reason.
    private static func staleDate() -> Date {
        Date().addingTimeInterval(4 * 3600)
    }

    @available(iOS 16.2, *)
    private static func state(_ call: CAPPluginCall) -> RoundActivityAttributes.ContentState {
        RoundActivityAttributes.ContentState(
            done: call.getInt("done") ?? 0,
            total: call.getInt("total") ?? 0,
            round: call.getInt("round"),
            phase: call.getString("phase")
        )
    }

    private static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    /// Hands every token of `activity` to the web layer, with the round it
    /// shows. Once per activity; `again` sends the current one once more
    /// (the web layer forgot it, after a restart).
    @available(iOS 16.2, *)
    private func watchToken(_ activity: Activity<RoundActivityAttributes>, again: Bool = false) {
        lock.lock()
        let first = watched.insert(activity.id).inserted
        lock.unlock()
        if !first {
            if again, let token = activity.pushToken {
                notifyToken(activity, token)
            }
            return
        }
        Task {
            for await data in activity.pushTokenUpdates {
                self.notifyToken(activity, data)
            }
        }
    }

    @available(iOS 16.2, *)
    private func notifyToken(_ activity: Activity<RoundActivityAttributes>, _ token: Data) {
        let round = activity.attributes.currentRound(activity.content.state)
        notifyListeners(
            "pushToken",
            data: ["key": activity.attributes.key, "token": Self.hex(token), "round": round],
            retainUntilConsumed: true
        )
    }
}
