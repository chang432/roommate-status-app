import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfileSettings from "./ProfileSettings.jsx";
import { ThemeProvider } from "../context/ThemeContext.jsx";
import {
  getCurrentGroup,
  removeGroupMember,
  setGroupMemberRole,
} from "../api/client.js";

vi.mock("../api/client.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getCurrentGroup: vi.fn(),
    removeGroupMember: vi.fn(),
    setGroupMemberRole: vi.fn(),
  };
});

const USER = { id: "andre", name: "Andre", username: "andre", hasGroup: true };

function roster(andreRole) {
  return [
    { id: "andre", name: "Andre", role: andreRole },
    { id: "kayla", name: "Kayla", role: "member" },
    { id: "sheryl", name: "Sheryl", role: "admin" },
  ];
}

function renderPanel(roommates, onRoommatesChange = vi.fn()) {
  render(
    <ThemeProvider>
      <ProfileSettings
        user={USER}
        roommates={roommates}
        onRoommatesChange={onRoommatesChange}
        onSignOut={vi.fn()}
        onDeleteAccount={vi.fn()}
      />
    </ThemeProvider>,
  );
  return onRoommatesChange;
}

describe("ProfileSettings member administration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentGroup.mockResolvedValue({
      group: { groupId: "shire", name: "Shire", joinCode: "SHIRE12" },
    });
  });

  afterEach(cleanup);

  it("badges the identity card only when you administer this group", () => {
    renderPanel(roster("admin"));
    expect(screen.getByText("Group admin")).toBeInTheDocument();

    cleanup();
    renderPanel(roster("member"));
    expect(screen.queryByText("Group admin")).toBeNull();
  });

  it("hides every member action from a plain member", () => {
    renderPanel(roster("member"));

    expect(screen.getByText("Kayla")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Make admin" })).toBeNull();
  });

  it("lets an admin remove a plain member and re-renders the returned roster", async () => {
    const next = [{ id: "andre", name: "Andre", role: "admin" }];
    removeGroupMember.mockResolvedValue(next);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onRoommatesChange = renderPanel(roster("admin"));

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(onRoommatesChange).toHaveBeenCalledWith(next));
    expect(removeGroupMember).toHaveBeenCalledWith("andre", "kayla");
  });

  it("offers no remove button for a fellow admin or for yourself", () => {
    renderPanel(roster("admin"));

    // Kayla is the only plain member, so hers is the only Remove button:
    // admins are peers and must be demoted first.
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Revoke admin" })).toHaveLength(2);
  });

  it("promotes a member through the role endpoint", async () => {
    setGroupMemberRole.mockResolvedValue(roster("admin"));
    renderPanel(roster("admin"));

    await userEvent.click(screen.getByRole("button", { name: "Make admin" }));

    await waitFor(() =>
      expect(setGroupMemberRole).toHaveBeenCalledWith("andre", "kayla", "admin"),
    );
  });

  it("surfaces a rejected admin action instead of changing the roster", async () => {
    setGroupMemberRole.mockRejectedValue(
      new Error("Promote another admin before stepping down."),
    );
    const onRoommatesChange = renderPanel(roster("admin"));

    await userEvent.click(screen.getAllByRole("button", { name: "Revoke admin" })[0]);

    expect(
      await screen.findByText("Promote another admin before stepping down."),
    ).toBeInTheDocument();
    expect(onRoommatesChange).not.toHaveBeenCalled();
  });
});
