import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPoll } from "../../api/polls.js";
import PollCreateForm from "./PollCreateForm.jsx";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ user: { id: "andre", name: "Andre" } }),
}));
vi.mock("../../api/polls.js", () => ({
  createPoll: vi.fn(),
}));

function renderForm() {
  const props = {
    onPollsChange: vi.fn(),
    onSuccess: vi.fn(),
    onCancel: vi.fn(),
  };
  render(<PollCreateForm {...props} />);
  return props;
}

describe("PollCreateForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPoll.mockResolvedValue([]);
  });
  afterEach(() => cleanup());

  it("uses accessible repeatable option controls and keeps one draft row", async () => {
    const { onCancel } = renderForm();
    const user = userEvent.setup();

    expect(screen.getByLabelText("Poll title")).toBeInTheDocument();
    const firstOption = screen.getByLabelText("Poll option 1");
    await user.type(firstOption, "Tacos");
    await user.click(screen.getByRole("button", { name: "Add option" }));
    expect(screen.getByLabelText("Poll option 2")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Remove poll option 1" }),
    );
    expect(screen.getByLabelText("Poll option 1")).toHaveValue("");
    expect(screen.queryByLabelText("Poll option 2")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("trims the title and options while omitting blank option rows", async () => {
    const { onPollsChange, onSuccess } = renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Poll title"), "  Dinner?  ");
    await user.type(screen.getByLabelText("Poll option 1"), "  Tacos  ");
    await user.click(screen.getByRole("button", { name: "Add option" }));
    await user.click(screen.getByRole("button", { name: "Post poll" }));

    await waitFor(() =>
      expect(createPoll).toHaveBeenCalledWith("Dinner?", "andre", ["Tacos"]),
    );
    expect(onPollsChange).toHaveBeenCalledWith([]);
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("keeps options optional and caps the draft at fifty rows", async () => {
    renderForm();
    const user = userEvent.setup();
    const addButton = screen.getByRole("button", { name: "Add option" });

    for (let index = 1; index < 50; index += 1) {
      await user.click(addButton);
    }
    expect(screen.getAllByLabelText(/^Poll option \d+$/)).toHaveLength(50);
    expect(addButton).toBeDisabled();

    await user.type(screen.getByLabelText("Poll title"), "No options needed");
    await user.click(screen.getByRole("button", { name: "Post poll" }));
    await waitFor(() =>
      expect(createPoll).toHaveBeenCalledWith(
        "No options needed",
        "andre",
        [],
      ),
    );
  });

  it("disables the form while posting and surfaces request failures", async () => {
    let rejectRequest;
    createPoll.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectRequest = reject;
      }),
    );
    renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Poll title"), "Dinner?");
    await user.click(screen.getByRole("button", { name: "Post poll" }));

    expect(screen.getByRole("button", { name: "Posting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByLabelText("Poll title")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add option" })).toBeDisabled();

    rejectRequest(new Error("Poll service unavailable"));
    expect(await screen.findByText("Poll service unavailable")).toBeVisible();
  });
});
