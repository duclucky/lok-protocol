import {
  CheckCircle2,
  CircleAlert,
  CircleDot,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import type { AsyncActionState } from "../features/transactions/model";

type AsyncActionStatusProps = Readonly<{
  state: AsyncActionState;
  onRetry?: () => void;
}>;

const phasePresentation = {
  idle: { label: "Ready", Icon: CircleDot },
  validating: { label: "Checking", Icon: ShieldCheck },
  "awaiting-wallet": { label: "Wallet confirmation", Icon: WalletCards },
  processing: { label: "Processing confidential action", Icon: LoaderCircle },
  submitted: { label: "Submitted", Icon: LoaderCircle },
  confirming: { label: "Confirming on Sepolia", Icon: LoaderCircle },
  confirmed: { label: "Confirmed", Icon: CheckCircle2 },
  failed: { label: "Action not completed", Icon: CircleAlert },
} as const;

function shortHash(hash: `0x${string}`): string {
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

export function AsyncActionStatus({ state, onRetry }: AsyncActionStatusProps) {
  const { label, Icon } = phasePresentation[state.phase];
  const isBusy = ["validating", "awaiting-wallet", "processing", "submitted", "confirming"].includes(state.phase);
  const hasHash = state.phase === "submitted" || state.phase === "confirming" || state.phase === "confirmed";
  const message = state.phase === "idle" ? "Ready for the next action." : state.message;

  return (
    <div
      className={`async-action-status async-action-status--${state.phase}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={isBusy}
    >
      <Icon className={isBusy ? "spin" : undefined} aria-hidden="true" size={20} />
      <div className="async-action-status__body">
        <strong>{label}</strong>
        <p>{message}</p>
        {hasHash && (
          <a
            className="async-action-status__transaction mono"
            href={`https://sepolia.etherscan.io/tx/${state.hash}`}
            target="_blank"
            rel="noreferrer"
          >
            {shortHash(state.hash)} <ExternalLink aria-hidden="true" size={14} />
            <span className="sr-only">View transaction on Etherscan</span>
          </a>
        )}
        {state.phase === "failed" && state.technicalDetail !== undefined && (
          <details className="async-action-status__details">
            <summary>Technical details</summary>
            <code>{state.technicalDetail}</code>
          </details>
        )}
      </div>
      {state.phase === "failed" && state.retryable && onRetry !== undefined && (
        <button className="button button--secondary" type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
