// The way back. Android's back button (and Escape, in a browser or with a
// keyboard) closes the sheet on top, then goes back a screen, and only at
// the root leaves the app. Without this the button had nothing to go back
// through - no router, no history - and simply put the app away, sheet and
// half-typed incident with it.
//
// Whoever opens something says how to close it: `pushBack` returns the undo,
// which is what a `useEffect` wants back. Sheets sit above screens, whatever
// order the effects ran in.

export type Level = "sheet" | "screen";
type Handler = () => void;

const stacks: Record<Level, Handler[]> = { sheet: [], screen: [] };

export function pushBack(handler: Handler, level: Level = "sheet"): () => void {
  const stack = stacks[level];
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Goes back one step; false when there is nothing left to go back from. */
export function goBack(): boolean {
  const handler = stacks.sheet.at(-1) ?? stacks.screen.at(-1);
  if (!handler) return false;
  handler();
  return true;
}

/** For tests: forget every handler. */
export function resetBack(): void {
  stacks.sheet.length = 0;
  stacks.screen.length = 0;
}
