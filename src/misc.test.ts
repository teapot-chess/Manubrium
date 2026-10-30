import { afterEach, describe, expect, it, vi } from "vitest";
import { byeLabel } from "./byes";
import { today } from "./dates";

describe("bye kinds", () => {
  it("are shown in the app's language, and an unknown one stays as the server wrote it", () => {
    expect(byeLabel("requested-half")).toBe("Half-point bye");
    expect(byeLabel("absent")).toBe("Absent");
    expect(byeLabel("pairing-allocated")).toBe("pairing-allocated");
    expect(byeLabel("constructor")).toBe("constructor");
  });
});

describe("today's date for a new tournament", () => {
  afterEach(() => vi.useRealTimers());

  it("is the phone's calendar day, not UTC's", () => {
    vi.useFakeTimers();
    // 00:30 local on 12 October: UTC would still say the 11th in Belgium.
    vi.setSystemTime(new Date(2026, 9, 12, 0, 30));
    expect(today()).toBe("2026-10-12");
    vi.setSystemTime(new Date(2026, 0, 3, 23, 59));
    expect(today()).toBe("2026-01-03");
  });
});
