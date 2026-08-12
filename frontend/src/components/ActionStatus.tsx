import { decodeVaultActionStatus, type VaultAction } from "../fhe/decryption-machine";
import { SealedValue } from "./SealedValue";

type ActionStatusProps = {
  action: VaultAction;
  succeeded: boolean;
};

export function ActionStatus({ action, succeeded }: ActionStatusProps) {
  const result = decodeVaultActionStatus(action, succeeded);
  return (
    <div className="action-status">
      <span>Encrypted action result</span>
      <SealedValue label="transaction status" reveal={() => Promise.resolve(result.message)} autoHideMs={60_000} />
    </div>
  );
}
