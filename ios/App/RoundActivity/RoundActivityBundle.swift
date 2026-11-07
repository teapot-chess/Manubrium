// The widget extension: nothing but the round's Live Activity. No home-screen
// widgets - an arbiter's home screen has enough to do.

import SwiftUI
import WidgetKit

@main
struct RoundActivityBundle: WidgetBundle {
    var body: some Widget {
        RoundActivityWidget()
    }
}
