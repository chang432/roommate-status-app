import { beforeEach, describe, expect, it } from "vitest";
import {
  modulePreferenceKey,
  normalizeModulePreferences,
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
      expect.arrayContaining(["events", "book-club", "polls", "forums"]),
    );

    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 6,
        order: [
          "events",
          "requests",
          "checklists",
          "polls",
          "counters",
          "tv",
          "book-club",
          "forums",
        ],
        allTypes: ["events"],
        knownTypes: [
          "events",
          "requests",
          "checklists",
          "polls",
          "counters",
          "tv",
          "book-club",
          "forums",
        ],
      }),
    );
    expect(readModulePreferences("andre", "shire").allTypes).toEqual([
      "events",
    ]);
  });

  it("selects future registry types once without reviving known exclusions", () => {
    const preferences = normalizeModulePreferences(
      {
        order: ["events", "polls"],
        allTypes: ["events"],
        knownTypes: ["events", "polls"],
      },
      ["events", "polls", "new-module"],
    );

    expect(preferences.allTypes).toEqual(["events", "new-module"]);
    expect(preferences.knownTypes).toEqual([
      "events",
      "polls",
      "new-module",
    ]);
  });
});
