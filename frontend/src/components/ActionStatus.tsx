import { decodeVaultActionStatus, type VaultAction } from "../fhe/decryption-machine";
import { SealedValue } from "./SealedValue";

type ActionStatusProps = {
  action: VaultAction;
  reveal: () => Promise<boolean>;
};

export function ActionStatus({ action, reveal }: ActionStatusProps) {
  return (
    <div className="action-status">
      <span>Encrypted action result</span>
      <SealedValue
        label="transaction status"
        reveal={async () => decodeVaultActionStatus(action, await reveal()).message}
        autoHideMs={60_000}
      />
    </div>
  );
}
