import { BadgeCheck, Eye, LoaderCircle, LockKeyhole, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "../components/PageHeader";

type ProofPageProps = { revealCredit?: () => Promise<bigint>; drawId?: bigint };

type ResultState = "sealed" | "decrypting" | "none" | "winner" | "failed";

export function ProofPage({
  revealCredit = () => Promise.reject(new Error("Wallet decryption is not ready")),
  drawId,
}: ProofPageProps) {
  const [state, setState] = useState<ResultState>("sealed");
  const [credit, setCredit] = useState<bigint>(0n);

  async function checkResult() {
    setState("decrypting");
    try {
      const value = await revealCredit();
      setCredit(value);
      setState(value > 0n ? "winner" : "none");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="page page--proof">
      <PageHeader title="Your draw result" description="The same private check for every participant." />

      <section className={`proof-stage proof-stage--${state}`} aria-live="polite">
        {(state === "sealed" || state === "decrypting") && (
          <>
            <div className="proof-seal">
              <LockKeyhole aria-hidden="true" size={32} />
            </div>
            <p className="section-label">{drawId === undefined ? "Current draw" : `Draw ${drawId.toString()}`}</p>
            <h2>Your credit is sealed</h2>
            <p>Only your wallet can request this result.</p>
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
              {state === "decrypting" ? "Checking result" : "Check my result"}
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
          </>
        )}
        {state === "winner" && (
          <>
            <div className="proof-seal proof-seal--winner">
              <BadgeCheck aria-hidden="true" size={32} />
            </div>
            <p className="section-label">{drawId === undefined ? "Current draw" : `Draw ${drawId.toString()}`}</p>
            <h2>You received a prize</h2>
            <strong className="winner-amount">{(Number(credit) / 1_000_000).toFixed(2)} cUSDC</strong>
            <p>This result is still private to your wallet.</p>
          </>
        )}
        {state === "failed" && (
          <>
            <div className="proof-seal">
              <ShieldAlert aria-hidden="true" size={32} />
            </div>
            <h2>Result unavailable</h2>
            <p>The decryption network did not respond. Your funds and result are unchanged.</p>
            <button className="button button--secondary" type="button" onClick={() => void checkResult()}>
              Retry check
            </button>
          </>
        )}
      </section>

      {state === "winner" && (
        <section className="publish-panel" aria-labelledby="publish-title">
          <div>
            <p className="section-label">Public proof</p>
            <h2 id="publish-title">Private result only</h2>
            <p>Public proof publication is not available in this build. Your revealed result remains on this device.</p>
          </div>
        </section>
      )}
    </div>
  );
}
