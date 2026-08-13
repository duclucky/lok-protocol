import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "../../components/AppShell";
import { sepoliaDeploymentAddresses } from "../../contracts/addresses";

vi.mock("../../components/WalletButton", () => ({
  WalletButton: () => <button type="button">Connect wallet</button>,
}));

describe("AppShell", () => {
  it("uses a desktop top navigation and a separate mobile bottom navigation", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<p>Route content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const header = screen.getByRole("banner");
    const desktopNav = within(header).getByRole("navigation", { name: "Primary navigation" });
    expect(within(desktopNav).getAllByRole("link")).toHaveLength(5);
    expect(screen.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Why encrypted?" })).toHaveAttribute("href", "/why-encrypted");
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

    expect(screen.getAllByText("Sepolia").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Vault 0xAA7B/i })).toHaveAttribute(
      "href",
      `https://sepolia.etherscan.io/address/${sepoliaDeploymentAddresses.vault}`,
    );
    expect(screen.getByRole("link", { name: /Draw 0x5592/i })).toHaveAttribute(
      "href",
      `https://sepolia.etherscan.io/address/${sepoliaDeploymentAddresses.drawManager}`,
    );
  });
});
