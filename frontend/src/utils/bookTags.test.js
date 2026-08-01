import { describe, expect, it } from "vitest";
import { collectBookTags, normalizeBookTag } from "./bookTags.js";

describe("book tag utilities", () => {
  it("normalizes whitespace and collects reusable labels without case duplicates", () => {
    expect(normalizeBookTag("  Climate   Fiction ")).toBe("Climate Fiction");
    expect(collectBookTags([
      { tags: ["Climate Fiction", "Bechdel Pass"] },
      { tags: [" climate fiction ", "Classic"] },
      {},
    ])).toEqual(["Bechdel Pass", "Classic", "Climate Fiction"]);
  });
});
