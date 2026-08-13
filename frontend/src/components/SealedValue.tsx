import { Eye, EyeOff, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type SealedValueProps = {
  label: string;
  reveal: () => Promise<string>;
  autoHideMs?: number;
  valueTone?: "default" | "prize";
  errorMessage?: string;
};

type ViewState =
  | { status: "sealed" }
  | { status: "decrypting" }
  | { status: "revealed"; value: string }
  | { status: "failed" };

export function SealedValue({
  label,
  reveal,
  autoHideMs = 60_000,
  valueTone = "default",
  errorMessage = "Could not reach the decryption network. This private read failed.",
}: SealedValueProps) {
  const [state, setState] = useState<ViewState>({ status: "sealed" });
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    },
    [],
  );

  async function revealValue() {
    setState({ status: "decrypting" });
    try {
      const value = await reveal();
      setState({ status: "revealed", value });
      timerRef.current = setTimeout(() => setState({ status: "sealed" }), autoHideMs);
    } catch {
      setState({ status: "failed" });
    }
  }

  function sealValue() {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    setState({ status: "sealed" });
  }

  if (state.status === "revealed") {
    return (
      <div className="revealed-value" aria-live="polite">
        <span className={valueTone === "prize" ? "prize-figure" : "private-figure"}>{state.value}</span>
        <button
          className="icon-button"
          type="button"
          onClick={sealValue}
          aria-label={`Hide ${label}`}
          title={`Hide ${label}`}
        >
          <EyeOff aria-hidden="true" size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="sealed-value">
      <div className="sealed-value__veil" aria-hidden="true">
        <ShieldCheck size={18} />
        <span>Encrypted</span>
      </div>
      {state.status === "failed" ? (
        <div className="sealed-value__error" role="alert">
          <span>{errorMessage}</span>
          <button className="text-button" type="button" onClick={() => void revealValue()}>
            <RefreshCw aria-hidden="true" size={16} /> Retry
          </button>
        </div>
      ) : (
        <button
          className="reveal-button"
          type="button"
          onClick={() => void revealValue()}
          disabled={state.status === "decrypting"}
          aria-label={`${state.status === "decrypting" ? "Decrypting" : "Reveal"} ${label}`}
        >
          {state.status === "decrypting" ? (
            <LoaderCircle className="spin" aria-hidden="true" size={18} />
          ) : (
            <Eye aria-hidden="true" size={18} />
          )}
          {state.status === "decrypting" ? "Decrypting" : "Reveal"}
        </button>
      )}
    </div>
  );
}
