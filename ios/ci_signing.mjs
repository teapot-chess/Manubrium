#!/usr/bin/env node
// Manual signing for the App target and the RoundActivity extension, for
// the TestFlight workflow.
//
//   node ios/ci_signing.mjs <team id> <app profile name> <extension profile name>
//
// Given on the xcodebuild command line, signing settings reach every target,
// the Swift packages included, and a package refuses a provisioning profile
// ("OSBarcodeLib does not support provisioning profiles"). So they go into
// each target's Release configuration instead, in CI's checkout only: the
// project in the repository stays Automatic for whoever builds in Xcode.

import { readFileSync, writeFileSync } from "node:fs";

const PROJECT = "ios/App/App.xcodeproj/project.pbxproj";
// The Release configurations of the two targets (the XCConfigurationLists
// for "App" and "RoundActivity" in the project file).
const TARGETS = [
  { name: "App", release: "504EC3181FED79650016851F /* Release */ = {", profileArg: 1 },
  { name: "RoundActivity", release: "7A5E0C282F1A4B0000C0FFEE /* Release */ = {", profileArg: 2 },
];

const [team, ...profiles] = process.argv.slice(2);
if (!team || profiles.length !== 2 || profiles.some((p) => !p)) {
  console.error("usage: node ios/ci_signing.mjs <team id> <app profile name> <extension profile name>");
  process.exit(2);
}

let text = readFileSync(PROJECT, "utf8");
const old = "CODE_SIGN_STYLE = Automatic;";

for (const target of TARGETS) {
  const start = text.indexOf(target.release);
  if (start < 0) throw new Error(`ci_signing: no Release configuration for ${target.name}`);
  const end = text.indexOf("name = Release;", start);
  const at = text.indexOf(old, start);
  if (at < 0 || at > end) throw new Error(`ci_signing: no ${old} in the ${target.name} target's Release block`);
  const profile = profiles[target.profileArg - 1];
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const replacement = [
    "CODE_SIGN_STYLE = Manual;",
    `DEVELOPMENT_TEAM = ${team};`,
    '"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Distribution";',
    `PROVISIONING_PROFILE_SPECIFIER = "${profile.replace(/"/g, '\\"')}";`,
  ].join(`${nl}\t\t\t\t`);
  text = text.slice(0, at) + replacement + text.slice(at + old.length);
  console.log(`${target.name}, Release: manual signing with '${profile}'`);
}

writeFileSync(PROJECT, text);
