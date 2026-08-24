import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import type { DrawState } from "../../features/draw/model";
import type { LokPublicData } from "../../features/public-data/model";
import type { LokTransactionActions } from "../../features/transactions/model";
import { DRAW_STATES, DrawPage } from "../../pages/DrawPage";

function publicData(state: DrawState): LokPublicData {
  return {
    status: "ready",
    snapshot: {
      participantCount: 30n,
      riskEpoch: 1n,
      solvency: "verified",
      fundedYield: 5_000_000n,
      draw: {
        id: 1n,
        state,
        strict: false,
        settled: state === "SETTLED",
        aborted: false,
        noWinner: false,
        tStart: 1_786_475_424n,
        tEnd: 1_787_080_224n,
        revealDeadline: 0n,
        stateDeadline: 1_787_256_624n,
        cursor: state === "SWEEP_A" ? 12n : state === "SWEEP_B" ? 8n : 0n,
        preSyncCursor: 0n,
        participantSnapshot: 30n,
        realisedYield: 5_000_000n,
        prizeAmount: state === "SETTLED" ? 5_000_000n : 0n,
        totalTickets: state === "SETTLED" ? 48_291_774n : 0n,
        totalBaseRiskWeight: 0n,
        totalYieldWeight: 0n,
        cumRunning: `0x${"11".repeat(32)}`,
        cumBaseRiskRunning: `0x${"22".repeat(32)}`,
        cumYieldRunning: `0x${"33".repeat(32)}`,
        randomHandle: `0x${(state === "SETTLED" ? "11" : "00").repeat(32)}`,
        revealAccumulator: `0x${"00".repeat(32)}`,
      },
    },
  };
}

function keeperActions(): Pick<LokTransactionActions, "pending" | "advanceDraw"> {
  return {
    pending: false,
    advanceDraw: vi.fn().mockResolvedValue(`0x${"44".repeat(32)}`),
  };
}

describe("DrawPage", () => {
  it.each(DRAW_STATES)("renders the %s state with progress context", (state) => {
    render(<DrawPage publicData={publicData(state)} />);

    expect(screen.getByRole("heading", { name: state })).toBeVisible();
    expect(screen.getByLabelText(/draw progress/i)).toBeVisible();
  });

  it("labels the randomness commitment without implying it is readable", () => {
    render(<DrawPage publicData={publicData("REVEAL")} />);

    expect(screen.getByText(/random material remains unavailable until the reveal window closes/i)).toBeVisible();
  });

  it("shows the live non-strict mode and participant snapshot", () => {
    render(<DrawPage publicData={publicData("OPEN")} />);

    expect(screen.getByText("Non-strict demo mode")).toBeVisible();
    expect(screen.getByText(/30 participants/i)).toBeVisible();
    expect(screen.queryByRole("combobox", { name: /draw state/i })).not.toBeInTheDocument();
  });

  it("routes settled-draw verification to the external verifier without simulating success", () => {
    const { container } = render(<DrawPage publicData={publicData("SETTLED")} />);

    expect(screen.getByText(/use the external verifier/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /verify this draw/i })).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(
      /ZK|VRF|enclave|eligible volume|capacity utilization|root hash|verifier address|execution log/i,
    );
  });

  it("defaults to a user-focused draw view before exposing keeper controls", () => {
    render(
      <DrawPage publicData={publicData("AWAIT_TOTAL")} keeperAction={keeperActions()} nowMs={1_787_256_624_000} />,
    );

    expect(screen.getByRole("button", { name: /user view/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/draw automation is running/i)).toBeVisible();
    expect(screen.queryByRole("heading", { name: /keeper panel/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /execution log/i })).not.toBeInTheDocument();
  });

  it("shows keeper controls and confirmed transaction log in demo progress mode", async () => {
    const user = userEvent.setup();
    const actions = keeperActions();
    render(<DrawPage publicData={publicData("AWAIT_TOTAL")} keeperAction={actions} nowMs={1_787_256_624_000} />);

    await user.click(screen.getByRole("button", { name: /demo progress/i }));

    expect(screen.getByRole("button", { name: /demo progress/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: /keeper panel/i })).toBeVisible();
    expect(screen.getByRole("heading", { name: /execution log/i })).toBeVisible();
    expect(screen.getByText(/no keeper transactions recorded/i)).toBeVisible();

    await user.click(screen.getByRole("button", { name: /manual: decrypt totals and submit/i }));

    expect(await screen.findByRole("link", { name: /0x4444.*4444/i })).toHaveAttribute(
      "href",
      `https://sepolia.etherscan.io/tx/0x${"44".repeat(32)}`,
    );
    expect(screen.getAllByText(/Decrypt totals and submit/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders a keeper panel without replacing public state checks", async () => {
    const user = userEvent.setup();
    render(
      <DrawPage publicData={publicData("AWAIT_TOTAL")} keeperAction={keeperActions()} nowMs={1_787_256_624_000} />,
    );

    await user.click(screen.getByRole("button", { name: /demo progress/i }));

    expect(screen.getByRole("heading", { name: /keeper panel/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /manual: decrypt totals and submit/i })).toBeVisible();
    expect(screen.getByText(/keeper automation handles this for the demo/i)).toBeVisible();
    expect(screen.getByText(/public decryption for aggregate draw totals/i)).toBeVisible();
  });

  it("calls the next keeper action derived from state", async () => {
    const user = userEvent.setup();
    const actions = keeperActions();
    render(<DrawPage publicData={publicData("AWAIT_TOTAL")} keeperAction={actions} nowMs={1_787_256_624_000} />);

    await user.click(screen.getByRole("button", { name: /demo progress/i }));
    await user.click(screen.getByRole("button", { name: /manual: decrypt totals and submit/i }));

    expect(actions.advanceDraw).toHaveBeenCalledWith({
      kind: "submitTotals",
      handles: [`0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`, `0x${"33".repeat(32)}`],
    });
  });
});
