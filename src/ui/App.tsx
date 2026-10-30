// The app's shell: which server, which tournament, which screen. No router -
// a phone app with five screens needs a variable, not a library.

import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { ApiError, client, type Client, type TournamentLine } from "../api";
import { Outbox } from "../queue";
import { labelFor, ServerList, type SavedServer } from "../servers";
import { onBackButton, onOpenLink, secureStorage, storage } from "../platform";
import { currentChoice, loadLanguage, onLanguageChange, saveLanguage, t as tr } from "../i18n";
import { LinkError, normaliseServer, parseConnectLink } from "../link";
import { goBack, pushBack } from "../back";
import { AddServer } from "./AddServer";
import { Servers } from "./Servers";
import { Mark, Sheet } from "./common";
import { NewTournament } from "./NewTournament";
import { Tournaments } from "./Tournaments";
import { TournamentView } from "./TournamentView";

export type Screen =
  | { name: "servers" }
  | { name: "add"; link?: string }
  | { name: "tournaments" }
  | { name: "new" }
  | { name: "tournament"; tournament: TournamentLine };

export interface Ctx {
  server: SavedServer;
  api: Client;
  outbox: Outbox;
  /** Something changed that the outbox badge or a list should show. */
  bump: () => void;
}

const serverList = new ServerList(secureStorage); // tokens: Keychain / Keystore
const outbox = new Outbox(storage);

export function App() {
  const [servers, setServers] = useState<SavedServer[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "tournaments" });
  /** A connect link from outside the app, waiting for the arbiter's yes. */
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  /** Something to tell the person on the screens that list servers. */
  const [notice, setNotice] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  const reload = useCallback(async () => {
    await loadLanguage(storage);
    await outbox.load();
    // A stored address is checked again on every load: the rule may be
    // stricter than the version that saved it, and storage can be edited.
    const stored = await serverList.all();
    const all = stored.filter((s) => {
      try {
        normaliseServer(s.base);
        return true;
      } catch (e) {
        if (!(e instanceof LinkError)) throw e;
        setNotice(tr("servers.bad_address", { label: s.label || s.base }));
        return false;
      }
    });
    const cur = await serverList.current();
    setServers(all);
    setCurrent(all.some((s) => s.base === cur) ? cur : (all[0]?.base ?? null));
  }, []);

  useEffect(() => {
    reload();
    // A link from outside the app (a browser, a chat) does nothing until
    // the arbiter says yes: any page can open one.
    onOpenLink((link) => setPendingLink(link));
  }, [reload]);

  useEffect(() => onBackButton(goBack), []);

  // A new language draws every screen again: the same as a state change.
  useEffect(() => onLanguageChange(bump), [bump]);

  // Where the back button goes from each screen; the tournament list is
  // the root, and from there Android puts the app away.
  const backTo: Screen | null =
    screen.name === "tournament" || screen.name === "new" || (screen.name === "servers" && current)
      ? { name: "tournaments" }
      : screen.name === "add" && (servers?.length ?? 0) > 0
        ? { name: "servers" }
        : null;
  const backKey = backTo ? `${screen.name}>${backTo.name}` : null;
  useEffect(() => (backTo ? pushBack(() => setScreen(backTo), "screen") : undefined), [backKey]);

  const server = servers?.find((s) => s.base === current) ?? null;
  const ctx = useMemo<Ctx | null>(
    () => (server ? { server, api: client(server.base, server.token), outbox, bump } : null),
    [server, bump],
  );

  if (servers === null)
    return (
      <div class="splash" aria-busy="true">
        <Mark big />
      </div>
    );

  // The screen stays where it is under the question, so a half-written
  // incident survives a link that nobody meant to follow.
  let pendingHost: string | null = null;
  if (pendingLink) {
    try {
      pendingHost = labelFor(parseConnectLink(pendingLink).server);
    } catch {
      pendingHost = null;
    }
  }

  return (
    <>
      {view(servers)}
      {pendingLink && (
        <ConnectAsk
          link={pendingLink}
          host={pendingHost}
          onYes={() => {
            setScreen({ name: "add", link: pendingLink });
            setPendingLink(null);
          }}
          onNo={() => setPendingLink(null)}
        />
      )}
    </>
  );

  function view(servers: SavedServer[]) {
  if (screen.name === "add" || servers.length === 0) {
    return (
      <AddServer
        key={screen.name === "add" ? (screen.link ?? "") : ""}
        notice={notice}
        onNoticeClose={() => setNotice(null)}
        initialLink={screen.name === "add" ? screen.link : undefined}
        canCancel={servers.length > 0}
        onCancel={() => setScreen({ name: "servers" })}
        onAdded={async (saved) => {
          await serverList.put(saved);
          await reload();
          setScreen({ name: "tournaments" });
        }}
      />
    );
  }

  if (screen.name === "servers" || !ctx) {
    return (
      <Servers
        servers={servers}
        current={current}
        outbox={outbox}
        onBack={ctx ? () => setScreen({ name: "tournaments" }) : undefined}
        onPick={async (base) => {
          await serverList.setCurrent(base);
          setCurrent(base);
          setScreen({ name: "tournaments" });
        }}
        onAdd={() => setScreen({ name: "add" })}
        language={currentChoice()}
        onLanguage={(choice) => void saveLanguage(storage, choice)}
        notice={notice}
        onNoticeClose={() => setNotice(null)}
        onRemove={async (s, signOut) => {
          if (signOut) {
            // Already revoked (401/403) is as good as signed out; anything
            // else means the server still counts this phone as connected.
            const failed = await client(s.base, s.token)
              .signOut()
              .then(() => false)
              .catch((e) => !(e instanceof ApiError && (e.status === 401 || e.status === 403)));
            if (failed) setNotice(tr("servers.signout_failed", { label: s.label }));
          }
          await outbox.forgetServer(s.base);
          await serverList.remove(s.base);
          await reload();
        }}
      />
    );
  }

  if (screen.name === "tournament") {
    return (
      <TournamentView
        key={`${ctx.server.base}#${screen.tournament.id}`}
        ctx={ctx}
        line={screen.tournament}
        onBack={() => setScreen({ name: "tournaments" })}
      />
    );
  }

  if (screen.name === "new") {
    return (
      <NewTournament
        ctx={ctx}
        onCancel={() => setScreen({ name: "tournaments" })}
        onCreated={(t) => setScreen({ name: "tournament", tournament: t })}
      />
    );
  }

  return (
    <Tournaments
      ctx={ctx}
      onServers={() => setScreen({ name: "servers" })}
      onNew={() => setScreen({ name: "new" })}
      onOpen={(t) => setScreen({ name: "tournament", tournament: t })}
    />
  );
  }
}

/**
 * Asks before a link from outside the app connects anything. A link that is
 * not a connect link at all has nothing to ask about: the add screen shows
 * what is wrong with it, and connects to nothing.
 */
function ConnectAsk(props: { link: string; host: string | null; onYes: () => void; onNo: () => void }) {
  const { host, onYes } = props;
  // Not a usable link: let the add screen explain, once.
  useEffect(() => {
    if (host === null) onYes();
  }, [host]);
  if (host === null) return null;
  return (
    <Sheet title={tr("connect.ask_title", { host })} onClose={props.onNo}>
      <p>{tr("connect.ask_text", { host })}</p>
      <div class="sheet-actions">
        <button type="button" class="btn primary block" id="connect-link-yes" onClick={props.onYes}>
          {tr("connect.ask_yes")}
        </button>
        <button type="button" class="btn block" id="connect-link-no" onClick={props.onNo}>
          {tr("connect.ask_no")}
        </button>
      </div>
    </Sheet>
  );
}
