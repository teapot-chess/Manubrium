// The tournament on the iPhone's lock screen and in the Dynamic Island:
// "Round 5: 23 of 32 results". One activity per server and tournament, for
// the whole event: started by the app when a round is on screen, kept current
// by the app while it is open and by the server's `liveactivity` pushes while
// it is not. A complete round does not end it: it says "Round 5: all results
// in" until round 6 is paired, and the server moves it on. It ends when the
// tournament is finished, archived or binned, or the person switches it off.
//
// iOS ends any activity after eight hours. From iOS 17.2 the phone has a
// push-to-start token, which goes to every server that can push (`connect`):
// the server then starts a fresh activity on the next change, and the app
// hands that activity's token over the next time it runs.
//
// The native half is the RoundActivity plugin (ios/App/App/RoundActivityPlugin.swift)
// and the widget extension in ios/App/RoundActivity. Anywhere else - Android,
// a browser, an iPhone before iOS 16.2 - `info()` says unsupported and
// nothing here does anything.

import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { Client, PushEnvironment, PushStatus, Round } from "./api";
import { serverCanPush } from "./push";
import type { SavedServer } from "./servers";

/** paired: no result yet; playing; complete: every game has a result; finished: the tournament is over. */
export type Phase = "paired" | "playing" | "complete" | "finished";

export interface ActivityState {
  round: number;
  done: number;
  total: number;
  phase: Phase;
}

/** The app's strings the activity is drawn with, in its language. */
export interface ActivityStrings {
  /** "Round {n}". */
  title: string;
  /** "{done} of {total} results". */
  format: string;
  /** "All results in". */
  complete: string;
}

export interface RoundActivityStart extends ActivityState {
  key: string;
  tournament: string;
  /** "Round 5": the heading an older widget build shows. */
  title: string;
  format: string;
  /** "Round {n}": the heading for whichever round the state names. */
  roundTitle: string;
  complete: string;
}

export interface ActivityInfo {
  supported: boolean;
  enabled: boolean;
  /** iOS 17.2+: the server can start one by push. */
  pushToStart?: boolean;
  environment: PushEnvironment;
}

export interface RoundActivityPlugin {
  info(): Promise<ActivityInfo>;
  /** Starts the activity, or brings the one already running with this key up to date. */
  start(options: RoundActivityStart): Promise<void>;
  update(options: { key: string } & ActivityState): Promise<void>;
  end(options: { key: string } & ActivityState): Promise<void>;
  addListener(event: "pushToken", handler: (e: { key: string; token: string; round?: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: "startToken", handler: (e: { token: string }) => void): Promise<PluginListenerHandle>;
}

export const RoundActivity = registerPlugin<RoundActivityPlugin>("RoundActivity");

/** How far the round is: games with a result, out of the games (byes and empty seats are not games). */
export function progress(round: Round): { done: number; total: number } {
  const games = round.boards.filter((b) => b.white && b.black && !b.bye);
  return { done: games.filter((b) => !!b.result).length, total: games.length };
}

export function phaseOf(done: number, total: number, finished: boolean): Phase {
  if (finished) return "finished";
  if (total > 0 && done >= total) return "complete";
  return done === 0 ? "paired" : "playing";
}

export function stateOf(round: Round, finished: boolean): ActivityState {
  const { done, total } = progress(round);
  return { round: round.number, done, total, phase: phaseOf(done, total, finished) };
}

export const activityKey = (base: string, tournament: number) => `${base}#${tournament}`;

/** The server and tournament an activity key names, or null. */
export function parseKey(key: string): { base: string; tournament: number } | null {
  const at = key.lastIndexOf("#");
  const tournament = Number(key.slice(at + 1));
  if (at <= 0 || !Number.isInteger(tournament) || tournament <= 0) return null;
  return { base: key.slice(0, at), tournament };
}

/**
 * What should happen to the tournament's activity, given the round on
 * screen and what is running. Only the current round speaks for it; a
 * complete round keeps it, the end of the tournament ends it.
 */
export function plan(round: Round, running: ActivityState | undefined, finished: boolean): "start" | "update" | "end" | "none" {
  if (finished) return running ? "end" : "none";
  const next = stateOf(round, false);
  if (!round.latest || next.total === 0) return "none";
  if (!running) return "start";
  // The server moved it on while this screen still showed the round before.
  if (running.round > next.round) return "none";
  return running.round === next.round && running.done === next.done && running.total === next.total && running.phase === next.phase ? "none" : "update";
}

interface Running extends ActivityState {
  api: Client;
  tournament: number;
}

/** What `connect` needs to know about the phone's servers. */
export interface Servers {
  servers: SavedServer[];
  api: (server: SavedServer) => Client;
  /** The lock-screen switch. */
  on: boolean;
  strings: ActivityStrings;
}

/**
 * Keeps one activity per server and tournament in step with the round on
 * screen, and hands each activity's push token, and the phone's
 * push-to-start token, to the server it belongs to.
 */
export class LiveActivities {
  private running = new Map<string, Running>();
  private listening: Promise<unknown> | null = null;
  private info: Promise<ActivityInfo> | null = null;
  private servers: Servers | null = null;
  private startToken: string | null = null;
  private cleared = new Set<string>();

  constructor(private readonly plugin: RoundActivityPlugin = RoundActivity) {}

  async supported(): Promise<boolean> {
    const i = await this.details();
    return i.supported && i.enabled;
  }

  private details(): Promise<ActivityInfo> {
    this.info ??= this.plugin.info().catch((): ActivityInfo => ({ supported: false, enabled: false, environment: "production" }));
    return this.info;
  }

  /**
   * The phone's servers, at start and whenever they or the switch change:
   * where an activity started by push sends its token, and which servers
   * get (or lose) the push-to-start token.
   */
  async connect(servers: Servers): Promise<void> {
    this.servers = servers;
    const i = await this.details();
    if (!i.supported) return;
    this.listen();
    await this.shareStartToken();
  }

  async sync(o: {
    base: string;
    api: Client;
    tournament: number;
    name: string;
    round: Round;
    finished?: boolean;
    strings: ActivityStrings;
    on: boolean;
  }): Promise<void> {
    if (!(await this.supported())) return;
    const key = activityKey(o.base, o.tournament);
    const running = this.running.get(key);
    if (!o.on) {
      if (running) await this.stop(key, running);
      else if (!this.cleared.has(key)) {
        // Switched off while the app was closed: one left from before, or
        // one the server started, goes too. Once per run is enough.
        this.cleared.add(key);
        await this.plugin.end({ key, ...stateOf(o.round, false) }).catch(() => undefined);
        await o.api.deleteLiveActivity(o.tournament).catch(() => undefined);
      }
      return;
    }
    this.cleared.delete(key);
    const finished = !!o.finished;
    const step = plan(o.round, running, finished);
    const state = stateOf(o.round, finished);
    try {
      if (step === "start") {
        this.listen();
        await this.plugin.start({
          key,
          tournament: o.name,
          ...state,
          title: o.strings.title.replace("{n}", String(state.round)),
          format: o.strings.format,
          roundTitle: o.strings.title,
          complete: o.strings.complete,
        });
        this.running.set(key, { ...state, api: o.api, tournament: o.tournament });
      } else if (step === "update") {
        await this.plugin.update({ key, ...state });
        this.running.set(key, { ...running!, ...state });
      } else if (step === "end") {
        await this.stop(key, running!, state);
      }
    } catch {
      // The person switched Live Activities off in Settings, or the system
      // refused one more: the round screen works the same without it.
    }
  }

  private async stop(key: string, running: Running, state: ActivityState = running) {
    this.running.delete(key);
    const { round, done, total, phase } = state;
    await this.plugin.end({ key, round, done, total, phase }).catch(() => undefined);
    await running.api.deleteLiveActivity(running.tournament).catch(() => undefined);
  }

  private listen() {
    this.listening ??= Promise.all([
      this.plugin.addListener("pushToken", (e) => void this.sendToken(e)),
      this.plugin.addListener("startToken", ({ token }) => {
        this.startToken = token;
        void this.shareStartToken();
      }),
    ]).catch(() => undefined);
  }

  private async sendToken({ key, token, round }: { key: string; token: string; round?: number }) {
    const { environment } = await this.details();
    const r = this.running.get(key);
    let target: { api: Client; tournament: number; round: number } | null = r ? { api: r.api, tournament: r.tournament, round: round ?? r.round } : null;
    if (!target) {
      // Started by the server while the app was closed: find whose it is.
      const named = parseKey(key);
      const server = named && this.servers?.servers.find((s) => s.base === named.base);
      if (!named || !server || !round) return;
      target = { api: this.servers!.api(server), tournament: named.tournament, round };
    }
    await target.api.putLiveActivity(target.tournament, { round: target.round, token, environment, follows: "tournament" }).catch(() => undefined);
  }

  /** The push-to-start token to every server that can push to this phone, or away from all of them when switched off. */
  private async shareStartToken() {
    const s = this.servers;
    const token = this.startToken;
    if (!s || !token) return;
    const { environment } = await this.details();
    await Promise.all(
      s.servers.map(async (server) => {
        const api = s.api(server);
        try {
          if (!s.on) return await api.deleteLiveActivityStart();
          const status: PushStatus = await api.pushStatus();
          if (!serverCanPush(status, "apns")) return;
          await api.putLiveActivityStart({ token, environment, tag: server.base, ...s.strings });
        } catch {
          // Offline, or a server from before revision 10: it cannot start one.
        }
      }),
    );
  }
}

export const liveActivities = new LiveActivities();
