import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BookClub from "./BookClub.jsx";

describe("BookClub", () => {
  it("renders its placeholder title", () => {
    render(<BookClub />);

    expect(screen.getByRole("region", { name: "Book Club" })).toHaveTextContent(
      "Book Club",
    );
  });
});
