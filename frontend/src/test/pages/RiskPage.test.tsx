import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RiskPage } from "../../pages/RiskPage";

const transactionHash = `0x${"45".repeat(32)}` as const;

describe("RiskPage", () => {
  it("defaults the private risk setting to 100 percent", () => {
    render(<RiskPage />);

    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByRole("radio", { name: /100%/i })).toBeChecked();
    expect(screen.getByText(/selection is encrypted before it is submitted/i)).toBeVisible();
  });

  it("does not expose an estimated odds value", () => {
    const { container } = render(<RiskPage />);

    expect(screen.queryByText(/estimated odds/i)).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/LTV|liquidation|slashing|multiplier|insurance/i);
  });

  it("keeps the saved setting sealed separately from the editable target", async () => {
    const user = userEvent.setup();
    const revealTheta = vi.fn().mockResolvedValue(50);
    render(<RiskPage revealTheta={revealTheta} />);

    expect(screen.getByRole("radio", { name: /100%/i })).toBeChecked();
    const savedSetting = screen.getByRole("region", { name: /saved risk setting/i });
    expect(within(savedSetting).queryByText("50%")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /reveal saved risk setting/i }));
    expect(await within(savedSetting).findByText("50%")).toBeVisible();
    expect(revealTheta).toHaveBeenCalledOnce();
    expect(screen.getByRole("radio", { name: /100%/i })).toBeChecked();
  });

  it("submits the selected encrypted risk setting", async () => {
    const user = userEvent.setup();
    const setRisk = vi.fn().mockResolvedValue(transactionHash);
    render(<RiskPage action={{ setRisk, pending: false }} />);

    await user.click(screen.getByRole("radio", { name: /25%/i }));
    await user.click(screen.getByRole("button", { name: /save encrypted setting/i }));

    expect(setRisk).toHaveBeenCalledWith(25);
    expect(screen.getByRole("button", { name: /save encrypted setting/i })).toBeDisabled();
    expect(await screen.findByText("Risk setting confirmed.")).toBeVisible();
  });
});
