import { ArrowRight, Coins, Info, ShieldCheck, TestTube2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { PageHeader } from "../components/PageHeader";
import { ActionStatus } from "../components/ActionStatus";
import { AsyncActionStatus } from "../components/AsyncActionStatus";
import { SealedValue } from "../components/SealedValue";
import { DemoControl } from "../features/demo/DemoControl";
import {
  awaitingWallet,
  confirmed,
  failedAction,
  type AsyncActionState,
  type LokTransactionActions,
} from "../features/transactions/model";
import type { WalletPublicData } from "../features/wallet/model";

type DepositPath = "private" | "public";

type DepositPageProps = {
  actions?: Pick<LokTransactionActions, "deposit" | "mintTestTokens" | "pending" | "shield">;
  revealActionStatus?: () => Promise<boolean>;
  revealWalletCusdc?: () => Promise<string>;
  walletData?: WalletPublicData;
};

function publicBalanceLabel(walletData: WalletPublicData): string {
  if (walletData.status === "ready") return walletData.publicUsdc;
  if (walletData.status === "error") return walletData.message;
  if (walletData.status === "loading") return "Reading wallet balance";
  return "Connect wallet to view";
}

export function DepositPage({
  actions,
  revealActionStatus,
  revealWalletCusdc = () => Promise.reject(new Error("Wallet decryption is not ready")),
  walletData = { status: "disconnected" },
}: DepositPageProps = {}) {
  const [path, setPath] = useState<DepositPath>("private");
  const [publicStep, setPublicStep] = useState<"shield" | "deposit">("shield");
  const [amount, setAmount] = useState("");
  const [actionState, setActionState] = useState<AsyncActionState>({ phase: "idle" });
  const amountError = amount !== "" && Number(amount) <= 0 ? "Amount must be greater than zero." : undefined;
  const depositsCusdc = path === "private" || publicStep === "deposit";

  function selectPath(nextPath: DepositPath) {
    setPath(nextPath);
    setPublicStep("shield");
    setActionState({ phase: "idle" });
  }

  async function runPrimaryAction() {
    if (actions === undefined) {
      setActionState({
        phase: "failed",
        message: "Connect a Sepolia wallet to encrypt and submit this transaction.",
        retryable: false,
      });
      return;
    }
    setActionState(
      awaitingWallet(
        depositsCusdc
          ? "Confirm the encrypted cUSDC deposit in your wallet."
          : "Confirm the public USDC shield transaction in your wallet.",
      ),
    );
    try {
      const hash = depositsCusdc ? await actions.deposit(amount) : await actions.shield(amount);
      if (depositsCusdc) {
        setActionState(confirmed(hash, "Deposit confirmed."));
      } else {
        setPublicStep("deposit");
        setActionState(confirmed(hash, "Shield confirmed. Continue with the separate encrypted cUSDC deposit."));
      }
    } catch (error) {
      setActionState(failedAction(error));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await runPrimaryAction();
  }

  async function getTestTokens() {
    if (actions === undefined) {
      setActionState({
        phase: "failed",
        message: "Connect a Sepolia wallet before requesting test tokens.",
        retryable: false,
      });
      return;
    }
    setActionState(awaitingWallet("Confirm the Sepolia mock-USDC mint in your wallet."));
    try {
      const hash = await actions.mintTestTokens();
      setPath("public");
      setPublicStep("shield");
      setAmount("10");
      setActionState(confirmed(hash, "10 test USDC minted. Review the public-entry warning before shielding."));
    } catch (error) {
      setActionState(failedAction(error));
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
            <span>Step {path === "private" ? "1 of 1" : publicStep === "shield" ? "1 of 2" : "2 of 2"}</span>
            <span>Sepolia</span>
          </div>
          <h2 id="amount-title">{depositsCusdc ? "Deposit cUSDC" : "Shield USDC"}</h2>
          {path === "public" && publicStep === "shield" && (
            <div className="warning-box" role="note">
              <Info aria-hidden="true" size={20} />
              <p>
                <strong>Shielding publishes this amount on-chain.</strong> The later Lok deposit uses encrypted cUSDC.
                Deposit in a separate transaction to weaken the public link.
              </p>
            </div>
          )}
          {path === "public" && publicStep === "deposit" && (
            <p className="step-note" role="note">
              Shield confirmed. The later Lok deposit uses encrypted cUSDC and does not publish this amount again.
            </p>
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
              aria-invalid={amountError !== undefined}
              aria-describedby={amountError === undefined ? undefined : "deposit-amount-error"}
              onChange={(event) => setAmount(event.target.value)}
            />
            <span>{depositsCusdc ? "cUSDC" : "USDC"}</span>
          </div>
          {amountError !== undefined && (
            <p id="deposit-amount-error" className="field-error">
              {amountError}
            </p>
          )}
          <div className="funding-balance" aria-label="Available funding balance">
            <span>Available in wallet</span>
            {depositsCusdc ? (
              <SealedValue label="wallet cUSDC balance" reveal={revealWalletCusdc} />
            ) : (
              <strong className="mono">{publicBalanceLabel(walletData)}</strong>
            )}
          </div>
          <button
            className="button button--primary button--wide"
            type="submit"
            disabled={amount === "" || amountError !== undefined || actions?.pending === true}
          >
            {path === "private"
              ? "Deposit privately"
              : publicStep === "shield"
                ? "Shield and continue"
                : "Deposit encrypted cUSDC"}
            <ArrowRight aria-hidden="true" size={18} />
          </button>
          {actionState.phase !== "idle" && (
            <AsyncActionStatus state={actionState} onRetry={() => void runPrimaryAction()} />
          )}
          {actionState.phase === "confirmed" && depositsCusdc && revealActionStatus !== undefined && (
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
