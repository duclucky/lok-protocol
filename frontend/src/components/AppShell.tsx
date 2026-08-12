import { BadgeCheck, CircleDollarSign, Dices, Gauge, Landmark, LockKeyhole, ShieldCheck } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

import { sepoliaDeploymentAddresses } from "../contracts/addresses";
import { WalletButton } from "./WalletButton";

const primaryNavigation = [
  { to: "/", label: "Vault", Icon: Landmark },
  { to: "/deposit", label: "Deposit", Icon: CircleDollarSign },
  { to: "/risk", label: "Risk", Icon: Gauge },
  { to: "/draw", label: "Draw", Icon: Dices },
  { to: "/proof", label: "Proof", Icon: BadgeCheck },
] as const;

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function PrimaryNav({ className }: { className: string }) {
  return (
    <nav className={className} aria-label="Primary navigation">
      {primaryNavigation.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) => (isActive ? "nav-link is-active" : "nav-link")}
        >
          <Icon aria-hidden="true" size={20} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <NavLink className="brand" to="/" aria-label="Lok Protocol home">
          <span className="brand__mark">
            <ShieldCheck aria-hidden="true" size={22} />
          </span>
          <span>
            <strong>LOK</strong>
            <small>Sealed savings</small>
          </span>
        </NavLink>
        <PrimaryNav className="desktop-nav" />
        <NavLink className="why-link" to="/why-encrypted">
          <LockKeyhole aria-hidden="true" size={18} /> Why encrypted?
        </NavLink>
      </aside>

      <div className="app-frame">
        <header className="topbar">
          <NavLink className="mobile-brand" to="/" aria-label="Lok Protocol home">
            LOK
          </NavLink>
          <div className="chain-label">
            <span className="network-dot" aria-hidden="true" />
            Sepolia
          </div>
          <WalletButton />
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>Ethereum Sepolia</span>
          <span>FHEVM 0.11.1</span>
          <a
            href={`https://sepolia.etherscan.io/address/${sepoliaDeploymentAddresses.vault}`}
            target="_blank"
            rel="noreferrer"
          >
            Vault {shortAddress(sepoliaDeploymentAddresses.vault)}
          </a>
          <a
            href={`https://sepolia.etherscan.io/address/${sepoliaDeploymentAddresses.drawManager}`}
            target="_blank"
            rel="noreferrer"
          >
            Draw {shortAddress(sepoliaDeploymentAddresses.drawManager)}
          </a>
          <span title="Deployment source SHA-256">Source d57e6446</span>
        </footer>
      </div>
      <PrimaryNav className="mobile-nav" />
    </div>
  );
}
