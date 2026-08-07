import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsMenu, { SettingsMenuButton } from "./SettingsMenu.jsx";
import SettingsTray from "./SettingsTray.jsx";

describe("SettingsTray", () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
  });

  it("opens detail screens full-height and returns to the compact invoking option", async () => {
    render(
      <SettingsTray
        title="Profile settings"
        onClose={vi.fn()}
        screens={[{ id: "password", title: "Change password", content: <label>Password<input /></label> }]}
        renderMenu={(openScreen) => (
          <SettingsMenu label="Options">
            <SettingsMenuButton screenId="password" title="Change password" onClick={(event) => openScreen("password", event.currentTarget)} />
          </SettingsMenu>
        )}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Profile settings" });
    const option = screen.getByRole("button", { name: /Change password/ });
    expect(dialog).toHaveAttribute("data-expanded", "false");

    await userEvent.click(option);
    expect(dialog).toHaveAttribute("data-expanded", "true");
    expect(screen.getByLabelText("Password")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back to settings" }));
    expect(dialog).toHaveAttribute("data-expanded", "false");
    expect(screen.getByRole("button", { name: /Change password/ })).toHaveFocus();
  });
});
