// The round on the iPhone's lock screen and in the Dynamic Island: "Round 5:
// 23 of 32 results". Started by the app when a round is in progress, kept
// current by the app while it is open and by the server's `liveactivity`
// pushes while it is not, ended when the last result is in.
//
// The native half is the RoundActivity plugin (ios/App/App/RoundActivityPlugin.swift)
// and the widget extension in ios/App/RoundActivity. Anywhere else - Android,
// a browser, an iPhone before iOS 16.2 - `info()` says unsupported and
// nothing here does anything.

import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { Client, PushEnvironment, Round } from "./api";

export interface RoundActivityStart {
  key: string;
  tournament: string;
  round: number;
  /** "Round 5", in the app's language. */
  title: string;
  /** "{done} of {total} results", in the app's language; the widget fills it in. */
  format: string;
  done: number;
  total: number;
}

export interface RoundActivityPlugin {
  info(): Promise<{ supported: boolean; enabled: boolean; environment: PushEnvironment }>;
  start(options: RoundActivityStart): Promise<void>;
  update(options: { key: string; done: number; total: number }): Promise<void>;
  end(options: { key: string; done: number; total: number }): Promise<void>;
  addListener(event: "pushToken", handler: (e: { key: string; token: string }) => void): Promise<PluginListenerHandle>;
}

export const RoundActivity = registerPlugin<RoundActivityPlugin>("RoundActivity");

/** How far the round is: games with a result, out of the games (byes and empty seats are not games). */
export function progress(round: Round): { done: number; total: number } {
  const games = round.boards.filter((b) => b.white && b.black && !b.bye);
  return { done: games.filter((b) => !!b.result).length, total: games.length };
}

export const activityKey = (base: string, tournament: number) => `${base}#${tournament}`;

/** What should happen to the activity for this round, given what is running. */
export function plan(round: Round, running: { round: number; done: number; total: number } | undefined): "start" | "update" | "end" | "none" {
  const { done, total } = progress(round);
  const complete = total > 0 && done >= total;
  if (!round.latest || total === 0) return running && running.round === round.number && complete ? "end" : "none";
  if (complete) return running ? "end" : "none";
  if (!running || running.round !== round.number) return "start";
  return running.done === done && running.total === total ? "none" : "update";
}

interface Running {
  round: number;
  done: number;
  total: number;
  api: Client;
  tournament: number;
}

/**
 * Keeps one activity per server and tournament in step with the round on
 * screen, and hands each activity's push token to its server.
 */
export class LiveActivities {
  private running = new Map<string, Running>();
  private listening: Promise<PluginListenerHandle> | null = null;
  private info: Promise<{ supported: boolean; enabled: boolean; environment: PushEnvironment }> | null = null;

  constructor(private readonly plugin: RoundActivityPlugin = RoundActivity) {}

  async supported(): Promise<boolean> {
    this.info ??= this.plugin.info().catch(() => ({ supported: false, enabled: false, environment: "production" as const }));
    const i = await this.info;
    return i.supported && i.enabled;
  }

  async sync(o: { base: string; api: Client; tournament: number; name: string; round: Round; title: string; format: string; on: boolean }): Promise<void> {
    if (!(await this.supported())) return;
    const key = activityKey(o.base, o.tournament);
    const running = this.running.get(key);
    if (!o.on) {
      if (running) await this.stop(key, running);
      return;
    }
    const { done, total } = progress(o.round);
    const step = plan(o.round, running);
    try {
      if (step === "start") {
        this.listen();
        if (running) await this.plugin.end({ key, done: running.done, total: running.total });
        await this.plugin.start({ key, tournament: o.name, round: o.round.number, title: o.title, format: o.format, done, total });
        this.running.set(key, { round: o.round.number, done, total, api: o.api, tournament: o.tournament });
      } else if (step === "update") {
        await this.plugin.update({ key, done, total });
        this.running.set(key, { ...running!, done, total });
      } else if (step === "end") {
        await this.stop(key, running!, done, total);
      }
    } catch {
      // The person switched Live Activities off in Settings, or the system
      // refused one more: the round screen works the same without it.
    }
  }

  private async stop(key: string, running: Running, done = running.done, total = running.total) {
    this.running.delete(key);
    await this.plugin.end({ key, done, total }).catch(() => undefined);
    await running.api.deleteLiveActivity(running.tournament).catch(() => undefined);
  }

  private listen() {
    this.listening ??= this.plugin.addListener("pushToken", async ({ key, token }) => {
      const r = this.running.get(key);
      if (!r) return;
      const { environment } = await (this.info ?? this.plugin.info());
      await r.api.putLiveActivity(r.tournament, { round: r.round, token, environment }).catch(() => undefined);
    });
  }
}

export const liveActivities = new LiveActivities();
