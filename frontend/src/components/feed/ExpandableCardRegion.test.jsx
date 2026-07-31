import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ExpandableCardRegion from "./ExpandableCardRegion.jsx";

describe("ExpandableCardRegion", () => {
  it("makes collapsed controls inert and restores them when expanded", () => {
    const view = render(
      <ExpandableCardRegion expanded={false} className="panel">
        <button type="button">Action</button>
      </ExpandableCardRegion>,
    );

    expect(
      screen.getByRole("button", { name: "Action" }).parentElement
        .parentElement,
    ).toHaveAttribute("inert");

    view.rerender(
      <ExpandableCardRegion expanded className="panel">
        <button type="button">Action</button>
      </ExpandableCardRegion>,
    );
    expect(
      screen.getByRole("button", { name: "Action" }).parentElement
        .parentElement,
    ).not.toHaveAttribute("inert");
  });
});
