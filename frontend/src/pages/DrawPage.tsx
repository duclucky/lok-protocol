import { Copy, Dices, ExternalLink, LoaderCircle, Play, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { Hex } from "viem";

import { PageHeader } from "../components/PageHeader";
import { DRAW_STATES, drawStateDetails, type DrawState, userDrawDetails } from "../features/draw/model";
import { keeperDecision, keeperExecutionKey, type KeeperExecutionLogEntry } from "../features/keeper/model";
import { formatUtc, type LokPublicData, ZERO_BYTES32 } from "../features/public-data/model";
import { transactionMessage, type LokTransactionActions } from "../features/transactions/model";

export { DRAW_STATES };

type DrawViewMode = "user" | "demo";

type DrawPageProps = {
  publicData: LokPublicData;
  keeperAction?: Pick<LokTransactionActions, "pending" | "advanceDraw">;
  nowMs?: number;
};

export function DrawPage({ publicData, keeperAction, nowMs }: DrawPageProps) {
  const [copied, setCopied] = useState(false);
  const [keeperMessage, setKeeperMessage] = useState<string>();
  const [viewMode, setViewMode] = useState<DrawViewMode>("user");
  const [executionLog, setExecutionLog] = useState<readonly KeeperExecutionLogEntry[]>([]);

  if (publicData.status !== "ready") {
    const message =
      publicData.status === "error" ? publicData.message : "Reading the current draw from Ethereum Sepolia.";
    return (
      <div className="page page--draw">
        <PageHeader title="Current draw" description="Live public state, sealed participant outcomes." />
        <section className="section-block data-message" role="status">
          {message}
        </section>
      </div>
    );
  }

  const draw = publicData.snapshot.draw;
  const keeper = keeperDecision(publicData.snapshot, nowMs);
  if (draw === undefined) {
    return (
      <div className="page page--draw">
        <PageHeader title="Current draw" description="Live public state, sealed participant outcomes." />
        <DrawViewSwitch viewMode={viewMode} setViewMode={setViewMode} />
        {viewMode === "demo" ? (
          <div className="draw-grid">
            <KeeperPanel
              decision={keeper}
              keeperAction={keeperAction}
              message={keeperMessage}
              setMessage={setKeeperMessage}
              onConfirmed={recordKeeperConfirmation}
            />
            <ExecutionLogPanel entries={executionLog} />
          </div>
        ) : (
          <section className="user-draw-block" aria-labelledby="no-draw-title">
            <div className="section-heading">
              <div>
                <p className="section-label">Current state</p>
                <h2 id="no-draw-title">No draw has opened on this deployment yet</h2>
              </div>
              <ShieldCheck aria-hidden="true" size={22} />
            </div>
            <p className="user-draw-block__summary">Deposits and withdrawals remain available.</p>
            <p className="user-draw-block__note">No action is required from depositors.</p>
          </section>
        )}
      </div>
    );
  }

  const state = draw.state;
  const detail = drawStateDetails[state];
  const cursor = state === "OPEN" ? draw.preSyncCursor : draw.cursor;
  const randomHandle = draw.randomHandle;
  const randomMaterialReady = randomHandle !== ZERO_BYTES32;
  const isDemoView = viewMode === "demo";

  async function copyRandomHandle() {
    await navigator.clipboard.writeText(randomHandle);
    setCopied(true);
  }

  function recordKeeperConfirmation(label: string, hash: Hex) {
    const entry: KeeperExecutionLogEntry = { step: label, hash, status: "confirmed" };
    setExecutionLog((entries) => [entry, ...entries].slice(0, 12));
  }

  return (
    <div className="page page--draw">
      <PageHeader
        title={`Draw ${draw.id.toString()}`}
        description="Live public state, sealed participant outcomes."
        action={
          <span className="draw-mode">
            <ShieldCheck aria-hidden="true" size={16} />
            {draw.strict ? "Strict mode" : "Non-strict demo mode"}
          </span>
        }
      />

      <DrawViewSwitch viewMode={viewMode} setViewMode={setViewMode} />

      {isDemoView ? (
        <>
          <section className="draw-console" aria-labelledby="draw-state-heading">
            <div className="draw-console__state">
              <p className="section-label">Current state</p>
              <h2 id="draw-state-heading" aria-label={state}>
                {state}
              </h2>
              <strong>{detail.label}</strong>
              <p>{detail.detail}</p>
            </div>
            <div className="draw-progress">
              <div className="progress-heading">
                <span>Draw progress</span>
                <strong>{detail.progress}%</strong>
              </div>
              <progress aria-label="Draw progress" value={detail.progress} max={100} />
              <ol className="state-rail" aria-label="Draw state sequence">
                {DRAW_STATES.map((item) => (
                  <li
                    key={item}
                    className={DRAW_STATES.indexOf(item) <= DRAW_STATES.indexOf(state) ? "is-complete" : ""}
                  >
                    <span />
                    {item}
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <div className="draw-grid">
            <section className="section-block sweep-block" aria-labelledby="sweep-title">
              <div className="section-heading">
                <div>
                  <p className="section-label">Paginated accounting</p>
                  <h2 id="sweep-title">Sweep progress</h2>
                </div>
                <Dices aria-hidden="true" size={22} />
              </div>
              <div className="cursor-figure">
                <strong>{state === "IDLE" ? "0" : cursor.toString()}</strong>
                <span>/ {draw.participantSnapshot.toString()} participants</span>
              </div>
              <progress
                aria-label="Participant sweep progress"
                value={state === "IDLE" ? 0 : Number(cursor)}
                max={Number(draw.participantSnapshot)}
              />
              {executionLog.length > 0 && (
                <p className="sweep-tx-summary">
                  This browser confirmed {executionLog.length.toString()} keeper{" "}
                  {executionLog.length === 1 ? "transaction" : "transactions"}.
                </p>
              )}
              <p>Small batches keep each encrypted transaction within the measured Sepolia compute cap.</p>
            </section>

            <section className="section-block commitment-block" aria-labelledby="commitment-title">
              <div className="section-heading">
                <div>
                  <p className="section-label">Randomness sequencing</p>
                  <h2 id="commitment-title">
                    {state === "REVEAL"
                      ? "Random material remains unavailable until the reveal window closes"
                      : randomMaterialReady
                        ? "Random material fixed before winner assignment"
                        : "Random material not generated yet"}
                  </h2>
                </div>
                <ShieldCheck aria-hidden="true" size={22} />
              </div>
              <p>
                {randomMaterialReady
                  ? "The encrypted handle is public; its value stays unreadable until the approved aggregate decryption."
                  : "No code path exposes or evaluates the random material before its permitted state transition."}
              </p>
              {randomMaterialReady && (
                <div className="handle-row">
                  <code>{randomHandle}</code>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={copied ? "Random handle copied" : "Copy random handle"}
                    title={copied ? "Copied" : "Copy random handle"}
                    onClick={() => void copyRandomHandle()}
                  >
                    <Copy aria-hidden="true" size={17} />
                  </button>
                </div>
              )}
              <dl className="detail-list">
                <div>
                  <dt>Draw closes</dt>
                  <dd className="mono">{formatUtc(draw.tEnd)}</dd>
                </div>
                <div>
                  <dt>Reveal closes</dt>
                  <dd className="mono">{formatUtc(draw.revealDeadline)}</dd>
                </div>
              </dl>
            </section>

            <KeeperPanel
              decision={keeper}
              keeperAction={keeperAction}
              message={keeperMessage}
              setMessage={setKeeperMessage}
              onConfirmed={recordKeeperConfirmation}
            />
            <ExecutionLogPanel entries={executionLog} />
          </div>

          {state === "SETTLED" && (
            <section className="settled-band" aria-labelledby="settled-title">
              <div>
                <p className="section-label">Settlement facts</p>
                <h2 id="settled-title">Independent check ready</h2>
              </div>
              <dl>
                <div>
                  <dt>Revealed r</dt>
                  <dd className="mono">Public decryption pending</dd>
                </div>
                <div>
                  <dt>Total ticket space</dt>
                  <dd className="mono">{draw.totalTickets.toLocaleString("en-US")}</dd>
                </div>
              </dl>
              <p className="verification-note">
                Use the external verifier to reproduce the complete settlement checks. This interface does not simulate
                verification.
              </p>
            </section>
          )}
        </>
      ) : (
        <UserDrawPanel state={state} />
      )}
    </div>
  );
}

function DrawViewSwitch({
  viewMode,
  setViewMode,
}: Readonly<{ viewMode: DrawViewMode; setViewMode(mode: DrawViewMode): void }>) {
  return (
    <div className="draw-view-control">
      <div className="draw-view-switch" aria-label="Draw page view">
        <button type="button" aria-pressed={viewMode === "user"} onClick={() => setViewMode("user")}>
          Live user mode
        </button>
        <button type="button" aria-pressed={viewMode === "demo"} onClick={() => setViewMode("demo")}>
          Demo progress mode
        </button>
      </div>
      <p className="draw-view-hint">
        {viewMode === "user"
          ? "What judges normally see: a calm depositor-facing status with no keeper controls."
          : "Manual fallback for demos: automation should run the draw, but this browser can advance the next keeper step."}
      </p>
    </div>
  );
}

type KeeperPanelProps = Readonly<{
  decision: ReturnType<typeof keeperDecision>;
  keeperAction?: Pick<LokTransactionActions, "pending" | "advanceDraw">;
  message?: string;
  setMessage(message: string | undefined): void;
  onConfirmed(label: string, hash: Hex): void;
}>;

function KeeperPanel({ decision, keeperAction, message, setMessage, onConfirmed }: KeeperPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const pending = keeperAction?.pending === true || submitting;
  const disabled = keeperAction === undefined || pending || decision.action === undefined;

  async function advance() {
    if (keeperAction === undefined || decision.action === undefined) return;
    setMessage(
      decision.action.kind === "submitTotals"
        ? "Requesting public decryption of draw totals"
        : "Submitting keeper transaction.",
    );
    setSubmitting(true);
    try {
      const hash = await keeperAction.advanceDraw(decision.action);
      setMessage(`Confirmed ${hash}`);
      onConfirmed(decision.label, hash);
    } catch (error) {
      setMessage(transactionMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="section-block keeper-block" aria-labelledby="keeper-title">
      <div className="section-heading">
        <div>
          <p className="section-label">Demo control</p>
          <h2 id="keeper-title">Keeper panel</h2>
        </div>
        <Play aria-hidden="true" size={22} />
      </div>
      <p>{decision.detail}</p>
      <div className="keeper-status" role="note">
        <strong>Keeper automation is advancing this draw</strong>
        <span>
          No action is required from depositors. The control below is a permissionless fallback if automation stalls.
        </span>
      </div>
      <button className="button button--secondary" type="button" disabled={disabled} onClick={() => void advance()}>
        {pending ? (
          <LoaderCircle className="spin" aria-hidden="true" size={18} />
        ) : (
          <Play aria-hidden="true" size={18} />
        )}
        Run next step manually: {decision.label}
      </button>
      <p className="keeper-note">
        Anyone can run keeper steps. The aggregate public-decrypt step submits only draw totals, never per-user balances
        or prize credits.
      </p>
      {(decision.disabledReason !== undefined || keeperAction === undefined || message !== undefined) && (
        <p className="form-message" role="status">
          {message ?? decision.disabledReason ?? "Connect a Sepolia wallet to advance the draw."}
        </p>
      )}
    </section>
  );
}

function UserDrawPanel({ state }: Readonly<{ state: DrawState }>) {
  const detail = userDrawDetails[state];

  return (
    <section className="user-draw-block" aria-labelledby="user-draw-title">
      <div className="section-heading">
        <div>
          <p className="section-label">Current state</p>
          <h2 id="user-draw-title" aria-label={state}>
            {detail.title}
          </h2>
        </div>
        <ShieldCheck aria-hidden="true" size={22} />
      </div>
      <p className="user-draw-block__summary">{detail.summary}</p>
      <p className="user-draw-block__note">Draw automation is running through permissionless onchain keeper steps.</p>
      {state === "SETTLED" && (
        <a className="button button--primary" href="/proof">
          Check private result
        </a>
      )}
      <dl className="user-draw-facts">
        <div>
          <dt>Your action</dt>
          <dd>{detail.actionRequired ? "Check your private result" : "No action is required from depositors"}</dd>
        </div>
        <div>
          <dt>Next protocol step</dt>
          <dd>{detail.nextStep}</dd>
        </div>
      </dl>
    </section>
  );
}

function ExecutionLogPanel({ entries }: Readonly<{ entries: readonly KeeperExecutionLogEntry[] }>) {
  return (
    <section className="section-block execution-log-block" aria-labelledby="execution-log-title">
      <div className="section-heading">
        <div>
          <p className="section-label">Demo progress</p>
          <h2 id="execution-log-title">Execution log</h2>
        </div>
        <ExternalLink aria-hidden="true" size={22} />
      </div>
      {entries.length === 0 ? (
        <p>
          No keeper transactions recorded in this browser session yet. Automation can still advance the draw onchain;
          confirmed transactions remain visible on Sepolia explorers.
        </p>
      ) : (
        <ol className="execution-log-list">
          {entries.map((entry) => (
            <li key={keeperExecutionKey(entry)}>
              <span>{entry.step}</span>
              <strong className={`execution-status execution-status--${entry.status}`}>
                {entry.status === "confirmed" ? "Confirmed" : entry.status === "submitted" ? "Submitted" : "Failed"}
              </strong>
              <a
                className="mono"
                href={`https://sepolia.etherscan.io/tx/${entry.hash}`}
                rel="noreferrer"
                target="_blank"
              >
                {shortHash(entry.hash)}
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function shortHash(hash: Hex): string {
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}
