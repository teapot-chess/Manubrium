import { describe, expect, it } from "vitest";
import type { SearchHit } from "./api";
import { byeRows, byesChanged, byesToSend, setBye } from "./byes";
import { hitDetails, searchQuery, sourceOf } from "./search";

describe("byes", () => {
  const asked = [
    { round: 2, kind: "half" },
    { round: 5, kind: "zero" },
  ];

  it("has a row per round, the paired ones locked", () => {
    expect(byeRows(5, 2, asked)).toEqual([
      { round: 1, kind: null, locked: true },
      { round: 2, kind: "half", locked: true },
      { round: 3, kind: null, locked: false },
      { round: 4, kind: null, locked: false },
      { round: 5, kind: "zero", locked: false },
    ]);
  });

  it("still shows a bye beyond the last round, should the rounds have been cut", () => {
    expect(byeRows(3, 0, asked).map((r) => r.round)).toEqual([1, 2, 3, 4, 5]);
    expect(byeRows(0, 0, [])).toEqual([]);
  });

  it("asks for, changes and drops a bye, in round order", () => {
    const one = setBye(asked, 4, "half", 2);
    expect(one).toEqual([...asked.slice(0, 1), { round: 4, kind: "half" }, asked[1]]);
    expect(setBye(one, 4, "zero", 2)).toContainEqual({ round: 4, kind: "zero" });
    expect(setBye(one, 5, null, 2)).toEqual([asked[0], { round: 4, kind: "half" }]);
  });

  it("leaves a paired round alone", () => {
    expect(setBye(asked, 2, null, 2)).toBe(asked);
    expect(setBye(asked, 1, "half", 2)).toBe(asked);
  });

  it("sends only the rounds not paired yet", () => {
    expect(byesToSend(asked, 2)).toEqual([{ round: 5, kind: "zero" }]);
    expect(byesToSend(asked, 0)).toEqual(asked);
  });

  it("knows when there is nothing to save", () => {
    expect(byesChanged(asked, [...asked].reverse(), 2)).toBe(false);
    expect(byesChanged(asked, setBye(asked, 3, "half", 2), 2)).toBe(true);
    // A paired round's bye is not the phone's to change, so it never counts as one.
    expect(byesChanged(asked, asked.slice(1), 2)).toBe(false);
  });
});

describe("player search", () => {
  const hit = (extra: Partial<SearchHit>): SearchHit => ({
    source: "fide",
    fide_id: 1503014,
    national_id: null,
    name: "Carlsen, Magnus",
    federation: "NOR",
    title: "GM",
    sex: "m",
    birth_year: 1990,
    fide_rating: 2830,
    national_rating: null,
    club: null,
    already_in: false,
    ...extra,
  });

  it("waits for three letters, and tidies the spaces", () => {
    expect(searchQuery("")).toBeNull();
    expect(searchQuery("  ca ")).toBeNull();
    expect(searchQuery(" carl ")).toBe("carl");
    expect(searchQuery("van  der   Berg")).toBe("van der Berg");
    expect(searchQuery("Öst")).toBe("Öst");
  });

  it("adds a FIDE hit by its FIDE id and a national one by its national id", () => {
    expect(sourceOf(hit({}))).toEqual({ source: "fide", fide_id: 1503014 });
    expect(sourceOf(hit({ source: "bel", fide_id: 205000, national_id: 12345 }))).toEqual({ source: "bel", national_id: 12345 });
  });

  it("refuses a hit with no id to go by", () => {
    expect(sourceOf(hit({ fide_id: null }))).toBeNull();
    expect(sourceOf(hit({ source: "bel", national_id: "" }))).toBeNull();
  });

  it("says what tells two namesakes apart", () => {
    expect(hitDetails(hit({ national_rating: 2700, club: "Hall CC" }))).toBe("FIDE 2830 · national 2700 · NOR · Hall CC · 1990");
    expect(hitDetails(hit({ fide_rating: null, federation: null, birth_year: null }))).toBe("");
  });
});
