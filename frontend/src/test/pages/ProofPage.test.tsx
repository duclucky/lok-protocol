import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProofPage } from "../../pages/ProofPage";

describe("ProofPage", () => {
  it.each([0n, 250_000n])("uses the same check action before a %s credit is known", (credit) => {
    render(<ProofPage revealCredit={vi.fn().mockResolvedValue(credit)} />);

    expect(screen.getByRole("button", { name: "Claim / check prize" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /publish proof/i })).not.toBeInTheDocument();
  });

  it.each([0n, 250_000n])("makes one outcome-independent decrypt request for a %s credit", async (credit) => {
    const user = userEvent.setup();
    const revealCredit = vi.fn().mockResolvedValue(credit);
    render(<ProofPage revealCredit={revealCredit} />);

    await user.click(screen.getByRole("button", { name: "Claim / check prize" }));

    expect(revealCredit).toHaveBeenCalledOnce();
  });

  it("does not simulate proof publication after a non-zero local reveal", async () => {
    const user = userEvent.setup();
    render(<ProofPage revealCredit={vi.fn().mockResolvedValue(250_000n)} />);

    await user.click(screen.getByRole("button", { name: "Claim / check prize" }));

    expect(await screen.findByText(/public proof publication is not available in this build/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /publish proof/i })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/must publish|proof published|root hash|verifier address/i);
  });

  it("formats a six-decimal cUSDC prize", async () => {
    const user = userEvent.setup();
    render(<ProofPage revealCredit={vi.fn().mockResolvedValue(1_250_000n)} />);

    await user.click(screen.getByRole("button", { name: "Claim / check prize" }));

    expect(await screen.findByText("1.25 cUSDC")).toBeVisible();
  });

  it("explains automatic encrypted credit and routes a winner to confidential withdrawal", async () => {
    const user = userEvent.setup();
    render(<ProofPage revealCredit={vi.fn().mockResolvedValue(1_250_000n)} />);

    expect(screen.getByText(/settlement credits encrypted winnings automatically/i)).toBeVisible();
    expect(screen.getByText(/checking decrypts only your connected wallet's credit/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Claim / check prize" }));

    expect(await screen.findByText("1.25 cUSDC")).toBeVisible();
    expect(screen.getByRole("link", { name: /withdraw winnings/i })).toHaveAttribute("href", "/?withdraw=1");
    expect(screen.queryByRole("button", { name: /claim prize|publish proof/i })).not.toBeInTheDocument();
  });

  it("keeps principal-safe guidance for a zero-credit participant", async () => {
    const user = userEvent.setup();
    render(<ProofPage revealCredit={vi.fn().mockResolvedValue(0n)} />);

    await user.click(screen.getByRole("button", { name: "Claim / check prize" }));

    expect(await screen.findByText(/your principal remains in the vault/i)).toBeVisible();
    expect(screen.getByRole("link", { name: /deposit for next draw/i })).toHaveAttribute("href", "/deposit");
  });

  it.each([
    ["wallet rejection", new Error("User rejected the request"), /private-read request was declined/i, /try again/i],
    ["SDK unavailable", new Error("Wallet decryption is not ready"), /private reads are unavailable/i, /reload/i],
    ["decryption timeout", new Error("Decryption request timed out"), /decryption request timed out/i, /retry/i],
  ])("gives a specific recovery for %s without implying a funds change", async (_name, error, message, action) => {
    const user = userEvent.setup();
    render(<ProofPage revealCredit={vi.fn().mockRejectedValue(error)} />);

    await user.click(screen.getByRole("button", { name: "Claim / check prize" }));

    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.getByText(/this read failure did not change your funds or credit/i)).toBeVisible();
    expect(screen.getByRole("button", { name: action })).toBeVisible();
  });
});
