import { CheckCircle2, Clock3, ShieldAlert } from "lucide-react";

import type { SolvencyState } from "../features/vault/model";

type SolvencyStatusProps = {
  status: SolvencyState;
  epoch?: number;
};

const statusContent = {
  verified: { Icon: CheckCircle2, className: "status--verified", label: "Verified for risk epoch" },
  pending: { Icon: Clock3, className: "status--pending", label: "Verification pending" },
  restricted: { Icon: ShieldAlert, className: "status--restricted", label: "Restricted" },
} as const;

export function SolvencyStatus({ status, epoch }: SolvencyStatusProps) {
  const { Icon, className, label } = statusContent[status];
  const text = status === "verified" && epoch !== undefined ? `${label} ${epoch}` : label;

  return (
    <span className={`status ${className}`} aria-label={`Solvency status: ${text}`}>
      <Icon aria-hidden="true" size={16} />
      {text}
    </span>
  );
}
