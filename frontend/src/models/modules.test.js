import { describe, expect, it } from "vitest";
import { createModule, createModules } from "./modules.js";

describe("feed module normalization", () => {
  it("returns a plain normalized module with safe defaults", () => {
    const module = createModule({
      id: "event-1",
      type: "events",
      createdAt: "10",
    });

    expect(Object.getPrototypeOf(module)).toBe(Object.prototype);
    expect(module).toEqual({
      id: "event-1",
      type: "events",
      createdAt: 10,
      updatedAt: 10,
      sortAt: 10,
      title: "Module",
      subtitle: "",
      actor: "Someone",
      isArchived: false,
      payload: {},
    });
  });

  it("sorts modules by their latest material update", () => {
    const modules = createModules([
      { id: "older", type: "events", createdAt: 1, sortAt: 4 },
      { id: "newer", type: "polls", createdAt: 2, sortAt: 5 },
    ]);

    expect(modules.map(({ id }) => id)).toEqual(["newer", "older"]);
  });
});
