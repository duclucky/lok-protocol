import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProofPage } from "../../pages/ProofPage";

describe("ProofPage", () => {
  it.each([0n, 250_000n])("uses the same check action before a %s credit is known", (credit) => {
    render(<ProofPage revealCredit={vi.fn().mockResolvedValue(credit)} />);

    expect(screen.getByRole("button", { name: "Check my result" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /publish proof/i })).not.toBeInTheDocument();
  });

  it.each([0n, 250_000n])("makes one outcome-independent decrypt request for a %s credit", async (credit) => {
    const user = userEvent.setup();
    const revealCredit = vi.fn().mockResolvedValue(credit);
    render(<ProofPage revealCredit={revealCredit} />);

    await user.click(screen.getByRole("button", { name: "Check my result" }));

    expect(revealCredit).toHaveBeenCalledOnce();
  });

  it("does not simulate proof publication after a non-zero local reveal", async () => {
    const user = userEvent.setup();
    render(<ProofPage revealCredit={vi.fn().mockResolvedValue(250_000n)} />);

    await user.click(screen.getByRole("button", { name: "Check my result" }));

    expect(await screen.findByText(/public proof publication is not available in this build/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /publish proof/i })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/must publish|proof published|root hash|verifier address/i);
  });

  it("formats a six-decimal cUSDC prize", async () => {
    const user = userEvent.setup();
    render(<ProofPage revealCredit={vi.fn().mockResolvedValue(1_250_000n)} />);

    await user.click(screen.getByRole("button", { name: "Check my result" }));

    expect(await screen.findByText("1.25 cUSDC")).toBeVisible();
  });
});
