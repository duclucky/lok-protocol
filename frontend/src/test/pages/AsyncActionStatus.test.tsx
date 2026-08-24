import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AsyncActionStatus } from "../../components/AsyncActionStatus";
import { confirmed, failedAction } from "../../features/transactions/model";

const transactionHash = `0x${"ab".repeat(32)}` as const;

describe("AsyncActionStatus", () => {
  it("announces a confirmed transaction and retains its Etherscan link", () => {
    render(<AsyncActionStatus state={confirmed(transactionHash, "Deposit confirmed.")} />);

    const status = screen.getByRole("status");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    expect(within(status).getByText("Deposit confirmed.")).toBeVisible();
    expect(within(status).getByRole("link", { name: /view transaction/i })).toHaveAttribute(
      "href",
      `https://sepolia.etherscan.io/tx/${transactionHash}`,
    );
  });

  it("puts technical failure detail behind disclosure and offers a valid retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <AsyncActionStatus state={failedAction(new Error("execution reverted: provider payload"))} onRetry={onRetry} />,
    );

    expect(screen.getByText(/action did not complete/i)).toBeVisible();
    expect(screen.queryByText(/provider payload/i)).not.toBeVisible();
    await user.click(screen.getByText("Technical details"));
    expect(screen.getByText(/provider payload/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("does not offer retry after the wallet request was declined", () => {
    render(<AsyncActionStatus state={failedAction(new Error("User rejected the request"))} onRetry={vi.fn()} />);

    expect(screen.getByText(/declined/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
