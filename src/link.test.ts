import { describe, expect, it } from "vitest";
import { HallLinkError, isLocalHost, LinkError, normaliseServer, parseConnectLink, readHallLink } from "./link";

describe("parseConnectLink", () => {
  it("reads the server and the secret", () => {
    const link = "manubrium://connect?" + new URLSearchParams({ server: "https://pairings.cloud/", secret: "abc" });
    expect(parseConnectLink(link)).toEqual({ server: "https://pairings.cloud", secret: "abc" });
  });

  it("takes a desktop copy's hall address over http", () => {
    const link = "manubrium://connect?server=http%3A%2F%2F192.168.1.20%3A4748&secret=s";
    expect(parseConnectLink(`  ${link}\n`).server).toBe("http://192.168.1.20:4748");
  });

  it("refuses anything that is not a connect link", () => {
    expect(() => parseConnectLink("https://pairings.cloud")).toThrow(LinkError);
    expect(() => parseConnectLink("manubrium://open?server=https://x&secret=s")).toThrow(LinkError);
    expect(() => parseConnectLink("manubrium://connect?server=https://x")).toThrow(/incomplete/);
    expect(() => parseConnectLink("not a link")).toThrow(LinkError);
  });

  it("recognises a hall program's join link and refuses it by name, sub-path and all", () => {
    const link = "https://club.example.org/chess/p/polis/join/abc_DEF-123";
    expect(() => parseConnectLink(link)).toThrow(HallLinkError);
    expect(() => parseConnectLink(link)).toThrow(/Polis/);
    expect(readHallLink(link)).toEqual({ app: "polis", server: "https://club.example.org/chess", code: "abc_DEF-123", link });
    expect(readHallLink("https://x.example/p/nunki/join/")).toBeNull();
    expect(readHallLink("https://x.example/p/alnasl/join/abc")).toBeNull();
  });

  it("refuses plain http to the internet", () => {
    const link = "manubrium://connect?server=http%3A%2F%2Fpairings.cloud&secret=s";
    expect(() => parseConnectLink(link)).toThrow(/https/);
  });
});

describe("normaliseServer", () => {
  it("keeps scheme, host and port only", () => {
    expect(normaliseServer("https://pairings.cloud/help?x=1")).toBe("https://pairings.cloud");
    expect(normaliseServer("http://localhost:4000/")).toBe("http://localhost:4000");
  });

  it("refuses other schemes", () => {
    expect(() => normaliseServer("ftp://pairings.cloud")).toThrow(LinkError);
  });
});

describe("isLocalHost", () => {
  it.each([
    "localhost",
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.20",
    "169.254.3.4",
    "laptop.local",
    "[::1]",
    "fd12:3456::1",
    "fe80::1",
  ])("%s is inside the building", (host) => {
    expect(isLocalHost(host)).toBe(true);
  });

  it.each(["pairings.cloud", "8.8.8.8", "172.32.0.1", "192.169.1.1", "300.1.1.1", "2001:db8::1", "10.0.0.5.example.com"])(
    "%s is not",
    (host) => {
      expect(isLocalHost(host)).toBe(false);
    },
  );
});
