import { ArrowDownToLine, ArrowUpFromLine, Clock3, ExternalLink, Gauge, History } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "../components/PageHeader";
import { ActionStatus } from "../components/ActionStatus";
import { AsyncActionStatus } from "../components/AsyncActionStatus";
import { SealedValue } from "../components/SealedValue";
import { SolvencyStatus } from "../components/SolvencyStatus";
import { currentPrizeLabel, formatCountdown, formatUtc, type LokPublicData } from "../features/public-data/model";
import {
  awaitingWallet,
  confirmed,
  failedAction,
  type AsyncActionState,
  type LokTransactionActions,
} from "../features/transactions/model";

type VaultPageProps = {
  publicData: LokPublicData;
  nowMs?: number;
  revealBalance?: () => Promise<string>;
  withdrawAction?: Pick<LokTransactionActions, "emergencyWithdraw" | "pending" | "withdraw" | "withdrawAll">;
  revealActionStatus?: () => Promise<boolean>;
};

export function VaultPage({
  publicData,
  nowMs,
  revealBalance = () => Promise.reject(new Error("Wallet decryption is not ready")),
  withdrawAction,
  revealActionStatus,
}: VaultPageProps) {
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawState, setWithdrawState] = useState<AsyncActionState>({ phase: "idle" });
  const [lastWithdrawal, setLastWithdrawal] = useState<"amount" | "all" | "emergency">("amount");

  async function runWithdrawal(kind: "amount" | "all" | "emergency") {
    setLastWithdrawal(kind);
    if (withdrawAction === undefined) {
      setWithdrawState({
        phase: "failed",
        message: "Connect a Sepolia wallet to submit this confidential withdrawal.",
        retryable: false,
      });
      return;
    }
    setWithdrawState(
      awaitingWallet(
        kind === "amount"
          ? "Confirm the encrypted withdrawal in your wallet."
          : "Confirm the full confidential withdrawal in your wallet.",
      ),
    );
    try {
      const hash =
        kind === "amount"
          ? await withdrawAction.withdraw(withdrawAmount)
          : kind === "all"
            ? await withdrawAction.withdrawAll()
            : await withdrawAction.emergencyWithdraw();
      setWithdrawState(
        confirmed(hash, kind === "emergency" ? "Emergency recovery confirmed." : "Withdrawal confirmed."),
      );
      if (kind === "amount") setWithdrawAmount("");
    } catch (error) {
      setWithdrawState(failedAction(error));
    }
  }

  async function submitWithdrawal(event: FormEvent) {
    event.preventDefault();
    await runWithdrawal("amount");
  }

  const snapshot = publicData.status === "ready" ? publicData.snapshot : undefined;
  const draw = snapshot?.draw;
  const readLabel = publicData.status === "error" ? "Sepolia read unavailable" : "Reading Sepolia";
  const prizeLabel = snapshot === undefined ? readLabel : currentPrizeLabel(snapshot);

  return (
    <div className="page page--vault">
      <PageHeader
        title="Your vault"
        description="Private savings, public draw integrity."
        action={
          snapshot === undefined ? (
            <span className="status status--pending">{readLabel}</span>
          ) : (
            <SolvencyStatus status={snapshot.solvency} epoch={Number(snapshot.riskEpoch)} />
          )
        }
      />

      <section className="vault-balance" aria-labelledby="balance-title">
        <div>
          <p className="section-label">Your balance</p>
          <h2 id="balance-title">Sealed to your wallet</h2>
          <SealedValue label="your balance" reveal={revealBalance} />
        </div>
        <div className="vault-actions">
          <Link className="button button--primary" to="/deposit">
            <ArrowDownToLine aria-hidden="true" size={18} />
            Deposit
          </Link>
          <button
            className="button button--secondary"
            type="button"
            aria-expanded={withdrawOpen}
            aria-controls="withdraw-panel"
            onClick={() => setWithdrawOpen(true)}
          >
            <ArrowUpFromLine aria-hidden="true" size={18} />
            Withdraw
          </button>
        </div>
      </section>

      {withdrawOpen && (
        <form id="withdraw-panel" className="withdraw-panel" onSubmit={submitWithdrawal}>
          <div>
            <p className="section-label">Private transaction</p>
            <h2>Withdraw cUSDC</h2>
            <p>The requested amount remains encrypted through the vault transfer.</p>
          </div>
          <label className="field-label" htmlFor="withdraw-amount">
            Withdrawal amount
          </label>
          <div className="amount-field">
            <input
              id="withdraw-amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              value={withdrawAmount}
              onChange={(event) => setWithdrawAmount(event.target.value)}
            />
            <span>cUSDC</span>
          </div>
          <div className="withdraw-panel__actions">
            <button className="button button--secondary" type="button" onClick={() => setWithdrawOpen(false)}>
              Cancel
            </button>
            <button
              className="button button--primary"
              type="submit"
              disabled={Number(withdrawAmount) <= 0 || withdrawAction?.pending === true}
            >
              Submit withdrawal
            </button>
          </div>
          <details className="recovery-options">
            <summary>Recovery options</summary>
            <p>Exceptional recovery remains available regardless of draw state.</p>
            <div>
              <button
                className="button button--secondary"
                type="button"
                disabled={withdrawAction?.pending === true}
                onClick={() => void runWithdrawal("all")}
              >
                Withdraw all
              </button>
              <button
                className="button button--secondary button--danger"
                type="button"
                disabled={withdrawAction?.pending === true}
                onClick={() => void runWithdrawal("emergency")}
              >
                Emergency recovery
              </button>
            </div>
          </details>
          {withdrawState.phase !== "idle" && (
            <AsyncActionStatus state={withdrawState} onRetry={() => void runWithdrawal(lastWithdrawal)} />
          )}
          {withdrawState.phase === "confirmed" && revealActionStatus !== undefined && (
            <ActionStatus action="WITHDRAW" reveal={revealActionStatus} />
          )}
        </form>
      )}

      <section className="pool-strip" aria-label="Public pool data">
        <div>
          <span>Current prize</span>
          <strong className="prize-figure">{prizeLabel}</strong>
        </div>
        <div>
          <span>Next draw</span>
          <strong>
            <Clock3 aria-hidden="true" size={17} />
            {draw === undefined ? readLabel : formatCountdown(draw.tEnd, nowMs)}
          </strong>
        </div>
        <div>
          <span>Participants</span>
          <strong>{snapshot?.participantCount.toString() ?? readLabel}</strong>
        </div>
      </section>

      <div className="content-grid">
        <section className="section-block" aria-labelledby="risk-title">
          <div className="section-heading">
            <div>
              <p className="section-label">Private control</p>
              <h2 id="risk-title">Your risk dial</h2>
            </div>
            <Gauge aria-hidden="true" size={22} />
          </div>
          <div className="risk-summary">
            <strong>Sealed</strong>
            <span>Private to your wallet</span>
          </div>
          <p>Your setting is encrypted. Only you can reveal it.</p>
          <Link className="text-link" to="/risk">
            Adjust risk <ExternalLink aria-hidden="true" size={15} />
          </Link>
        </section>

        <section className="section-block history-block" aria-labelledby="history-title">
          <div className="section-heading">
            <div>
              <p className="section-label">Public record</p>
              <h2 id="history-title">Draw history</h2>
            </div>
            <History aria-hidden="true" size={22} />
          </div>
          <div className="history-list">
            {draw === undefined ? (
              <p className="data-message" role="status">
                {snapshot === undefined ? readLabel : "No draw has opened yet."}
              </p>
            ) : (
              <Link to="/draw" className="history-row">
                <span>
                  <strong>Draw {draw.id.toString()}</strong>
                  <small>{draw.settled ? `Closed ${formatUtc(draw.tEnd)}` : `Closes ${formatUtc(draw.tEnd)}`}</small>
                </span>
                <span className="prize-figure">{prizeLabel}</span>
                <span className={`status ${draw.settled ? "status--verified" : "status--pending"}`}>{draw.state}</span>
              </Link>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
