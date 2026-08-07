import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfileSettings from "./ProfileSettings.jsx";

const auth = vi.hoisted(() => ({
  user: { id: "andre", name: "Andre", username: "andre", hasGroup: true },
  updateProfile: vi.fn(),
  updatePassword: vi.fn(),
  logout: vi.fn(),
  deleteAccount: vi.fn(),
}));

vi.mock("../../context/AuthContext.jsx", () => ({ useAuth: () => auth }));
vi.mock("./EnableNotifications.jsx", () => ({
  default: () => <button type="button">Enable notifications</button>,
}));

describe("ProfileSettings", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("updates the display name after verifying the current password", async () => {
    auth.updateProfile.mockResolvedValue({ ...auth.user, name: "Andre T" });
    const onProfileChanged = vi.fn();
    render(<ProfileSettings onProfileChanged={onProfileChanged} />);

    await userEvent.clear(screen.getByLabelText("Display name"));
    await userEvent.type(screen.getByLabelText("Display name"), "  Andre T  ");
    await userEvent.type(screen.getAllByLabelText("Current password")[0], "roomie");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() =>
      expect(auth.updateProfile).toHaveBeenCalledWith("Andre T", "roomie"),
    );
    expect(onProfileChanged).toHaveBeenCalledWith({ ...auth.user, name: "Andre T" });
    expect(screen.getByText("Display name updated everywhere.")).toBeInTheDocument();
  });

  it("validates matching passwords before updating credentials", async () => {
    render(<ProfileSettings />);
    const passwordInputs = screen.getAllByLabelText("Current password");
    await userEvent.type(passwordInputs[1], "roomie");
    await userEvent.type(screen.getByLabelText("New password"), "new-roomie");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "different");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(screen.getByText("New passwords do not match.")).toBeInTheDocument();
    expect(auth.updatePassword).not.toHaveBeenCalled();
  });

  it("keeps notification and session controls at the profile level", async () => {
    render(<ProfileSettings />);

    expect(screen.getByRole("button", { name: "Enable notifications" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(auth.logout).toHaveBeenCalledOnce();
    expect(screen.queryByText("Enabled modules")).not.toBeInTheDocument();
  });
});
