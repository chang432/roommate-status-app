import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
    render(<ProfileSettings onClose={vi.fn()} onProfileChanged={onProfileChanged} />);

    await userEvent.click(screen.getByRole("button", { name: /Profile Update your display name/i }));

    await userEvent.clear(screen.getByLabelText("Display name"));
    await userEvent.type(screen.getByLabelText("Display name"), "  Andre T  ");
    await userEvent.type(screen.getByLabelText("Current password"), "roomie");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() =>
      expect(auth.updateProfile).toHaveBeenCalledWith("Andre T", "roomie"),
    );
    expect(onProfileChanged).toHaveBeenCalledWith({ ...auth.user, name: "Andre T" });
    expect(screen.getByText("Display name updated everywhere.")).toBeInTheDocument();
  });

  it("validates matching passwords before updating credentials", async () => {
    render(<ProfileSettings onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Change password Choose/i }));
    await userEvent.type(screen.getByLabelText("Current password"), "roomie");
    await userEvent.type(screen.getByLabelText("New password"), "new-roomie");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "different");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(screen.getByText("New passwords do not match.")).toBeInTheDocument();
    expect(auth.updatePassword).not.toHaveBeenCalled();
  });

  it("keeps workflows behind options while sign out remains direct", async () => {
    render(<ProfileSettings onClose={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Enable notifications" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Notifications Manage/i }));
    expect(screen.getByRole("button", { name: "Enable notifications" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back to settings" }));
    await userEvent.click(screen.getByRole("button", { name: /^Sign out/ }));
    expect(auth.logout).toHaveBeenCalledOnce();
    expect(screen.queryByText("Enabled modules")).not.toBeInTheDocument();
  });

  it("opens account deletion as a separate confirmed workflow", async () => {
    auth.deleteAccount.mockResolvedValue(undefined);
    render(<ProfileSettings onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Delete account Permanently/i }));
    await userEvent.type(screen.getByLabelText("Current password"), "roomie");
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    const confirmation = screen.getByRole("dialog", { name: "Delete your account?" });
    await userEvent.click(within(confirmation).getByRole("button", { name: "Delete account" }));

    await waitFor(() => expect(auth.deleteAccount).toHaveBeenCalledWith("roomie"));
  });
});
