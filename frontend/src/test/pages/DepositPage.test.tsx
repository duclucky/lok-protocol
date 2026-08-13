import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { DepositPage } from "../../pages/DepositPage";

describe("DepositPage", () => {
  it("defaults to the private cUSDC path", () => {
    render(<DepositPage />, { wrapper: MemoryRouter });

    expect(screen.getByRole("radio", { name: /private cusdc/i })).toBeChecked();
    expect(screen.getByText("Fully private")).toBeVisible();
    expect(screen.queryByText(/shielding publishes this amount/i)).not.toBeInTheDocument();
  });

  it("shows the public entry warning before the shield path can be submitted", async () => {
    const user = userEvent.setup();
    render(<DepositPage />, { wrapper: MemoryRouter });

    await user.click(screen.getByRole("radio", { name: /public usdc/i }));
    await user.type(screen.getByLabelText("Amount"), "100");

    expect(screen.getByText("Entry amount visible")).toBeVisible();
    expect(screen.getByText(/shielding publishes this amount on-chain/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /shield and continue/i })).toBeEnabled();
  });

  it("keeps test-token controls in a separately labelled demo region", () => {
    render(<DepositPage />, { wrapper: MemoryRouter });

    expect(screen.getByRole("region", { name: /demo control/i })).toContainElement(
      screen.getByRole("button", { name: /get test tokens/i }),
    );
  });

  it("keeps mint, shield and private deposit as explicit transactions", async () => {
    const user = userEvent.setup();
    const mintTestTokens = vi.fn().mockResolvedValue("0xmint");
    const shield = vi.fn().mockResolvedValue("0xshield");
    const deposit = vi.fn().mockResolvedValue("0xdeposit");
    render(
      <DepositPage
        actions={{ mintTestTokens, shield, deposit, pending: false }}
        revealActionStatus={vi.fn().mockResolvedValue(true)}
      />,
      { wrapper: MemoryRouter },
    );

    await user.click(screen.getByRole("button", { name: /get test tokens/i }));
    expect(mintTestTokens).toHaveBeenCalledOnce();
    expect(screen.getByRole("radio", { name: /public usdc/i })).toBeChecked();

    await user.click(screen.getByRole("button", { name: /shield and continue/i }));
    expect(shield).toHaveBeenCalledWith("10");
    expect(deposit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: /private cusdc/i }));
    await user.click(screen.getByRole("button", { name: /deposit privately/i }));
    expect(deposit).toHaveBeenCalledWith("10");
    expect(await screen.findByText(/transaction confirmed\. reveal the encrypted result/i)).toBeVisible();
    expect(screen.queryByText("Deposited.")).not.toBeInTheDocument();
  });
});
