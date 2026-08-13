import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DrawState } from "../../features/draw/model";
import type { LokPublicData } from "../../features/public-data/model";
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
        randomHandle: `0x${(state === "SETTLED" ? "11" : "00").repeat(32)}`,
        revealAccumulator: `0x${"00".repeat(32)}`,
      },
    },
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
    render(<DrawPage publicData={publicData("SETTLED")} />);

    expect(screen.getByText(/use the external verifier/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /verify this draw/i })).not.toBeInTheDocument();
  });
});
