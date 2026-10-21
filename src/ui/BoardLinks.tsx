// Hall boards (Alnasl): the codes that let a board relay or bridge report
// its games to this tournament. A code is shown once, as a QR code to scan
// from the bridge and as text to copy; nobody can show it again. What the
// boards report is shown beside the pairings and never entered.

import { useEffect, useState } from "preact/hooks";
import QRCode from "qrcode";
import type { BoardLink, Tournament } from "../api";
import { copyText } from "../share";
import type { Ctx } from "./App";
import { describeError, Empty, Notice, Sheet } from "./common";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : null);

export function BoardLinks(props: { ctx: Ctx; t: Tournament }) {
  const { ctx, t } = props;
  const [links, setLinks] = useState<BoardLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [making, setMaking] = useState(false);
  const [fresh, setFresh] = useState<{ link: BoardLink; code: string } | null>(null);
  const [revoking, setRevoking] = useState<BoardLink | null>(null);

  const load = () =>
    ctx.api.boardLinks(t.id).then(
      (l) => {
        setLinks(l);
        setError(null);
      },
      (e) => setError(describeError(e)),
    );

  useEffect(() => {
    load();
  }, [t.id]);

  async function create(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const made = await ctx.api.createBoardLink(t.id, label.trim() || undefined);
      setMaking(false);
      setLabel("");
      setFresh(made);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(link: BoardLink) {
    setBusy(true);
    setError(null);
    try {
      await ctx.api.revokeBoardLink(t.id, link.id);
      setRevoking(null);
      await load();
    } catch (err) {
      setRevoking(null);
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="board-links-section">
      <h2>Hall boards (Alnasl)</h2>
      {error && (
        <Notice kind="error" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}
      {links && links.length === 0 && <Empty>No board connected. A code lets the hall's boards report their games here.</Empty>}
      {links && links.length > 0 && (
        <ul class="list compact" id="board-links">
          {links.map((l) => (
            <li key={l.id} class="row">
              <span class="row-main static">
                <span class="row-title">
                  {l.label || "Hall boards"}
                  <span class="tag">{l.kind}</span>
                </span>
                <span class="row-sub">
                  {[l.reach, l.last_seen_at ? `last heard ${when(l.last_seen_at)}` : "not heard from yet"].filter(Boolean).join(" · ")}
                </span>
              </span>
              {!t.read_only && (
                <button type="button" class="chip danger" id={`revoke-link-${l.id}`} onClick={() => setRevoking(l)}>
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!t.read_only && (
        <button type="button" class="btn block" id="new-board-link" onClick={() => setMaking(true)}>
          Connect hall boards
        </button>
      )}
      <p class="fine">The boards' results are shown beside the pairings, in red where they differ. They are never entered: the arbiter does that.</p>

      {making && (
        <Sheet title="Connect hall boards" onClose={() => setMaking(false)}>
          <form class="form" id="board-link-form" onSubmit={create}>
            <label for="board-link-label">A name for it (optional)</label>
            <input id="board-link-label" value={label} maxLength={60} placeholder="Top boards" onInput={(e) => setLabel((e.target as HTMLInputElement).value)} />
            <button type="submit" class="btn primary block" id="board-link-create" disabled={busy}>
              {busy ? "Making the code…" : "Make a code"}
            </button>
          </form>
        </Sheet>
      )}

      {fresh && <FreshCode code={fresh.code} link={fresh.link} onClose={() => setFresh(null)} />}

      {revoking && (
        <Sheet title={`Revoke ${revoking.label || "these boards"}?`} onClose={() => setRevoking(null)}>
          <p>The boards on this code stop reporting at once. A new code can connect them again.</p>
          <div class="sheet-actions">
            <button type="button" class="btn danger block" id="revoke-confirm" disabled={busy} onClick={() => revoke(revoking)}>
              Revoke
            </button>
            <button type="button" class="btn block" onClick={() => setRevoking(null)}>
              Keep it
            </button>
          </div>
        </Sheet>
      )}
    </section>
  );
}

// The code, once: as a QR code for the bridge to scan, and as text to copy.
function FreshCode(props: { code: string; link: BoardLink; onClose: () => void }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    QRCode.toString(props.code, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#24211c", light: "#ffffff" } }).then(
      setSvg,
      () => setSvg(null),
    );
  }, [props.code]);

  return (
    <Sheet title={props.link.label || "Hall boards"} onClose={props.onClose}>
      <p class="sheet-sub">Scan it from the Alnasl bridge, or copy it there.</p>
      {/* The SVG is the qrcode library's own output for our own string. */}
      {svg && <div class="qr" id="board-link-qr" role="img" aria-label="QR code of the board code" dangerouslySetInnerHTML={{ __html: svg }} />}
      <code class="code-once" id="board-link-code">
        {props.code}
      </code>
      <button
        type="button"
        class="btn block"
        id="board-link-copy"
        onClick={async () => setCopied((await copyText(props.code)) === "copied" ? "Copied." : "Could not copy; select the code instead.")}
      >
        {copied ?? "Copy the code"}
      </button>
      <Notice kind="info">Shown once: it cannot be shown again. Lose it and make another, then revoke this one.</Notice>
      <button type="button" class="btn primary block" onClick={props.onClose}>
        Done
      </button>
    </Sheet>
  );
}
