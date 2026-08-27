import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { SolvencyStatus } from "../../components/SolvencyStatus";
import type { LokPublicData } from "../../features/public-data/model";
import { VaultPage } from "../../pages/VaultPage";

const publicData: LokPublicData = {
  status: "ready",
  snapshot: {
    participantCount: 30n,
    riskEpoch: 1n,
    solvency: "verified",
    fundedYield: 5_000_000n,
    draw: {
      id: 1n,
      state: "OPEN",
      strict: false,
      settled: false,
      aborted: false,
      noWinner: false,
      tStart: 1_786_475_424n,
      tEnd: 1_787_080_224n,
      revealDeadline: 0n,
      stateDeadline: 1_787_256_624n,
      cursor: 0n,
      preSyncCursor: 0n,
      participantSnapshot: 30n,
      realisedYield: 0n,
      prizeAmount: 0n,
      totalTickets: 0n,
      totalBaseRiskWeight: 0n,
      totalYieldWeight: 0n,
      cumRunning: `0x${"11".repeat(32)}`,
      cumBaseRiskRunning: `0x${"22".repeat(32)}`,
      cumYieldRunning: `0x${"33".repeat(32)}`,
      randomHandle: `0x${"00".repeat(32)}`,
      revealAccumulator: `0x${"00".repeat(32)}`,
    },
  },
};

const transactionHash = `0x${"34".repeat(32)}` as const;

describe("VaultPage", () => {
  it("presents the vault as a savings app with obvious primary actions", () => {
    render(<VaultPage publicData={publicData} nowMs={1_786_500_000_000} />, {
      wrapper: MemoryRouter,
    });

    expect(screen.getByRole("heading", { name: /private prize savings on sepolia/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /deposit privately/i })).toHaveAttribute("href", "/deposit");
    expect(screen.getByRole("button", { name: /reveal your balance/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Withdraw$/i })).toBeVisible();
    expect(screen.getByText(/withdraw anytime/i)).toBeVisible();
    expect(screen.getByText(/automation/i)).toBeVisible();
  });

  it("keeps the savings dashboard labels stable while Sepolia data loads", () => {
    render(<VaultPage publicData={{ status: "loading" }} />, { wrapper: MemoryRouter });

    const dashboard = screen.getByLabelText("Savings dashboard");
    expect(within(dashboard).getByText("Private balance")).toBeVisible();
    expect(within(dashboard).getByText("Current prize")).toBeVisible();
    expect(within(dashboard).getByText("Draw automation")).toBeVisible();
    expect(within(dashboard).getByText("Principal recovery")).toBeVisible();
  });

  it("renders public pool data immediately while the private balance stays sealed", () => {
    const { container } = render(<VaultPage publicData={publicData} nowMs={1_786_500_000_000} />, {
      wrapper: MemoryRouter,
    });

    const publicMetrics = screen.getByLabelText("Public pool data");
    expect(within(publicMetrics).getByText(/current prize/i)).toBeVisible();
    expect(screen.getAllByText("5.00 cUSDC funded")).toHaveLength(3);
    expect(screen.getByText("30")).toBeVisible();
    expect(screen.getAllByText("Draw 1")).toHaveLength(2);
    expect(screen.queryByText("38")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reveal your balance/i })).toBeVisible();
    expect(screen.queryByText("12,480.00 cUSDC")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/LTV|liquidation|slashing|multiplier|insurance/i);
  });

  it("opens an actionable withdrawal form from the primary vault command", async () => {
    const user = userEvent.setup();
    render(<VaultPage publicData={publicData} />, { wrapper: MemoryRouter });

    await user.click(screen.getByRole("button", { name: "Withdraw" }));

    expect(screen.getByRole("spinbutton", { name: "Withdrawal amount" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Submit withdrawal" })).toBeDisabled();
    expect(screen.getByText("Recovery options")).toBeVisible();
    expect(screen.getByRole("button", { name: "Withdraw all" })).not.toBeVisible();
  });

  it("opens the withdrawal flow when routed from a private prize result", () => {
    render(<VaultPage publicData={publicData} />, {
      wrapper: ({ children }) => <MemoryRouter initialEntries={["/?withdraw=1"]}>{children}</MemoryRouter>,
    });

    expect(screen.getByRole("spinbutton", { name: "Withdrawal amount" })).toBeVisible();
  });

  it("submits a confidential withdrawal through the wallet action", async () => {
    const user = userEvent.setup();
    const withdraw = vi.fn().mockResolvedValue(transactionHash);
    render(
      <VaultPage
        publicData={publicData}
        withdrawAction={{
          withdraw,
          withdrawAll: vi.fn().mockResolvedValue(transactionHash),
          emergencyWithdraw: vi.fn().mockResolvedValue(transactionHash),
          pending: false,
        }}
        revealActionStatus={vi.fn().mockResolvedValue(true)}
      />,
      {
        wrapper: MemoryRouter,
      },
    );

    await user.click(screen.getByRole("button", { name: "Withdraw" }));
    await user.type(screen.getByRole("spinbutton", { name: "Withdrawal amount" }), "1.25");
    await user.click(screen.getByRole("button", { name: "Submit withdrawal" }));

    expect(withdraw).toHaveBeenCalledWith("1.25");
    expect(await screen.findByText("Withdrawal confirmed.")).toBeVisible();
    expect(screen.getByRole("link", { name: /view transaction/i })).toHaveAttribute(
      "href",
      `https://sepolia.etherscan.io/tx/${transactionHash}`,
    );
    expect(screen.queryByText("Withdrew.")).not.toBeInTheDocument();
  });

  it("progressively discloses full withdrawal and emergency recovery", async () => {
    const user = userEvent.setup();
    const withdrawAll = vi.fn().mockResolvedValue(transactionHash);
    const emergencyWithdraw = vi.fn().mockResolvedValue(transactionHash);
    render(
      <VaultPage
        publicData={publicData}
        withdrawAction={{ withdraw: vi.fn(), withdrawAll, emergencyWithdraw, pending: false }}
      />,
      { wrapper: MemoryRouter },
    );

    await user.click(screen.getByRole("button", { name: "Withdraw" }));
    await user.click(screen.getByText("Recovery options"));
    expect(screen.getByText(/exceptional recovery remains available regardless of draw state/i)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Withdraw all" }));
    expect(withdrawAll).toHaveBeenCalledOnce();
    expect(emergencyWithdraw).not.toHaveBeenCalled();
  });

  it("keeps public metric labels stable while Sepolia data loads", () => {
    render(<VaultPage publicData={{ status: "loading" }} />, { wrapper: MemoryRouter });

    const publicMetrics = screen.getByLabelText("Public pool data");
    expect(within(publicMetrics).getByText("Current prize")).toBeVisible();
    expect(within(publicMetrics).getByText("Next draw")).toBeVisible();
    expect(within(publicMetrics).getByText("Participants")).toBeVisible();
  });
});

describe("SolvencyStatus", () => {
  it.each([
    ["verified", "Verified for risk epoch 7"],
    ["pending", "Verification pending"],
    ["restricted", "Restricted"],
  ] as const)("renders the %s checkpoint state truthfully", (status, label) => {
    render(<SolvencyStatus status={status} epoch={7} />);
    expect(screen.getByText(label)).toBeVisible();
  });
});
