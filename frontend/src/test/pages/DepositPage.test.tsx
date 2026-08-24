import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { DepositPage } from "../../pages/DepositPage";

const mintHash = `0x${"11".repeat(32)}` as const;
const shieldHash = `0x${"22".repeat(32)}` as const;
const depositHash = `0x${"33".repeat(32)}` as const;

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
    expect(screen.getAllByRole("button", { name: /shield and continue/i })).toHaveLength(1);
  });

  it("shows an inline amount error without replacing the amount label", async () => {
    const user = userEvent.setup();
    render(<DepositPage />, { wrapper: MemoryRouter });

    await user.type(screen.getByLabelText("Amount"), "0");
    expect(screen.getByText(/amount must be greater than zero/i)).toBeVisible();
    expect(screen.getByLabelText("Amount")).toHaveAccessibleDescription(/amount must be greater than zero/i);
  });

  it("keeps test-token controls in a separately labelled demo region", () => {
    render(<DepositPage />, { wrapper: MemoryRouter });

    expect(screen.getByRole("region", { name: /demo control/i })).toContainElement(
      screen.getByRole("button", { name: /get test tokens/i }),
    );
  });

  it("shows only real wallet funding data and keeps cUSDC sealed", async () => {
    const user = userEvent.setup();
    const revealWalletCusdc = vi.fn().mockResolvedValue("7.50 cUSDC");
    render(
      <DepositPage walletData={{ status: "ready", publicUsdc: "12.34 USDC" }} revealWalletCusdc={revealWalletCusdc} />,
      { wrapper: MemoryRouter },
    );

    expect(screen.queryByText("7.50 cUSDC")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /reveal wallet cusdc balance/i }));
    expect(await screen.findByText("7.50 cUSDC")).toBeVisible();
    await user.click(screen.getByRole("radio", { name: /public usdc/i }));
    expect(screen.getByText("12.34 USDC")).toBeVisible();
  });

  it("does not introduce fabricated lending or insurance concepts", () => {
    const { container } = render(<DepositPage />, { wrapper: MemoryRouter });
    expect(container).not.toHaveTextContent(/LTV|liquidation|slashing|multiplier|insurance|fee/i);
  });

  it("keeps mint, shield and private deposit as explicit transactions", async () => {
    const user = userEvent.setup();
    const mintTestTokens = vi.fn().mockResolvedValue(mintHash);
    const shield = vi.fn().mockResolvedValue(shieldHash);
    const deposit = vi.fn().mockResolvedValue(depositHash);
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

    expect(screen.getByText("Step 2 of 2")).toBeVisible();
    expect(screen.getByText(/later Lok deposit uses encrypted cUSDC/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /deposit encrypted cusdc/i }));
    expect(deposit).toHaveBeenCalledWith("10");
    expect(await screen.findByText("Deposit confirmed.")).toBeVisible();
    expect(screen.queryByText("Deposited.")).not.toBeInTheDocument();
  });

  it.each([
    ["Switch the wallet to Ethereum Sepolia.", /switch.*sepolia/i],
    ["insufficient token balance", /not enough.*token/i],
    ["User rejected the request", /declined/i],
    ["The relayer returned no encrypted input.", /encryption did not complete/i],
  ])("shows a recoverable primary message for %s", async (failure, expected) => {
    const user = userEvent.setup();
    render(
      <DepositPage
        actions={{
          mintTestTokens: vi.fn(),
          shield: vi.fn(),
          deposit: vi.fn().mockRejectedValue(new Error(failure)),
          pending: false,
        }}
      />,
      { wrapper: MemoryRouter },
    );

    await user.type(screen.getByLabelText("Amount"), "1");
    await user.click(screen.getByRole("button", { name: /deposit privately/i }));

    const status = await screen.findByRole("status");
    expect(within(status).getByText(expected, { selector: "p" })).toBeVisible();
    expect(within(status).getByText(failure, { selector: "code" })).not.toBeVisible();
  });
});
