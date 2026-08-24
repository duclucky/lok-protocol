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
      <nav className="section-links" aria-label="Encryption page sections">
        <a href="#fhe-boundary">FHEVM boundary</a>
        <a href="#disclosure-table">Disclosure table</a>
        <a href="#guarantees">Guarantees</a>
      </nav>
      <section id="fhe-boundary" className="fhe-boundary" aria-labelledby="fhe-boundary-title">
        <div>
          <p className="section-label">FHEVM boundary</p>
          <h2 id="fhe-boundary-title">Encrypted computation, not an invisible blockchain</h2>
        </div>
        <div className="fhe-boundary__facts">
          <p>Encrypted values are computed on without revealing their clear values to the public.</p>
          <p>
            Participant addresses and membership are public; individual balances, risk settings, and credits are not.
          </p>
          <p>A shield transaction amount is public. A later Lok deposit uses encrypted cUSDC input.</p>
          <p>Infrastructure still observes public transaction metadata, contract calls, and protocol logs.</p>
          <p>The external verifier is separate from this interface; this app does not simulate a verifier response.</p>
        </div>
      </section>
      <section id="disclosure-table" className="privacy-ledger" aria-labelledby="privacy-ledger-title">
        <div className="privacy-ledger__title">
          <ShieldCheck aria-hidden="true" size={26} />
          <div>
            <p className="section-label">Disclosure boundary</p>
            <h2 id="privacy-ledger-title">What the network can learn</h2>
          </div>
        </div>
        <table className="privacy-table">
          <caption>Public and sealed data</caption>
          <thead>
            <tr>
              <th scope="col">Public</th>
              <th scope="col">Sealed</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Prize amount</td>
              <td>Your balance</td>
            </tr>
            <tr>
              <td>Participant membership and addresses</td>
              <td>Your risk setting</td>
            </tr>
            <tr>
              <td>Shield transaction amount and timing</td>
              <td>Later private deposit amount</td>
            </tr>
            <tr>
              <td>Aggregate ticket space</td>
              <td>Your draw weight</td>
            </tr>
            <tr>
              <td>Settlement random value</td>
              <td>Your prize credit</td>
            </tr>
            <tr>
              <td>Solvency checkpoint boolean</td>
              <td>Numeric liabilities and assets</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section id="guarantees" className="guarantee-list" aria-label="Encryption guarantees">
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
