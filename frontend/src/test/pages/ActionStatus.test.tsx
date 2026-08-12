import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ActionStatus } from "../../components/ActionStatus";

describe("ActionStatus", () => {
  it("keeps the honest two-state result sealed until the user asks", async () => {
    const user = userEvent.setup();
    render(<ActionStatus action="WITHDRAW" succeeded={false} />);

    expect(screen.queryByText(/clamped or made no change/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /reveal transaction status/i }));
    expect(await screen.findByText(/clamped or made no change/i)).toBeVisible();
  });
});
