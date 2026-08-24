import { BadgeCheck, Eye, LoaderCircle, LockKeyhole, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "../components/PageHeader";
import { classifyDecryptionFailure, type DecryptionFailureKind } from "../fhe/decryption-machine";

type ProofPageProps = { revealCredit?: () => Promise<bigint>; drawId?: bigint };

type ResultState = "sealed" | "decrypting" | "none" | "winner" | "failed";

export function ProofPage({
  revealCredit = () => Promise.reject(new Error("Wallet decryption is not ready")),
  drawId,
}: ProofPageProps) {
  const [state, setState] = useState<ResultState>("sealed");
  const [credit, setCredit] = useState<bigint>(0n);
  const [failureKind, setFailureKind] = useState<DecryptionFailureKind>("network");

  async function checkResult() {
    setState("decrypting");
    try {
      const value = await revealCredit();
      setCredit(value);
      setState(value > 0n ? "winner" : "none");
    } catch (error) {
      setFailureKind(classifyDecryptionFailure(error));
      setState("failed");
    }
  }

  return (
    <div className="page page--proof">
      <PageHeader title="Claim privately" description="The same EIP-712 decrypt flow for every participant." />

      <section className="claim-sequence" aria-label="Private prize flow">
        <p>Settlement credits encrypted winnings automatically.</p>
        <p>Checking decrypts only your connected wallet's credit.</p>
        <p>Withdrawal moves principal and credited winnings as confidential cUSDC.</p>
      </section>

      <section className={`proof-stage proof-stage--${state}`} aria-live="polite">
        {(state === "sealed" || state === "decrypting") && (
          <>
            <div className="proof-seal">
              <LockKeyhole aria-hidden="true" size={32} />
            </div>
            <p className="section-label">{drawId === undefined ? "Current draw" : `Draw ${drawId.toString()}`}</p>
            <h2>Your prize credit is sealed</h2>
            <p>Claiming means your wallet decrypts its own credit. There is no winner-only transaction.</p>
            <button
              className="button button--primary"
              type="button"
              onClick={() => void checkResult()}
              disabled={state === "decrypting"}
            >
              {state === "decrypting" ? (
                <LoaderCircle className="spin" aria-hidden="true" size={18} />
              ) : (
                <Eye aria-hidden="true" size={18} />
              )}
              {state === "decrypting" ? "Checking prize" : "Claim / check prize"}
            </button>
          </>
        )}
        {state === "none" && (
          <>
            <div className="proof-seal">
              <BadgeCheck aria-hidden="true" size={32} />
            </div>
            <p className="section-label">{drawId === undefined ? "Current draw" : `Draw ${drawId.toString()}`}</p>
            <h2>No prize this draw</h2>
            <p>Your principal remains in the vault and your next draw stays private.</p>
            <a className="button button--primary" href="/deposit">
              Deposit for next draw
            </a>
          </>
        )}
        {state === "winner" && (
          <>
            <div className="proof-seal proof-seal--winner">
              <BadgeCheck aria-hidden="true" size={32} />
            </div>
            <p className="section-label">{drawId === undefined ? "Current draw" : `Draw ${drawId.toString()}`}</p>
            <h2>Prize available</h2>
            <strong className="winner-amount">{(Number(credit) / 1_000_000).toFixed(2)} cUSDC</strong>
            <p>The credit was assigned during settlement and is visible only through your wallet decryption.</p>
            <a className="button button--primary" href="/?withdraw=1">
              Withdraw winnings
            </a>
            <p className="proof-local-note">
              Public proof publication is not available in this build. Your revealed result remains on this device.
            </p>
          </>
        )}
        {state === "failed" && (
          <>
            <div className="proof-seal">
              <ShieldAlert aria-hidden="true" size={32} />
            </div>
            <h2>Result unavailable</h2>
            <p>{failureCopy[failureKind].message}</p>
            <p>This read failure did not change your funds or credit.</p>
            {failureKind === "sdk_unavailable" ? (
              <button className="button button--secondary" type="button" onClick={() => window.location.reload()}>
                Reload private reads
              </button>
            ) : (
              <button className="button button--secondary" type="button" onClick={() => void checkResult()}>
                {failureCopy[failureKind].action}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

const failureCopy: Record<DecryptionFailureKind, Readonly<{ message: string; action: string }>> = {
  wallet_rejected: {
    message: "The private-read request was declined in your wallet.",
    action: "Try again",
  },
  sdk_unavailable: {
    message: "Private reads are unavailable in this browser session.",
    action: "Reload private reads",
  },
  timeout: {
    message: "The decryption request timed out before a result was returned.",
    action: "Retry decryption",
  },
  network: {
    message: "The decryption network did not return a result.",
    action: "Retry check",
  },
};
