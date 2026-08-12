import { LockKeyhole, Save, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "../components/PageHeader";
import { riskSettings, type RiskSetting } from "../features/vault/model";
import { transactionMessage, type LokTransactionActions } from "../features/transactions/model";

type RiskPageProps = { action?: Pick<LokTransactionActions, "pending" | "setRisk"> };

export function RiskPage({ action }: RiskPageProps = {}) {
  const [risk, setRisk] = useState<RiskSetting>(100);
  const [message, setMessage] = useState<string | undefined>();
  const selected = riskSettings.find((setting) => setting.value === risk) ?? riskSettings[0];

  async function saveRisk() {
    if (action === undefined) {
      setMessage("Connect a Sepolia wallet to encrypt and submit this setting.");
      return;
    }
    setMessage("Encrypting this setting for LokVault.");
    try {
      const hash = await action.setRisk(risk);
      setMessage(`Encrypted setting confirmed (${hash.slice(0, 10)}...).`);
    } catch (error) {
      setMessage(transactionMessage(error));
    }
  }

  return (
    <div className="page page--risk">
      <PageHeader title="Risk dial" description="Choose how your yield participates in prizes." />

      <section className="risk-control" aria-labelledby="risk-choice-title">
        <div className="risk-control__intro">
          <LockKeyhole aria-hidden="true" size={22} />
          <div>
            <h2 id="risk-choice-title">Your private setting</h2>
            <p>Nobody can see this setting: not other depositors, not Lok, not the network.</p>
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
                  setMessage(undefined);
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
          disabled={action?.pending === true}
        >
          <Save aria-hidden="true" size={18} />
          Save encrypted setting
        </button>
        {message !== undefined && (
          <p className="form-message" role="status">
            <ShieldCheck aria-hidden="true" size={16} />
            {message}
          </p>
        )}
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
