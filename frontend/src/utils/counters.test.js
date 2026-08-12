import { describe, expect, it } from "vitest";
import { completedDaysSince, dateInTimeZone, formatCounterDate } from "./counters.js";

describe("completedDaysSince", () => {
  it("counts calendar dates rather than elapsed time", () => {
    expect(completedDaysSince("2024-01-01", "2024-01-03")).toBe(2);
    expect(completedDaysSince("2024-01-01", "2024-01-02")).toBe(1);
    expect(completedDaysSince("2024-01-03", "2024-01-02")).toBe(0);
  });
});

describe("counter date helpers", () => {
  it("formats a timestamp as the selected timezone's calendar date", () => {
    const timestamp = Date.parse("2024-01-02T00:30:00Z");
    expect(dateInTimeZone(timestamp, "America/Los_Angeles")).toBe("2024-01-01");
  });

  it("formats history dates without a time component", () => {
    expect(formatCounterDate("2024-01-03")).toMatch(/1\/3\/2024/);
  });
});
