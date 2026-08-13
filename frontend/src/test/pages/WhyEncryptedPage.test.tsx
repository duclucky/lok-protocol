import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WhyEncryptedPage } from "../../pages/WhyEncryptedPage";

describe("WhyEncryptedPage", () => {
  it("states the real public and encrypted FHEVM boundary", () => {
    const { container } = render(<WhyEncryptedPage />);

    expect(screen.getByText(/participant addresses and membership are public/i)).toBeVisible();
    expect(screen.getByText(/shield transaction amount is public/i)).toBeVisible();
    expect(screen.getByText(/encrypted values are computed on without revealing their clear values/i)).toBeVisible();
    expect(screen.getByText(/external verifier is separate from this interface/i)).toBeVisible();
    expect(container).not.toHaveTextContent(/ZK|VRF|trusted enclave|zero-knowledge/i);
  });

  it("does not claim that every pool fact or user identity is confidential", () => {
    render(<WhyEncryptedPage />);

    const table = screen.getByRole("table", { name: /data disclosure boundary/i });
    expect(table).toHaveTextContent("Participant membership and addresses");
    expect(table).toHaveTextContent("Your balance");
    expect(table).toHaveTextContent("Your risk setting");
  });
});
