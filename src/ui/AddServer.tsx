import { useEffect, useState } from "preact/hooks";
import { connect } from "../api";
import { LinkError, parseConnectLink } from "../link";
import { deviceName, native, platform, scanQr } from "../platform";
import { labelFor, type SavedServer } from "../servers";
import { describeError, Mark, Notice, TopBar } from "./common";

export function AddServer(props: {
  initialLink?: string;
  canCancel: boolean;
  onCancel: () => void;
  onAdded: (server: SavedServer) => void;
}) {
  const [link, setLink] = useState(props.initialLink ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(text: string) {
    setError(null);
    let parsed;
    try {
      parsed = parseConnectLink(text);
    } catch (e) {
      setError(e instanceof LinkError ? e.message : describeError(e));
      return;
    }

    setBusy(true);
    try {
      const answer = await connect(parsed.server, parsed.secret, { name: await deviceName(), platform });
      props.onAdded({
        base: parsed.server,
        token: answer.token,
        label: labelFor(parsed.server),
        user: answer.user,
        info: answer.server,
        deviceId: answer.device.id,
        addedAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  // Opened by a manubrium:// link: connect straight away, once.
  useEffect(() => {
    if (props.initialLink) go(props.initialLink);
  }, []);

  async function scan() {
    const text = await scanQr();
    if (text) {
      setLink(text);
      go(text);
    }
  }

  return (
    <div class="screen">
      <TopBar title="Add a server" onBack={props.canCancel ? props.onCancel : undefined} />
      <main class="content narrow">
        <div class="welcome">
          <Mark big />
          <p>
            On the OpenPairings server, open your account page, go to <strong>Manubrium app</strong> and choose{" "}
            <strong>Connect a phone</strong>. Then scan the code it shows.
          </p>
        </div>

        {native && (
          <button type="button" class="btn primary block" id="scan" onClick={scan} disabled={busy}>
            Scan the code
          </button>
        )}

        <form
          class="paste"
          onSubmit={(e) => {
            e.preventDefault();
            go(link);
          }}
        >
          <label for="link">{native ? "Or paste the link under the code" : "Paste the link under the code"}</label>
          <textarea
            id="link"
            rows={3}
            value={link}
            onInput={(e) => setLink((e.target as HTMLTextAreaElement).value)}
            placeholder="manubrium://connect?server=…"
            autocomplete="off"
            spellcheck={false}
          />
          <button type="submit" class={`btn block ${native ? "" : "primary"}`} disabled={busy || !link.trim()}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </form>

        {error && <Notice kind="error">{error}</Notice>}

        <p class="fine">
          The code works once, for ten minutes. A desktop copy of OpenPairings needs “Let phones on this network connect”
          switched on, and this phone on the hall's network.
        </p>
      </main>
    </div>
  );
}
