import { ArrowRight, Coins, Info, ShieldCheck, TestTube2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { PageHeader } from "../components/PageHeader";
import { ActionStatus } from "../components/ActionStatus";
import { DemoControl } from "../features/demo/DemoControl";
import { transactionMessage, type LokTransactionActions } from "../features/transactions/model";

type DepositPath = "private" | "public";

type DepositPageProps = {
  actions?: Pick<LokTransactionActions, "deposit" | "mintTestTokens" | "pending" | "shield">;
  revealActionStatus?: () => Promise<boolean>;
};

export function DepositPage({ actions, revealActionStatus }: DepositPageProps = {}) {
  const [path, setPath] = useState<DepositPath>("private");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<string | undefined>();
  const [depositConfirmed, setDepositConfirmed] = useState(false);

  function selectPath(nextPath: DepositPath) {
    setPath(nextPath);
    setMessage(undefined);
    setDepositConfirmed(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (actions === undefined) {
      setMessage("Connect a Sepolia wallet to encrypt and submit this transaction.");
      return;
    }
    setMessage(path === "private" ? "Encrypting the deposit for LokVault." : "Submitting the public shield transaction.");
    setDepositConfirmed(false);
    try {
      const hash = path === "private" ? await actions.deposit(amount) : await actions.shield(amount);
      if (path === "private") {
        setMessage(`Transaction confirmed. Reveal the encrypted result (${hash.slice(0, 10)}...).`);
        setDepositConfirmed(true);
      } else {
        setMessage(`Shield confirmed (${hash.slice(0, 10)}...). Wait before making the separate private deposit.`);
      }
    } catch (error) {
      setMessage(transactionMessage(error));
    }
  }

  async function getTestTokens() {
    if (actions === undefined) {
      setMessage("Connect a Sepolia wallet before requesting test tokens.");
      return;
    }
    setMessage("Confirm the Sepolia mock-USDC mint in your wallet.");
    try {
      const hash = await actions.mintTestTokens();
      setPath("public");
      setAmount("10");
      setMessage(`10 test USDC minted (${hash.slice(0, 10)}...). Review the public-entry warning before shielding.`);
    } catch (error) {
      setMessage(transactionMessage(error));
    }
  }

  return (
    <div className="page page--deposit">
      <PageHeader title="Deposit" description="Choose how your funds enter the sealed vault." />

      <form className="deposit-layout" onSubmit={submit}>
        <fieldset className="path-selector">
          <legend>Funding source</legend>
          <label className={path === "private" ? "path-option is-selected" : "path-option"}>
            <input
              type="radio"
              name="deposit-path"
              value="private"
              checked={path === "private"}
              onChange={() => selectPath("private")}
            />
            <span className="path-option__icon">
              <ShieldCheck aria-hidden="true" size={22} />
            </span>
            <span>
              <strong>Private cUSDC</strong>
              <small>Already shielded</small>
            </span>
            <span className="privacy-badge privacy-badge--private">Fully private</span>
          </label>
          <label className={path === "public" ? "path-option is-selected" : "path-option"}>
            <input
              type="radio"
              name="deposit-path"
              value="public"
              checked={path === "public"}
              onChange={() => selectPath("public")}
            />
            <span className="path-option__icon">
              <Coins aria-hidden="true" size={22} />
            </span>
            <span>
              <strong>Public USDC</strong>
              <small>Shield before deposit</small>
            </span>
            <span className="privacy-badge privacy-badge--visible">Entry amount visible</span>
          </label>
        </fieldset>

        <section className="transaction-panel" aria-labelledby="amount-title">
          <div className="transaction-panel__top">
            <span>Step {path === "private" ? "1 of 1" : "1 of 2"}</span>
            <span>Sepolia</span>
          </div>
          <h2 id="amount-title">{path === "private" ? "Deposit cUSDC" : "Shield USDC"}</h2>
          {path === "public" && (
            <div className="warning-box" role="note">
              <Info aria-hidden="true" size={20} />
              <p>
                <strong>Shielding publishes this amount on-chain.</strong> Your balance inside Lok stays private, but
                the deposit amount will be visible. Deposit in a separate, later transaction to weaken the link.
              </p>
            </div>
          )}
          <label className="field-label" htmlFor="deposit-amount">
            Amount
          </label>
          <div className="amount-field">
            <input
              id="deposit-amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <span>{path === "private" ? "cUSDC" : "USDC"}</span>
          </div>
          <div className="available-row">
            <span>Available</span>
            <span className="mono">Connect wallet to view</span>
          </div>
          <button
            className="button button--primary button--wide"
            type="submit"
            disabled={Number(amount) <= 0 || actions?.pending === true}
          >
            {path === "private" ? "Deposit privately" : "Shield and continue"}
            <ArrowRight aria-hidden="true" size={18} />
          </button>
          {message !== undefined && (
            <p className="form-message" role="status">
              {message}
            </p>
          )}
          {depositConfirmed && revealActionStatus !== undefined && (
            <ActionStatus action="DEPOSIT" reveal={revealActionStatus} />
          )}
        </section>
      </form>

      <DemoControl>
        <div>
          <strong>Need Sepolia funds?</strong>
          <span>Mint mock USDC and shield it in a guided test flow.</span>
        </div>
        <button
          className="button button--demo"
          type="button"
          onClick={() => void getTestTokens()}
          disabled={actions?.pending === true}
        >
          <TestTube2 aria-hidden="true" size={18} />
          Get test tokens
        </button>
      </DemoControl>
    </div>
  );
}
