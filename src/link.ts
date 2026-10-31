import { t } from "./i18n";

// The connect link an OpenPairings account page shows as a QR code:
//
//   manubrium://connect?server=<base url>&secret=<one-time secret>
//
// and the one rule the app adds on top of the server's: plain http only to
// an address that cannot leave the building. A desktop copy in the hall
// speaks http on the local network (no certificate exists for 192.168.1.20);
// anything on the internet must be https, so a token never crosses the open
// internet in the clear. Android's network security config cannot express
// "private ranges only" (it knows domains, not CIDR), so this check is what
// actually enforces it - see the README.

export interface ConnectLink {
  server: string;
  secret: string;
}

export class LinkError extends Error {}

// The hall programs that run on a PC - Nunki, the announcer, and Polis, the
// print station - are paired with a link of their own (OpenPairings'
// hall-link-v1 contract, README "Pairing a device"):
//
//   https://<server>/p/<app>/join/<code>
//
// Their PCs have no camera worth the name, so the QR code OpenPairings shows
// for them is scanned here. This app cannot join on their behalf - the key
// has to end up on that PC - so it recognises the link, says whom it is for,
// and hands it on. Nothing is sent: the code stays unspent for its program.
export type HallApp = "nunki" | "polis";

export const HALL_APP_NAMES: Record<HallApp, string> = { nunki: "Nunki", polis: "Polis" };

export class HallLinkError extends LinkError {
  constructor(
    readonly app: HallApp,
    readonly link: string,
  ) {
    super(t(app === "nunki" ? "link.hall_nunki" : "link.hall_polis"));
  }
}

/** A pairing link of any hall app, as the contract describes it: whom it is for, the server and the code. */
export interface PairingLink {
  app: "manubrium" | HallApp;
  server: string;
  code: string;
}

/**
 * Reads a hall program's join link (the last `/p/<app>/join/<code>` of an
 * http(s) address; everything before that `/p/` is the server's), or null
 * when the text is not one.
 */
export function readHallLink(text: string): (PairingLink & { app: HallApp; link: string }) | null {
  const raw = text.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const at = url.pathname.lastIndexOf("/p/");
  if (at < 0) return null;
  const match = url.pathname.slice(at).match(/^\/p\/(nunki|polis)\/join\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) return null;

  return { app: match[1] as HallApp, server: url.origin + url.pathname.slice(0, at), code: match[2], link: raw };
}

/** Any app's pairing link: this app's own connect link, or a hall program's join link. */
export function readPairingLink(text: string): PairingLink {
  const hall = readHallLink(text);
  if (hall) return { app: hall.app, server: hall.server, code: hall.code };
  const own = parseConnectLink(text);
  return { app: "manubrium", server: own.server, code: own.secret };
}

export function parseConnectLink(text: string): ConnectLink {
  const raw = text.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LinkError(t("link.not_manubrium"));
  }

  if (url.protocol !== "manubrium:") {
    const hall = readHallLink(raw);
    if (hall) throw new HallLinkError(hall.app, hall.link);
    throw new LinkError(t("link.not_manubrium"));
  }

  // `manubrium://connect?...` parses with host "connect" in some engines and
  // pathname "//connect" in others.
  const target = (url.host || url.pathname.replace(/^\/+/, "")).toLowerCase();
  if (target !== "connect") throw new LinkError(t("link.not_connect"));

  const server = url.searchParams.get("server") ?? "";
  const secret = url.searchParams.get("secret") ?? "";
  if (!server || !secret) throw new LinkError(t("link.incomplete"));

  return { server: normaliseServer(server), secret };
}

// A server's base URL as the app stores it: scheme, host and port, no
// trailing slash, no path. Refuses http to a public address.
export function normaliseServer(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new LinkError(t("link.bad_address"));
  }

  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && isLocalHost(url.hostname)) return url.origin;
  if (url.protocol === "http:") {
    throw new LinkError(t("link.no_https"));
  }
  throw new LinkError(t("link.must_https"));
}

// Loopback, the private IPv4 ranges (RFC 1918), link-local, IPv6 unique
// local and link-local, and mDNS names. What a desktop copy's phones
// listener can be reached on.
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".local")) return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return false;
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }

  if (host.includes(":")) {
    return host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  }

  return false;
}
