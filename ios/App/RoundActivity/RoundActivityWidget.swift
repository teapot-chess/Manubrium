// "Round 5: 23 of 32 results" on the lock screen and in the Dynamic Island,
// for whichever round of the tournament the state names. Dimmed once stale:
// the server has not been heard from for a while and the count may be old.

import ActivityKit
import SwiftUI
import WidgetKit

struct RoundActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RoundActivityAttributes.self) { context in
            LockScreenView(attributes: context.attributes, state: context.state, stale: context.isStale)
                .activityBackgroundTint(Color.black.opacity(0.75))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.attributes.heading(context.state))
                        .font(.headline)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\(context.state.done)/\(context.state.total)")
                        .font(.headline.monospacedDigit())
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(context.attributes.tournament)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        ProgressView(value: fraction(context.state))
                            .tint(.green)
                        Text(context.attributes.text(context.state))
                            .font(.caption)
                    }
                }
            } compactLeading: {
                Text("R\(context.attributes.currentRound(context.state))")
                    .font(.caption.bold())
            } compactTrailing: {
                Text("\(context.state.done)/\(context.state.total)")
                    .font(.caption.monospacedDigit())
            } minimal: {
                ProgressView(value: fraction(context.state))
                    .progressViewStyle(.circular)
                    .tint(.green)
            }
        }
    }
}

private func fraction(_ state: RoundActivityAttributes.ContentState) -> Double {
    state.total > 0 ? min(1, Double(state.done) / Double(state.total)) : 0
}

private struct LockScreenView: View {
    let attributes: RoundActivityAttributes
    let state: RoundActivityAttributes.ContentState
    let stale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(attributes.heading(state))
                    .font(.headline)
                Spacer()
                Text(attributes.text(state))
                    .font(.subheadline.monospacedDigit())
            }
            ProgressView(value: fraction(state))
                .tint(.green)
            Text(attributes.tournament)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .foregroundStyle(.white)
        .opacity(stale ? 0.6 : 1)
        .padding()
    }
}
