import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ActionStatus } from "../../components/ActionStatus";

describe("ActionStatus", () => {
  it("keeps the honest two-state result sealed until the user asks", async () => {
    const user = userEvent.setup();
    const reveal = vi.fn().mockResolvedValue(false);
    render(<ActionStatus action="WITHDRAW" reveal={reveal} />);

    expect(screen.queryByText(/clamped or made no change/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /reveal transaction status/i }));
    expect(await screen.findByText(/clamped or made no change/i)).toBeVisible();
    expect(reveal).toHaveBeenCalledOnce();
  });

  it("maps a decrypted successful deposit only after reveal", async () => {
    const user = userEvent.setup();
    render(<ActionStatus action="DEPOSIT" reveal={vi.fn().mockResolvedValue(true)} />);

    expect(screen.queryByText("Deposited.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /reveal transaction status/i }));
    expect(await screen.findByText("Deposited.")).toBeVisible();
  });
});
