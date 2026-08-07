import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import BottomTray from "./BottomTray.jsx";

describe("BottomTray", () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
  });

  it("behaves like a modal dialog and closes from the X or Escape", async () => {
    const onClose = vi.fn();
    render(<BottomTray title="Profile settings" onClose={onClose}><button>First control</button></BottomTray>);

    expect(screen.getByRole("dialog", { name: "Profile settings" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("dismisses after a deliberate downward swipe", () => {
    const onClose = vi.fn();
    render(<BottomTray title="Group settings" onClose={onClose}><p>Settings</p></BottomTray>);
    const header = screen.getByRole("heading", { name: "Group settings" }).closest("header");

    fireEvent.pointerDown(header, {
      pointerId: 1,
      pointerType: "touch",
      clientY: 20,
    });
    fireEvent.pointerMove(header, {
      pointerId: 1,
      pointerType: "touch",
      clientY: 130,
    });
    fireEvent.pointerUp(header, {
      pointerId: 1,
      pointerType: "touch",
      clientY: 130,
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("expands a compact tray after a deliberate upward swipe", () => {
    const onExpand = vi.fn();
    render(<BottomTray title="Profile settings" onClose={vi.fn()} onExpand={onExpand}><p>Settings</p></BottomTray>);
    const header = screen.getByRole("heading", { name: "Profile settings" }).closest("header");

    fireEvent.pointerDown(header, {
      pointerId: 2,
      pointerType: "touch",
      clientY: 140,
    });
    fireEvent.pointerMove(header, {
      pointerId: 2,
      pointerType: "touch",
      clientY: 50,
    });
    fireEvent.pointerUp(header, {
      pointerId: 2,
      pointerType: "touch",
      clientY: 50,
    });

    expect(onExpand).toHaveBeenCalledOnce();
  });

  it("shows an accessible Back action for detail screens", async () => {
    const onBack = vi.fn();
    render(<BottomTray title="Change password" ariaLabel="Profile settings" onClose={vi.fn()} expanded onBack={onBack}><p>Workflow</p></BottomTray>);

    const dialog = screen.getByRole("dialog", { name: "Profile settings" });
    expect(dialog).toHaveAttribute("data-expanded", "true");
    await userEvent.click(screen.getByRole("button", { name: "Back to settings" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
