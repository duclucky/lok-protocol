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

function PrimaryNav({ className, label }: { className: string; label: string }) {
  return (
    <nav className={className} aria-label={label}>
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
      <header className="topbar">
        <NavLink className="brand" to="/" aria-label="Lok Protocol home">
          <span className="brand__mark">
            <ShieldCheck aria-hidden="true" size={22} />
          </span>
          <span>
            <strong>LOK</strong>
            <small>Sealed savings</small>
          </span>
        </NavLink>
        <PrimaryNav className="desktop-nav" label="Primary navigation" />
        <div className="topbar__actions">
          <div className="chain-label">
            <span className="network-dot" aria-hidden="true" />
            Sepolia
          </div>
          <NavLink className="why-link" to="/why-encrypted">
            <LockKeyhole aria-hidden="true" size={16} /> Why encrypted?
          </NavLink>
          <WalletButton />
        </div>
      </header>

      <div className="app-frame">
        <main id="main-content" className="main-content" tabIndex={-1}>
          <Outlet />
        </main>
        <footer className="app-footer">
          <span className="app-footer__status">
            <span className="network-dot" aria-hidden="true" /> Live on Ethereum Sepolia
          </span>
          <span className="app-footer__label">Verified deployment</span>
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
        </footer>
      </div>
      <PrimaryNav className="mobile-nav" label="Mobile navigation" />
    </div>
  );
}
