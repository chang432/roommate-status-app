import { describe, expect, it } from "vitest";
import { completedDaysSince, DAY_MS } from "./counters.js";

describe("completedDaysSince", () => {
  it("counts only complete 24-hour periods", () => {
    const now = 10 * DAY_MS;
    expect(completedDaysSince(now - (2 * DAY_MS + DAY_MS / 2), now)).toBe(2);
    expect(completedDaysSince(now - DAY_MS + 1, now)).toBe(0);
    expect(completedDaysSince(now + DAY_MS, now)).toBe(0);
  });
});
