// The app against OpenPairings' hall-link-v1 contract (vendored in
// contracts/vendor/openpairings/hall-link-v1; README, "Contracts"): the one
// pairing flow of every hall app. This app reads only links from it - its
// own connect link, and the hall programs' join links it hands on - so that
// is what is held to it: every pairing-link example, through the very code
// the add-a-server screen uses.

import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { HallLinkError, parseConnectLink, readPairingLink } from "./link";

const DIR = "../contracts/vendor/openpairings/hall-link-v1/";

const raw = import.meta.glob("../contracts/vendor/openpairings/hall-link-v1/**/*.json", { eager: true, import: "default" }) as Record<
  string,
  unknown
>;

const files: Record<string, unknown> = Object.fromEntries(Object.entries(raw).map(([path, json]) => [path.slice(DIR.length), json]));
const index = files["index.json"] as { contract: string; version: number; files: string[] };

interface PairingExample {
  app: "manubrium" | "nunki" | "polis";
  link: string;
  server: string;
  code: string;
}

const pairingExamples = Object.entries(files)
  .filter(([name]) => name.startsWith("examples/pairing-link."))
  .map(([name, json]) => [name, json as PairingExample] as const);

describe("the vendored hall-link contract", () => {
  it("is all there: index.json lists exactly the files vendored", () => {
    const present = Object.keys(files)
      .filter((f) => f !== "index.json")
      .sort();
    expect(present).toEqual([...index.files].sort());
    expect(index.contract).toBe("hall-link");
    expect(index.version).toBe(1);
  });

  it("has a pairing-link example for every app, each passing its schema", () => {
    const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
    for (const [name, schema] of Object.entries(files)) if (name.endsWith(".schema.json")) ajv.addSchema(schema as object);
    const validate = ajv.getSchema((files["pairing-link.schema.json"] as { $id: string }).$id)!;

    for (const [name, example] of pairingExamples) expect(validate(example), name).toBe(true);
    expect(new Set(pairingExamples.map(([, e]) => e.app))).toEqual(new Set(["manubrium", "nunki", "polis"]));
  });
});

describe("every pairing link in the contract", () => {
  it.each(pairingExamples)("%s reads as the app, server and code it says", (_name, example) => {
    expect(readPairingLink(example.link)).toEqual({ app: example.app, server: example.server, code: example.code });
  });

  it.each(pairingExamples)("%s connects this app, or is handed on with the right name", (_name, example) => {
    if (example.app === "manubrium") {
      expect(parseConnectLink(example.link)).toEqual({ server: example.server, secret: example.code });
      return;
    }

    let refused: unknown;
    try {
      parseConnectLink(example.link);
    } catch (e) {
      refused = e;
    }
    expect(refused).toBeInstanceOf(HallLinkError);
    expect((refused as HallLinkError).app).toBe(example.app);
    expect((refused as HallLinkError).link).toBe(example.link);
    expect((refused as HallLinkError).message).toMatch(example.app === "nunki" ? /Nunki/ : /Polis/);
  });
});
