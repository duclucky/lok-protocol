import { CheckCircle2, Copy, Dices, Play, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "../components/PageHeader";
import { DRAW_STATES, drawStateDetails } from "../features/draw/model";
import { formatUtc, type LokPublicData, ZERO_BYTES32 } from "../features/public-data/model";

export { DRAW_STATES };

type DrawPageProps = { publicData: LokPublicData };

export function DrawPage({ publicData }: DrawPageProps) {
  const [verified, setVerified] = useState(false);
  const [copied, setCopied] = useState(false);

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
  if (draw === undefined) {
    return (
      <div className="page page--draw">
        <PageHeader title="Current draw" description="Live public state, sealed participant outcomes." />
        <section className="section-block data-message" role="status">
          No draw has opened on this deployment yet.
        </section>
      </div>
    );
  }

  const state = draw.state;
  const detail = drawStateDetails[state];
  const cursor = state === "OPEN" ? draw.preSyncCursor : draw.cursor;
  const randomHandle = draw.randomHandle;
  const randomMaterialReady = randomHandle !== ZERO_BYTES32;

  async function copyRandomHandle() {
    await navigator.clipboard.writeText(randomHandle);
    setCopied(true);
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
              <li key={item} className={DRAW_STATES.indexOf(item) <= DRAW_STATES.indexOf(state) ? "is-complete" : ""}>
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
          <button className="button button--secondary" type="button" onClick={() => setVerified(true)}>
            {verified ? <CheckCircle2 aria-hidden="true" size={18} /> : <Play aria-hidden="true" size={18} />}
            {verified ? "Verification requested" : "Verify this draw"}
          </button>
        </section>
      )}
    </div>
  );
}
