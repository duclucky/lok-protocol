import { LockKeyhole, Save } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "../components/PageHeader";
import { AsyncActionStatus } from "../components/AsyncActionStatus";
import { SealedValue } from "../components/SealedValue";
import { riskSettings, type RiskSetting } from "../features/vault/model";
import {
  awaitingWallet,
  confirmed,
  failedAction,
  type AsyncActionState,
  type LokTransactionActions,
} from "../features/transactions/model";

type RiskPageProps = {
  action?: Pick<LokTransactionActions, "pending" | "setRisk">;
  revealTheta?: () => Promise<number>;
};

export function RiskPage({
  action,
  revealTheta = () => Promise.reject(new Error("Wallet decryption is not ready")),
}: RiskPageProps = {}) {
  const [risk, setRisk] = useState<RiskSetting>(100);
  const [lastSavedRisk, setLastSavedRisk] = useState<RiskSetting | undefined>();
  const [actionState, setActionState] = useState<AsyncActionState>({ phase: "idle" });
  const selected = riskSettings.find((setting) => setting.value === risk) ?? riskSettings[0];

  async function saveRisk() {
    if (action === undefined) {
      setActionState({
        phase: "failed",
        message: "Connect a Sepolia wallet to encrypt and submit this setting.",
        retryable: false,
      });
      return;
    }
    setActionState(awaitingWallet("Confirm the encrypted risk setting in your wallet."));
    try {
      const hash = await action.setRisk(risk);
      setLastSavedRisk(risk);
      setActionState(confirmed(hash, "Risk setting confirmed."));
    } catch (error) {
      setActionState(failedAction(error));
    }
  }

  return (
    <div className="page page--risk">
      <PageHeader title="Risk dial" description="Choose how your yield participates in prizes." />

      <section className="saved-setting" aria-label="Saved risk setting">
        <div>
          <p className="section-label">Current encrypted value</p>
          <h2>Saved risk setting</h2>
          <p>The clear value is available only through your wallet's explicit decryption permit.</p>
        </div>
        <SealedValue label="saved risk setting" reveal={async () => `${await revealTheta()}%`} />
      </section>

      <section className="risk-control" aria-labelledby="risk-choice-title">
        <div className="risk-control__intro">
          <LockKeyhole aria-hidden="true" size={22} />
          <div>
            <h2 id="risk-choice-title">Choose a new target</h2>
            <p>Your selection is encrypted before it is submitted to LokVault.</p>
          </div>
        </div>
        <fieldset className="risk-options">
          <legend className="sr-only">Risk percentage</legend>
          {riskSettings.map((setting) => (
            <label key={setting.value} className={risk === setting.value ? "risk-option is-selected" : "risk-option"}>
              <input
                type="radio"
                name="risk"
                value={setting.value}
                checked={risk === setting.value}
                onChange={() => {
                  setRisk(setting.value);
                  setActionState({ phase: "idle" });
                }}
              />
              <span>{setting.value}%</span>
            </label>
          ))}
        </fieldset>
        <div className="risk-explanation" aria-live="polite">
          <strong>{selected.label}</strong>
          <p>{selected.detail}</p>
        </div>
        <button
          className="button button--primary"
          type="button"
          onClick={() => void saveRisk()}
          disabled={action?.pending === true || lastSavedRisk === risk}
        >
          <Save aria-hidden="true" size={18} />
          Save encrypted setting
        </button>
        {actionState.phase !== "idle" && <AsyncActionStatus state={actionState} onRetry={() => void saveRisk()} />}
      </section>

      <section className="principle-note">
        <span className="principle-note__number">θ</span>
        <div>
          <h2>Your choice stays yours</h2>
          <p>Lok uses this encrypted value during draw accounting. It is never made publicly decryptable.</p>
        </div>
      </section>
    </div>
  );
}
