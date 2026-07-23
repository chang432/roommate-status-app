import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoopingOwnerPicker from "./LoopingOwnerPicker.jsx";

const ROOMMATES = [
  { id: "andre", name: "Andre" },
  { id: "kayla", name: "Kayla" },
  { id: "sheryl", name: "Sheryl" },
];

function PickerHarness({ members = ROOMMATES }) {
  const [value, setValue] = useState(members[0]?.id || "");
  const [expanded, setExpanded] = useState(false);
  return (
    <LoopingOwnerPicker
      label="Book owner"
      order={members.map((member) => member.id)}
      roommates={members}
      value={value}
      onChange={setValue}
      expanded={expanded}
      onExpandedChange={setExpanded}
    />
  );
}

describe("LoopingOwnerPicker", () => {
  afterEach(() => cleanup());

  it("expands inline, exposes nearby members, and wraps with wheel or keyboard input", async () => {
    render(<PickerHarness />);
    await userEvent.click(screen.getByRole("button", { name: /Book owner Andre/ }));
    const wheel = screen.getByRole("listbox", { name: "Book owner" });

    expect(screen.getAllByRole("option", { name: "Andre" }).length).toBeGreaterThan(1);
    expect(screen.getAllByRole("option", { name: "Kayla" }).length).toBeGreaterThan(1);
    expect(screen.getAllByRole("option", { name: "Sheryl" }).length).toBeGreaterThan(1);

    fireEvent.wheel(wheel, { deltaY: -30 });
    expect(screen.getByRole("button", { name: /Book owner Sheryl/ })).toBeInTheDocument();
    fireEvent.keyDown(wheel, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /Book owner Andre/ })).toBeInTheDocument();
  });

  it("keeps a one-member wheel stable", async () => {
    const onChange = vi.fn();
    render(
      <LoopingOwnerPicker
        label="Snack owner"
        order={["andre"]}
        roommates={[ROOMMATES[0]]}
        value="andre"
        onChange={onChange}
        expanded
        onExpandedChange={vi.fn()}
      />,
    );

    const wheel = screen.getByRole("listbox", { name: "Snack owner" });
    fireEvent.wheel(wheel, {
      deltaY: 40,
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(within(wheel).getByRole("option", { name: "Andre" })).toBeInTheDocument();
  });
});
