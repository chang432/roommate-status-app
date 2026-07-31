import { beforeEach, describe, expect, it } from "vitest";
import {
  modulePreferenceKey,
  readModulePreferences,
  sanitizeAllTypes,
  sanitizeModuleOrder,
} from "./modulePreferences.js";

const KEY = modulePreferenceKey("andre", "shire");

describe("module preferences", () => {
  beforeEach(() => localStorage.clear());

  it("repairs unknown and duplicate order entries", () => {
    const order = sanitizeModuleOrder(["tv", "unknown", "tv", "events"]);

    expect(order.slice(0, 2)).toEqual(["tv", "events"]);
    expect(new Set(order).size).toBe(order.length);
    expect(order).toContain("book-club");
  });

  it("does not allow All to become an empty category", () => {
    expect(sanitizeAllTypes([], ["events", "polls"])).toEqual(["events"]);
  });

  it("upgrades legacy preferences without overriding later exclusions", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        order: ["events", "requests", "checklists", "tv"],
        allTypes: ["events"],
      }),
    );
    expect(readModulePreferences("andre", "shire").allTypes).toEqual(
      expect.arrayContaining(["events", "book-club", "polls"]),
    );

    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 3,
        order: ["events", "book-club", "polls"],
        allTypes: ["events"],
      }),
    );
    expect(readModulePreferences("andre", "shire").allTypes).toEqual([
      "events",
    ]);
  });
});
