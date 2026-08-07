import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import GroupSwitcherDrawer from "./GroupSwitcherDrawer.jsx";

describe("GroupSwitcherDrawer", () => {
  afterEach(cleanup);

  it("opens settings for the active group from the drawer Edit action", async () => {
    const onEdit = vi.fn();
    render(
      <GroupSwitcherDrawer
        groups={[{ groupId: "shire", name: "The Shire" }]}
        activeGroupId="shire"
        open
        loading={false}
        error=""
        onClose={vi.fn()}
        onSelect={vi.fn()}
        onJoin={vi.fn()}
        onCreate={vi.fn()}
        onEdit={onEdit}
      />,
    );

    expect(screen.getByRole("button", { name: "The Shire" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledOnce();
  });
});
