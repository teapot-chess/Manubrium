// What the tournament's Live Activity is about, shared by the app (which
// starts it, App/RoundActivityPlugin.swift) and the widget extension (which
// draws it, RoundActivity/). The server updates ContentState by push and can
// start one by push (attributes and all): the JSON keys are these property
// names, so renaming one breaks OpenPairings'
// PairingsEngine.Push.Events.push_live_activities.
//
// One activity follows a whole tournament: the round lives in ContentState,
// so the server can move it from "Round 2: all results" to "Round 3: 0 of 16"
// without the app. Every key added since 1.4 is optional, both ways round:
// a 1.4.x server pushes {done, total} only, and an activity a 1.4.x build
// started carries attributes without roundTitle or complete. Codable reads a
// missing optional as nil and ignores keys it does not know.

import Foundation
#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.1, *)
public struct RoundActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var done: Int
        public var total: Int
        /// The round shown now; nil from a server that does not say (the
        /// round is then the attributes' own).
        public var round: Int?
        /// paired, playing, complete, finished, closed; nil from an older server.
        public var phase: String?

        public init(done: Int, total: Int, round: Int? = nil, phase: String? = nil) {
            self.done = done
            self.total = total
            self.round = round
            self.phase = phase
        }
    }

    /// The app's own name for it: server and tournament.
    public var key: String
    public var tournament: String
    /// The round it was started on.
    public var round: Int
    /// "Round 5", in the app's language when it was started.
    public var title: String
    /// "{done} of {total} results", likewise.
    public var format: String
    /// "Round {n}": the heading for whichever round the state names. Nil on
    /// an activity a 1.4.x build started.
    public var roundTitle: String?
    /// "All results in", for a round with every result in.
    public var complete: String?

    public init(key: String, tournament: String, round: Int, title: String, format: String,
                roundTitle: String? = nil, complete: String? = nil) {
        self.key = key
        self.tournament = tournament
        self.round = round
        self.title = title
        self.format = format
        self.roundTitle = roundTitle
        self.complete = complete
    }

    /// The round the activity shows now.
    public func currentRound(_ state: ContentState) -> Int {
        state.round ?? round
    }

    /// "Round 3", for the round the state names.
    public func heading(_ state: ContentState) -> String {
        guard let roundTitle else { return title }
        return roundTitle.replacingOccurrences(of: "{n}", with: String(currentRound(state)))
    }

    /// Whether every game of the round has a result.
    public func isComplete(_ state: ContentState) -> Bool {
        state.total > 0 && state.done >= state.total
    }

    public func text(_ state: ContentState) -> String {
        if isComplete(state), let complete, !complete.isEmpty {
            return complete
        }
        return format
            .replacingOccurrences(of: "{done}", with: String(state.done))
            .replacingOccurrences(of: "{total}", with: String(state.total))
    }
}
#endif
