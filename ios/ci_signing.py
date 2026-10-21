"""Manual signing for the App target only, for the TestFlight workflow.

    python3 ios/ci_signing.py <team id> <profile name>

Given on the xcodebuild command line, signing settings reach every target,
the Swift packages included, and a package refuses a provisioning profile
("OSBarcodeLib does not support provisioning profiles"). So they go into the
App target's Release configuration instead, in CI's checkout only: the
project in the repository stays Automatic for whoever builds in Xcode.
"""

import sys

PROJECT = "ios/App/App.xcodeproj/project.pbxproj"
# The App target's Release configuration (see the XCConfigurationList for
# the target "App" in the project file).
APP_RELEASE = "504EC3181FED79650016851F /* Release */ = {"


def main(team, profile):
    with open(PROJECT, encoding="utf-8") as f:
        text = f.read()

    start = text.index(APP_RELEASE)
    end = text.index("name = Release;", start)
    old = "CODE_SIGN_STYLE = Automatic;"
    at = text.find(old, start, end)
    if at < 0:
        sys.exit("ci_signing: no CODE_SIGN_STYLE = Automatic in the App target's Release block")

    indent = "\n\t\t\t\t"
    new = indent.join(
        [
            "CODE_SIGN_STYLE = Manual;",
            "DEVELOPMENT_TEAM = %s;" % team,
            '"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Distribution";',
            'PROVISIONING_PROFILE_SPECIFIER = "%s";' % profile,
        ]
    )

    with open(PROJECT, "w", encoding="utf-8") as f:
        f.write(text[:at] + new + text[at + len(old):])

    print("App target, Release: manual signing with '%s'" % profile)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
