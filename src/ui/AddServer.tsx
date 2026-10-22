import { useEffect, useState } from "preact/hooks";
import { connect } from "../api";
import { LinkError, parseConnectLink } from "../link";
import { deviceName, native, platform, scanQr } from "../platform";
import { labelFor, type SavedServer } from "../servers";
import { describeError, Mark, Notice, TopBar } from "./common";
import { t } from "../i18n";

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
      <TopBar title={t("addserver.title")} onBack={props.canCancel ? props.onCancel : undefined} />
      <main class="content narrow">
        <div class="welcome">
          <Mark big />
          <p>
            {t("addserver.welcome_1")}
            <strong>{t("addserver.welcome_app")}</strong>
            {t("addserver.welcome_2")}
            <strong>{t("addserver.welcome_connect")}</strong>
            {t("addserver.welcome_3")}
          </p>
        </div>

        {native && (
          <button type="button" class="btn primary block" id="scan" onClick={scan} disabled={busy}>
            {t("addserver.scan")}
          </button>
        )}

        <form
          class="paste"
          onSubmit={(e) => {
            e.preventDefault();
            go(link);
          }}
        >
          <label for="link">{native ? t("addserver.paste_native") : t("addserver.paste")}</label>
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
            {busy ? t("addserver.connecting") : t("addserver.connect")}
          </button>
        </form>

        {error && <Notice kind="error">{error}</Notice>}

        <p class="fine">
          {t("addserver.fine")}
        </p>
      </main>
    </div>
  );
}
