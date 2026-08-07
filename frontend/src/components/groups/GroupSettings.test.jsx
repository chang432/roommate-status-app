import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GroupSettings from "./GroupSettings.jsx";
import {
  getCurrentGroup,
  renameGroup,
  updateGroupModules,
  updateGroupTheme,
} from "../../api/groups.js";

const setTheme = vi.hoisted(() => vi.fn());

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));
vi.mock("../../context/ThemeContext.jsx", () => ({
  useTheme: () => ({ theme: "system", resolvedTheme: "light", setTheme }),
}));
vi.mock("../../api/groups.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentGroup: vi.fn(),
  renameGroup: vi.fn(),
  updateGroupModules: vi.fn(),
  updateGroupTheme: vi.fn(),
  removeGroupMember: vi.fn(),
  setGroupMemberRole: vi.fn(),
}));

const ROOMMATES = [
  { id: "andre", name: "Andre", role: "member" },
  { id: "kayla", name: "Kayla", role: "admin" },
];

function group(overrides = {}) {
  return {
    groupId: "shire",
    name: "Shire",
    joinCode: "SHIRE12",
    viewerIsAdmin: false,
    enabledModules: ["roster", "events"],
    theme: "system",
    ...overrides,
  };
}

function renderSettings(initialGroup = group(), props = {}, refreshedGroup = initialGroup) {
  getCurrentGroup.mockResolvedValue({ group: refreshedGroup });
  return render(
    <GroupSettings group={initialGroup} roommates={ROOMMATES} {...props} />,
  );
}

describe("GroupSettings", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("lets every member save a personal theme while shared controls stay read-only", async () => {
    updateGroupTheme.mockResolvedValue({ group: group({ theme: "forest" }) });
    renderSettings(group(), { onClose: vi.fn() });

    await userEvent.click(screen.getByRole("button", { name: /Enabled modules/i }));
    expect(screen.getByRole("checkbox", { name: /Household roster/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back to settings" }));
    await userEvent.click(screen.getByRole("button", { name: /Appearance Current theme/i }));
    await userEvent.click(screen.getByRole("radio", { name: /Forest/i }));

    await waitFor(() => expect(updateGroupTheme).toHaveBeenCalledWith("andre", "forest"));
    expect(setTheme).toHaveBeenCalledWith("forest");
  });

  it("lets an admin rename the group and toggle individual modules", async () => {
    const initial = group({ viewerIsAdmin: true, name: "Old Shire" });
    const refreshed = { ...initial, name: "Shire" };
    const renamed = { ...refreshed, name: "Bag End" };
    const modulesUpdated = { ...renamed, enabledModules: ["roster"] };
    renameGroup.mockResolvedValue({ group: renamed });
    updateGroupModules.mockResolvedValue({ group: modulesUpdated });
    const onGroupChange = vi.fn();
    renderSettings(initial, { onGroupChange, onClose: vi.fn() }, refreshed);

    await userEvent.click(screen.getByRole("button", { name: /Group details/i }));
    await waitFor(() => expect(screen.getByLabelText("Group name")).toHaveValue("Shire"));
    await userEvent.clear(screen.getByLabelText("Group name"));
    await userEvent.type(screen.getByLabelText("Group name"), "Bag End");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(renameGroup).toHaveBeenCalledWith("andre", "Bag End"));

    await userEvent.click(screen.getByRole("button", { name: "Back to settings" }));
    await userEvent.click(screen.getByRole("button", { name: /Enabled modules/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Events/i }));
    await waitFor(() =>
      expect(updateGroupModules).toHaveBeenCalledWith("andre", ["roster"]),
    );
    expect(onGroupChange).toHaveBeenLastCalledWith(modulesUpdated);
  });
});
