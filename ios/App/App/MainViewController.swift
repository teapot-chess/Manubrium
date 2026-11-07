// The Capacitor bridge, plus the app's own plugin: RoundActivity, which is
// not an npm package and so is not found by `cap sync`.

import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(RoundActivityPlugin())
    }
}
