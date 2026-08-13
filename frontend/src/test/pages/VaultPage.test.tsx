import { render, screen } from "@testing-library/react";
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
      randomHandle: `0x${"00".repeat(32)}`,
      revealAccumulator: `0x${"00".repeat(32)}`,
    },
  },
};

describe("VaultPage", () => {
  it("renders public pool data immediately while the private balance stays sealed", () => {
    const { container } = render(<VaultPage publicData={publicData} nowMs={1_786_500_000_000} />, {
      wrapper: MemoryRouter,
    });

    expect(screen.getByText(/current prize/i)).toBeVisible();
    expect(screen.getAllByText("5.00 cUSDC funded")).toHaveLength(2);
    expect(screen.getByText("30")).toBeVisible();
    expect(screen.getByText("Draw 1")).toBeVisible();
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
  });

  it("submits a confidential withdrawal through the wallet action", async () => {
    const user = userEvent.setup();
    const withdraw = vi.fn().mockResolvedValue("0xwithdraw");
    render(
      <VaultPage
        publicData={publicData}
        withdrawAction={{ withdraw, pending: false }}
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
    expect(await screen.findByText(/transaction confirmed\. reveal the encrypted result/i)).toBeVisible();
    expect(screen.queryByText("Withdrew.")).not.toBeInTheDocument();
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
