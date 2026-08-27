import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "../../components/AppShell";
import { sepoliaDeploymentAddresses } from "../../contracts/addresses";

vi.mock("../../components/WalletButton", () => ({
  WalletButton: () => <button type="button">Connect wallet</button>,
}));

describe("AppShell", () => {
  it("labels the private result route as Result instead of proof-first language", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<p>Route content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("link", { name: /result/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /^Proof$/i })).not.toBeInTheDocument();
  });

  it("uses a desktop utility sidebar and a separate mobile bottom navigation", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<p>Route content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const sidebar = screen.getByRole("complementary");
    const desktopNav = within(sidebar).getByRole("navigation", { name: "Primary navigation" });
    expect(within(desktopNav).getAllByRole("link")).toHaveLength(5);
    expect(screen.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
    expect(within(sidebar).getByRole("link", { name: "Why encrypted?" })).toHaveAttribute("href", "/why-encrypted");
    expect(within(sidebar).getByRole("button", { name: "Connect wallet" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /language/i })).not.toBeInTheDocument();
  });

  it("identifies the live network and links the verified deployment contracts", () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<p>Route content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText("Ethereum Sepolia")).toBeVisible();
    expect(within(footer).getByText("FHEVM SDK 3.4.0")).toBeVisible();
    expect(within(footer).getByText("Source unbound-local-build")).toBeVisible();
    expect(screen.getByRole("link", { name: /Vault 0xAA7B/i })).toHaveAttribute(
      "href",
      `https://sepolia.etherscan.io/address/${sepoliaDeploymentAddresses.vault}`,
    );
    expect(screen.getByRole("link", { name: /Draw 0x5592/i })).toHaveAttribute(
      "href",
      `https://sepolia.etherscan.io/address/${sepoliaDeploymentAddresses.drawManager}`,
    );
  });

  it("moves focus to route content after navigation", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Link to="/draw">Open draw</Link>} />
            <Route path="draw" element={<p>Draw content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("link", { name: "Open draw" }));

    expect(screen.getByRole("main")).toHaveFocus();
  });
});
