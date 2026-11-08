// What the round's Live Activity is about, shared by the app (which starts
// it, App/RoundActivityPlugin.swift) and the widget extension (which draws
// it, RoundActivity/). The server updates ContentState by push: its JSON
// keys are these property names ("done", "total"), so renaming one breaks
// OpenPairings' PairingsEngine.Push.Events.push_live_activities.

import Foundation
#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.1, *)
public struct RoundActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var done: Int
        public var total: Int

        public init(done: Int, total: Int) {
            self.done = done
            self.total = total
        }
    }

    /// The app's own name for it: server and tournament.
    public var key: String
    public var tournament: String
    public var round: Int
    /// "Round 5", in the app's language when it was started.
    public var title: String
    /// "{done} of {total} results", likewise.
    public var format: String

    public init(key: String, tournament: String, round: Int, title: String, format: String) {
        self.key = key
        self.tournament = tournament
        self.round = round
        self.title = title
        self.format = format
    }

    public func text(_ state: ContentState) -> String {
        format
            .replacingOccurrences(of: "{done}", with: String(state.done))
            .replacingOccurrences(of: "{total}", with: String(state.total))
    }
}
#endif
