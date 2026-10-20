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

export function parseConnectLink(text: string): ConnectLink {
  const raw = text.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LinkError("That is not a Manubrium link. Scan the code on the account page, or copy its link.");
  }

  if (url.protocol !== "manubrium:") {
    throw new LinkError("That is not a Manubrium link. Scan the code on the account page, or copy its link.");
  }

  // `manubrium://connect?...` parses with host "connect" in some engines and
  // pathname "//connect" in others.
  const target = (url.host || url.pathname.replace(/^\/+/, "")).toLowerCase();
  if (target !== "connect") throw new LinkError("This Manubrium link is not a connect link.");

  const server = url.searchParams.get("server") ?? "";
  const secret = url.searchParams.get("secret") ?? "";
  if (!server || !secret) throw new LinkError("The link is incomplete. Copy all of it.");

  return { server: normaliseServer(server), secret };
}

// A server's base URL as the app stores it: scheme, host and port, no
// trailing slash, no path. Refuses http to a public address.
export function normaliseServer(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new LinkError("The server address in the link is not an address.");
  }

  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && isLocalHost(url.hostname)) return url.origin;
  if (url.protocol === "http:") {
    throw new LinkError("This server is on the internet without https. Manubrium only speaks plain http inside the hall's own network.");
  }
  throw new LinkError("The server address must start with https://.");
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
