// "Round 5: 23 of 32 results" on the lock screen and in the Dynamic Island.

import ActivityKit
import SwiftUI
import WidgetKit

struct RoundActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RoundActivityAttributes.self) { context in
            LockScreenView(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(Color.black.opacity(0.75))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.attributes.title)
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
                Text("R\(context.attributes.round)")
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

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(attributes.title)
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
        .padding()
    }
}
