import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RiskPage } from "../../pages/RiskPage";

describe("RiskPage", () => {
  it("defaults the private risk setting to 100 percent", () => {
    render(<RiskPage />);

    expect(screen.getByRole("radio", { name: /100%/i })).toBeChecked();
    expect(screen.getByText(/nobody can see this setting/i)).toBeVisible();
  });

  it("does not expose an estimated odds value", () => {
    render(<RiskPage />);

    expect(screen.queryByText(/estimated odds/i)).not.toBeInTheDocument();
  });

  it("submits the selected encrypted risk setting", async () => {
    const user = userEvent.setup();
    const setRisk = vi.fn().mockResolvedValue("0xrisk");
    render(<RiskPage action={{ setRisk, pending: false }} />);

    await user.click(screen.getByRole("radio", { name: /25%/i }));
    await user.click(screen.getByRole("button", { name: /save encrypted setting/i }));

    expect(setRisk).toHaveBeenCalledWith(25);
  });
});
