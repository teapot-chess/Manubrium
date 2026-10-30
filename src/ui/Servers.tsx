import { useState } from "preact/hooks";
import type { Outbox } from "../queue";
import type { SavedServer } from "../servers";
import { Notice, Sheet, TopBar } from "./common";
import { t, LANGUAGES, LANGUAGE_NAMES, type LangChoice } from "../i18n";

const unsent = (n: number) => (n === 1 ? t("servers.unsent_one") : t("servers.unsent_other", { n }));

export function Servers(props: {
  servers: SavedServer[];
  current: string | null;
  outbox: Outbox;
  onPick: (base: string) => void;
  /** Back to the tournaments of the server in use, when there is one. */
  onBack?: () => void;
  onAdd: () => void;
  onRemove: (server: SavedServer, signOut: boolean) => void;
  /** The app's language choice; with `onLanguage`, the picker is shown. */
  notice?: string | null;
  onNoticeClose?: () => void;
  language?: LangChoice;
  onLanguage?: (choice: LangChoice) => void;
}) {
  const [removing, setRemoving] = useState<SavedServer | null>(null);

  return (
    <div class="screen">
      <TopBar title={t("servers.title")} subtitle={t("servers.subtitle")} onBack={props.onBack} backLabel={t("tournaments.title")} />
      <main class="content">
        {props.notice && (
          <Notice kind="info" onClose={props.onNoticeClose}>
            {props.notice}
          </Notice>
        )}
        <ul class="list" id="server-list">
          {props.servers.map((s) => {
            const waiting = props.outbox.count(s.base);
            return (
              <li key={s.base} class={`row ${s.base === props.current ? "current" : ""}`}>
                <button type="button" class="row-main" onClick={() => props.onPick(s.base)}>
                  <span class="row-title">
                    {s.label}
                    {s.info.desktop && <span class="tag">{t("servers.desktop")}</span>}
                  </span>
                  <span class="row-sub">
                    {s.user.name || s.user.email}
                    {waiting > 0 && ` · ${t("servers.waiting_to_send", { n: waiting })}`}
                  </span>
                </button>
                <button type="button" class="icon-btn subtle" aria-label={t("common.remove_server_aria", { label: s.label })} onClick={() => setRemoving(s)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" class="btn primary block" id="add-server" onClick={props.onAdd}>
          {t("servers.add")}
        </button>

        {props.onLanguage && (
          <div class="form language-choice">
            <label for="language-choice">{t("settings.language")}</label>
            <select
              id="language-choice"
              value={props.language ?? "auto"}
              onChange={(e) => props.onLanguage?.((e.target as HTMLSelectElement).value as LangChoice)}
            >
              <option value="auto">{t("settings.language_auto")}</option>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_NAMES[l]}
                </option>
              ))}
            </select>
          </div>
        )}
      </main>

      {removing && (
        <Sheet title={t("servers.remove_title", { label: removing.label })} onClose={() => setRemoving(null)}>
          <p>
            {props.outbox.count(removing.base) > 0
              ? t("servers.remove_unsent", { unsent: unsent(props.outbox.count(removing.base)) })
              : t("servers.remove_plain")}
          </p>
          <div class="sheet-actions">
            <button
              type="button"
              class="btn danger block"
              onClick={() => {
                props.onRemove(removing, true);
                setRemoving(null);
              }}
            >
              {t("servers.sign_out_and_remove")}
            </button>
            <button type="button" class="btn block" onClick={() => setRemoving(null)}>
              {t("servers.keep")}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
