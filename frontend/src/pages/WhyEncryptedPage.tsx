import { Blocks, EyeOff, Scale, ShieldCheck } from "lucide-react";

import { PageHeader } from "../components/PageHeader";

const guarantees = [
  {
    Icon: EyeOff,
    title: "Your position stays sealed",
    body: "Balance, risk setting, individual weight, Fortune, and prize credit are never made publicly decryptable.",
  },
  {
    Icon: Scale,
    title: "The pool stays accountable",
    body: "Checkpoint booleans and completed draw aggregates provide the public facts needed to verify solvency and conservation.",
  },
  {
    Icon: Blocks,
    title: "Draws stay reproducible",
    body: "Fixed snapshots, bounded batches, committed entropy, and public settlement values let anyone replay the deterministic checks.",
  },
] as const;

export function WhyEncryptedPage() {
  return (
    <div className="page page--why">
      <PageHeader title="Why encrypted?" description="Public integrity without publishing private savings behavior." />
      <section className="privacy-ledger" aria-labelledby="privacy-ledger-title">
        <div className="privacy-ledger__title">
          <ShieldCheck aria-hidden="true" size={26} />
          <div>
            <p className="section-label">Disclosure boundary</p>
            <h2 id="privacy-ledger-title">What the network can learn</h2>
          </div>
        </div>
        <div className="privacy-table" role="table" aria-label="Data disclosure boundary">
          <div role="row">
            <span role="columnheader">Public</span>
            <span role="columnheader">Sealed</span>
          </div>
          <div role="row">
            <span role="cell">Prize amount</span>
            <span role="cell">Your balance</span>
          </div>
          <div role="row">
            <span role="cell">Participant count</span>
            <span role="cell">Your risk setting</span>
          </div>
          <div role="row">
            <span role="cell">Aggregate ticket space</span>
            <span role="cell">Your draw weight</span>
          </div>
          <div role="row">
            <span role="cell">Settlement random value</span>
            <span role="cell">Your prize credit</span>
          </div>
          <div role="row">
            <span role="cell">Solvency checkpoint boolean</span>
            <span role="cell">Numeric liabilities and assets</span>
          </div>
        </div>
      </section>
      <section className="guarantee-list" aria-label="Encryption guarantees">
        {guarantees.map(({ Icon, title, body }) => (
          <article key={title}>
            <Icon aria-hidden="true" size={22} />
            <div>
              <h2>{title}</h2>
              <p>{body}</p>
            </div>
          </article>
        ))}
      </section>
      <section className="fortune-note">
        <strong>Fortune remains bounded.</strong>
        <p>
          The public effective and base totals can reveal bounded pool-level movement, never an individual history or
          leaderboard.
        </p>
      </section>
    </div>
  );
}
