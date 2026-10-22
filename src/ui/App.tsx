// The app's shell: which server, which tournament, which screen. No router -
// a phone app with five screens needs a variable, not a library.

import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { client, type Client, type TournamentLine } from "../api";
import { Outbox } from "../queue";
import { ServerList, type SavedServer } from "../servers";
import { onBackButton, onOpenLink, secureStorage, storage } from "../platform";
import { currentChoice, loadLanguage, onLanguageChange, saveLanguage } from "../i18n";
import { goBack, pushBack } from "../back";
import { AddServer } from "./AddServer";
import { Servers } from "./Servers";
import { Mark } from "./common";
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
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);

  const reload = useCallback(async () => {
    await loadLanguage(storage);
    await outbox.load();
    const all = await serverList.all();
    const cur = await serverList.current();
    setServers(all);
    setCurrent(all.some((s) => s.base === cur) ? cur : (all[0]?.base ?? null));
  }, []);

  useEffect(() => {
    reload();
    onOpenLink((link) => setScreen({ name: "add", link }));
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

  if (screen.name === "add" || servers.length === 0) {
    return (
      <AddServer
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
        onRemove={async (s, signOut) => {
          if (signOut) await client(s.base, s.token).signOut().catch(() => undefined);
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
