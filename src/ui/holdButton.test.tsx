// @vitest-environment happy-dom
//
// The button every result is entered with, in the DOM: a tap enters nothing
// and says how it works, a second's hold enters, and lifting or sliding off
// before then cancels. Touch, mouse and keyboard. Fake timers.

import { act, cleanup, fireEvent, render } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { HOLD_MS, holdTiming } from "../hold";
import { HoldButton } from "./HoldButton";

const NOTICE = "Hold for a second to lock the result";

let onLock: Mock<() => void>;

function show(props: { disabled?: boolean } = {}) {
  onLock = vi.fn<() => void>();
  render(
    <HoldButton id="hold-me" onLock={onLock} {...props}>
      1-0
    </HoldButton>,
  );
  return document.querySelector<HTMLButtonElement>("#hold-me")!;
}

const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
const touch = { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0 };
const notice = () => document.querySelector('[role="status"]')?.textContent ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  holdTiming.ms = HOLD_MS;
  holdTiming.buzz = vi.fn() as never;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the hold button, by touch or mouse", () => {
  it("does not enter on a tap, and shows the notice", async () => {
    const b = show();
    await act(async () => void fireEvent.pointerDown(b, touch));
    await wait(120);
    await act(async () => void fireEvent.pointerUp(b, touch));
    await act(async () => void fireEvent.click(b));
    await wait(HOLD_MS * 2);
    expect(onLock).not.toHaveBeenCalled();
    expect(notice()).toBe(NOTICE);
  });

  it("enters once after a second, with the fill running, and does not show the notice for the click that follows", async () => {
    const b = show();
    await act(async () => void fireEvent.pointerDown(b, touch));
    expect(b.className).toContain("holding");
    await wait(999);
    expect(onLock).not.toHaveBeenCalled();
    await wait(1);
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(b.className).not.toContain("holding");
    await act(async () => void fireEvent.pointerUp(b, touch));
    await act(async () => void fireEvent.click(b));
    await wait(5000);
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(notice()).toBeNull();
    expect(holdTiming.buzz).toHaveBeenCalled();
  });

  it("cancels when the finger slides off before a second, and says nothing", async () => {
    const b = show();
    await act(async () => void fireEvent.pointerDown(b, touch));
    await wait(700);
    await act(async () => void fireEvent.pointerLeave(b, touch));
    await wait(5000);
    expect(onLock).not.toHaveBeenCalled();
    expect(notice()).toBeNull();
    expect(b.className).not.toContain("holding");
  });

  it("cancels when the page scrolls, which the browser tells as pointercancel", async () => {
    const b = show();
    await act(async () => void fireEvent.pointerDown(b, touch));
    await wait(700);
    await act(async () => void fireEvent.pointerCancel(b, touch));
    await wait(5000);
    expect(onLock).not.toHaveBeenCalled();
  });

  it("lets go of the pointer capture a touch gets, so sliding off is seen", async () => {
    const b = show();
    const release = vi.fn();
    (b as unknown as Record<string, unknown>).hasPointerCapture = () => true;
    (b as unknown as Record<string, unknown>).releasePointerCapture = release;
    await act(async () => void fireEvent.pointerDown(b, touch));
    expect(release).toHaveBeenCalledWith(1);
  });

  it("takes only the main mouse button", async () => {
    const b = show();
    await act(async () => void fireEvent.pointerDown(b, { pointerId: 2, pointerType: "mouse", button: 2 }));
    await wait(2000);
    expect(onLock).not.toHaveBeenCalled();
  });

  it("a bare click - an assistive technology's activate - enters nothing either", async () => {
    const b = show();
    await act(async () => void fireEvent.click(b));
    expect(onLock).not.toHaveBeenCalled();
    expect(notice()).toBe(NOTICE);
  });

  it("does not hold while disabled", async () => {
    const b = show({ disabled: true });
    await act(async () => void fireEvent.pointerDown(b, touch));
    await wait(2000);
    expect(onLock).not.toHaveBeenCalled();
  });

  it("clears the notice after a moment", async () => {
    const b = show();
    await act(async () => void fireEvent.click(b));
    expect(notice()).toBe(NOTICE);
    await wait(3000);
    expect(notice()).toBeNull();
  });
});

describe("the hold button, by keyboard", () => {
  it("enters when Enter is held for a second, and Enter's own click does not happen", async () => {
    const b = show();
    let allowed = true;
    await act(async () => void (allowed = fireEvent.keyDown(b, { key: "Enter" })));
    expect(allowed, "keydown is not left to click").toBe(false);
    await wait(500);
    await act(async () => void fireEvent.keyDown(b, { key: "Enter", repeat: true }));
    await wait(500);
    expect(onLock).toHaveBeenCalledTimes(1);
    await act(async () => void fireEvent.keyUp(b, { key: "Enter" }));
    expect(notice()).toBeNull();
  });

  it("enters when Space is held, and Space's click on key up does not happen", async () => {
    const b = show();
    await act(async () => void fireEvent.keyDown(b, { key: " " }));
    await wait(1000);
    expect(onLock).toHaveBeenCalledTimes(1);
    let allowed = true;
    await act(async () => void (allowed = fireEvent.keyUp(b, { key: " " })));
    expect(allowed, "keyup is not left to click").toBe(false);
  });

  it("a quick press of Enter or Space enters nothing and shows the notice", async () => {
    const b = show();
    await act(async () => void fireEvent.keyDown(b, { key: "Enter" }));
    await wait(100);
    await act(async () => void fireEvent.keyUp(b, { key: "Enter" }));
    await wait(2000);
    expect(onLock).not.toHaveBeenCalled();
    expect(notice()).toBe(NOTICE);
  });

  it("cancels when focus leaves mid-hold", async () => {
    const b = show();
    await act(async () => void fireEvent.keyDown(b, { key: " " }));
    await wait(500);
    await act(async () => void fireEvent.blur(b));
    await wait(2000);
    expect(onLock).not.toHaveBeenCalled();
  });

  it("leaves other keys alone", async () => {
    const b = show();
    let allowed = false;
    await act(async () => void (allowed = fireEvent.keyDown(b, { key: "Tab" })));
    expect(allowed).toBe(true);
  });
});

describe("what a screen reader is told", () => {
  it("has a description that explains the hold, and the button points at it", () => {
    const b = show();
    const id = b.getAttribute("aria-describedby")!;
    expect(document.getElementById(id)?.textContent).toContain("hold");
  });

  it("carries the hold's length for the fill, which the reduced-motion style replaces with an outline", () => {
    const b = show();
    expect(b.getAttribute("style")).toContain("--hold-ms: 1000ms");
  });
});
