import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import PeoplePopover from "./PeoplePopover.jsx";

const PEOPLE = [
  { id: "andre", name: "Andre" },
  { id: "kayla", name: "Kayla" },
];

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PeoplePopover
        people={PEOPLE}
        open={open}
        onOpenChange={setOpen}
        heading="Voted by"
        dialogLabel="People who voted"
        buttonLabel="View voters"
        triggerClassName="trigger"
      >
        2
      </PeoplePopover>
      <button type="button">Outside</button>
    </div>
  );
}

function EmptyHarness() {
  const [open, setOpen] = useState(false);
  return (
    <PeoplePopover
      people={[]}
      open={open}
      onOpenChange={setOpen}
      heading="Liked by"
      dialogLabel="People who liked"
      buttonLabel="View one unavailable liker"
      triggerClassName="trigger"
    >
      1
    </PeoplePopover>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PeoplePopover", () => {
  it("exposes an accessible portal and dismisses it with Escape", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "View voters" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "People who voted" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", dialog.id);
    expect(dialog).toHaveFocus();
    expect(dialog).toHaveTextContent("Voted by");
    expect(dialog).toHaveTextContent("Andre");
    expect(dialog).toHaveTextContent("Kayla");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it("dismisses on an outside pointer without treating portal clicks as outside", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "View voters" }));
    const dialog = screen.getByRole("dialog", { name: "People who voted" });

    fireEvent.pointerDown(screen.getByText("Andre"));
    expect(dialog).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it("positions beside the trigger and recomputes after scrolling", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 40,
      right: 120,
      top: 20,
      bottom: 40,
      width: 80,
      height: 20,
      x: 40,
      y: 20,
      toJSON: () => {},
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(180);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);
    render(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: "View voters" }));
    const dialog = screen.getByRole("dialog", { name: "People who voted" });
    await waitFor(() => {
      expect(dialog).toHaveStyle({ left: "128px", top: "48px" });
      expect(dialog).toHaveStyle({ visibility: "visible" });
    });

    fireEvent.scroll(window);
    expect(HTMLElement.prototype.getBoundingClientRect).toHaveBeenCalled();
  });

  it("keeps a nonzero count inspectable when current names are unavailable", async () => {
    render(<EmptyHarness />);
    await userEvent.click(
      screen.getByRole("button", { name: "View one unavailable liker" }),
    );

    expect(screen.getByRole("dialog", {
      name: "People who liked",
    })).toHaveTextContent("Names unavailable");
  });
});
