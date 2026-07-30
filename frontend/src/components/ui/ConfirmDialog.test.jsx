import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useConfirmDialog } from "./useConfirmDialog.jsx";

function Harness({ onResult }) {
  const [status, setStatus] = useState("idle");
  const { confirm, confirmationDialog } = useConfirmDialog();

  async function requestConfirmation() {
    const result = await confirm({
      title: "Delete item?",
      message: "This cannot be undone.",
      confirmLabel: "Delete",
    });
    setStatus(result ? "confirmed" : "cancelled");
    onResult(result);
  }

  return (
    <>
      <button type="button" onClick={requestConfirmation}>Open</button>
      <output>{status}</output>
      {confirmationDialog}
    </>
  );
}

describe("useConfirmDialog", () => {
  afterEach(cleanup);

  it("defaults focus to Cancel and resolves false when cancelled", async () => {
    const onResult = vi.fn();
    const user = userEvent.setup();
    render(<Harness onResult={onResult} />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onResult).toHaveBeenCalledWith(false);
    expect(screen.getByText("cancelled")).toBeInTheDocument();
  });

  it("resolves true only from the explicit danger action", async () => {
    const onResult = vi.fn();
    const user = userEvent.setup();
    render(<Harness onResult={onResult} />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.getByText("confirmed")).toBeInTheDocument();
  });
});
