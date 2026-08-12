# 03 — FHEVM Knowledge Base

Read this before writing any Solidity that touches an encrypted value. It is the mental model, the patterns, and the
specific mistakes that cost days.

Anything in this document marked **[VERIFY]** must be confirmed against live documentation and recorded in
`docs/API-VERIFIED.md` before you rely on it. The FHEVM API has had breaking changes in most releases; treat memory of
it as a hypothesis.

---

## 1. Mental model: what actually happens

The host chain does not perform fully homomorphic encryption. When your contract calls `FHE.add(a, b)`:

1. The `FHEVMExecutor` contract on the host chain **does no cryptography**. It returns a 32-byte **handle** — a pointer
   — and emits an event.
2. Off-chain **coprocessors** observe the event, perform the real FHE computation, store the resulting ciphertext, and
   commit the result to the Gateway, which runs majority consensus across independent operators.
3. The **ACL** contract on the host chain records which addresses may decrypt which handle.
4. Decryption is a request to the Gateway, which orchestrates a **threshold MPC** key-management service. No single
   party holds the decryption key.

Five consequences that shape everything you write:

- **Encrypted values are pointers, not data.** Chaining operations is cheap because nothing waits for a result. You only
  ever wait when a value must be _decrypted_.
- **Because operations are symbolic, they are metered.** Cost is charged in Homomorphic Complexity Units (HCU) so that
  off-chain resources cannot be exhausted. See `docs/04-hcu-budget.md`.
- **Decryption is asynchronous, slow, rate-limited and failure-prone**, especially on shared testnet infrastructure.
  Never place a decryption on a critical path.
- **Access control is programmable and public.** Your contract decides who may decrypt what. Those grants are on-chain
  events — see forbidden pattern F6.
- **An uninitialised handle is not an error.** Reading an unset `euint64` yields a handle behaving as encrypted zero.
  This is convenient and also a source of silent bugs; initialise deliberately.

---

## 2. Forbidden patterns

These are not style preferences. Each one either fails to compile, reverts at runtime, silently produces wrong results,
or leaks private data.

### F1 — Branching on an encrypted value

```solidity
if (FHE.gt(balance, amount)) { ... }        // does not compile
require(FHE.gt(balance, amount), "...");    // does not compile
```

An encrypted comparison yields `ebool`, a handle. There is no way to read it in the EVM without decrypting, and
decrypting would leak the very fact you are protecting.

**Use `FHE.select` — compute both branches and choose homomorphically:**

```solidity
ebool ok = FHE.le(amount, balance);
euint64 toMove = FHE.select(ok, amount, FHE.asEuint64(0));
balance = FHE.sub(balance, toMove);
```

**The consequence you must design around:** failure becomes _silent_. A transfer with insufficient balance does not
revert, it moves zero. The user sees a successful transaction and nothing happens. Every such operation must return or
store an **encrypted status code** that the client decrypts and surfaces in the UI. See `docs/06-frontend-spec.md` §5. A
submission with silent failures has broken UX regardless of how correct the cryptography is.

### F2 — Dividing or taking a remainder by an encrypted value

The HCU tables list `div` and `rem` with a scalar column only; the non-scalar column is empty. **The divisor must be
plaintext.** There is no encrypted division.

Consequences: `r mod encryptedTotal` is impossible. A pro-rata share `encryptedBalance / encryptedTotal` is impossible.

**Workarounds, in order of preference:**

1. Publicly decrypt an explicitly allowlisted _aggregate_ denominator, then divide by plaintext. Do not assume every
   pool total is public: numeric principal/liability/assets remain encrypted in Lok. Never extend the exception to a
   per-user numerator or transaction delta.
2. Choose denominators that are powers of two so division becomes `FHE.shr`, which is cheap and exact. Design your
   constants for this — it is why `THETA_DENOM = 4`.
3. Derive a draw-scoped plaintext fixed-point rate from proof-verified aggregate handles (see `docs/02-architecture.md`
   §7), then multiply each encrypted numerator by that scalar. Never reuse a cumulative rate across changing weights.

### F3 — Unbounded loops over encrypted state

```solidity
for (uint i = 0; i < participants.length; i++) {
    total = FHE.add(total, weight[participants[i]]);   // reverts once the set grows
}
```

Two separate limits bite: the per-transaction HCU total, and the per-transaction _depth_ limit for chained operations. A
sequential accumulation of 64-bit encrypted values exhausts the depth budget at roughly 30 iterations.

**Paginate with a persisted cursor and an encrypted accumulator carried in storage.** The depth limit is
per-transaction, so pagination resets it. This is the architectural foundation of the draw.

### F4 — Assuming arithmetic reverts on overflow

It does not. FHE arithmetic wraps silently and returns a wrong, plausible-looking answer. There is no `SafeMath` for
ciphertext and no revert to catch.

**Every encrypted expression needs a written bound derivation** (pattern in `docs/02-architecture.md` §4) plus a
boundary test. Where a bound cannot be guaranteed, saturate deliberately with `FHE.min` and document the saturation as
product behaviour.

### F5 — Inline decryption in a request path

Decryption round-trips through the relayer and the threshold KMS. On shared testnet infrastructure it is slow,
rate-limited and intermittently fails. Placing it inside an event handler, a render path, or an indexer's hot loop
guarantees the demo stalls.

**Decrypt out of band**: a queue, a worker, a cache, explicit pending states in the UI. Treat "decrypt returned nothing"
as a normal condition worth a metric, not an exception.

### F6 — Granting decryption to a single address when the identity is the secret

`FHE.allow(handle, addr)` emits a public ACL event. If a value's _existence for a specific address_ is the secret, a
targeted grant publishes the secret. This is trap T1 in `docs/01-bounty-compliance.md` and the single most likely place
for a competing submission to leak the winner.

**Grant symmetrically to every participant on their own handle.** Uniform grants carry no information.

### F7 — Reaching for `randEuint` in a view function

Random generation mutates on-chain PRNG state and therefore cannot run under `eth_call`. It must occur inside a
transaction. Also note the bounded form requires the upper bound to be a **power of two**.

### F8 — Using Webpack for the frontend

The FHE WASM binary is a repeated source of Webpack bundling failures — silently degraded "demo mode", missing
encryption functions, wallet appearing connected with no real encrypted operations. Use Vite. This is defect avoidance,
not taste.

---

## 3. Types

| Type                  | Notes for this project                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `ebool`               | Result of every comparison. Only consumable via `FHE.select` or logical ops.                                |
| `euint8` … `euint256` | Unsigned. We use `euint8` (θ), `euint64` (balances, ticket weights, randomness), `euint128` (accumulators). |
| `eint8` … `eint256`   | Signed. Not needed here.                                                                                    |
| `eaddress`            | Encrypted address; equality and select only. Not needed here.                                               |
| `externalEuint64`     | The wire type for a client-supplied encrypted input. Converted with `FHE.fromExternal(value, proof)`.       |

Cost scales with bit width, so use the narrowest type your bound derivation permits. `FHE.asEuintX` between widths is
nearly free (order of 32 HCU) — casting down to `euint64` for a hot comparison loop is a real optimisation and it is why
the draw scales weights down before comparing.

ERC-7984 balances are `euint64`. That is the ceiling for any amount interoperating with confidential tokens.

---

## 4. Operations you will use

Grouped by what they cost you architecturally rather than alphabetically. Full HCU numbers are in
`docs/04-hcu-budget.md`.

**Cheap — use freely:** `and`, `or`, `xor`, `not`; scalar `shl`, `shr`, `rotl`, `rotr`; `cast`; `asEuintN` (trivial
encryption of a plaintext); `select`.

**Moderate — budget for them:** `add`, `sub`; comparisons `eq`, `ne`, `lt`, `le`, `gt`, `ge`; `min`, `max`;
`randEuintN`.

**Expensive — restructure to avoid, or push into the user's own transaction:** `mul` non-scalar, `div` (scalar only),
`rem` (scalar only), `neg`.

**Scalar versus non-scalar is the main lever you control.** An operation with one plaintext operand is markedly cheaper
than one with two ciphertext operands — for a 64-bit multiplication the difference is roughly 365,000 against 596,000
HCU, and on 128-bit values it is far larger. Whenever a factor can be made public without leaking anything, make it
public. Elapsed time is the canonical example.

**Version-gated operations. [VERIFY]** `FHE.sum` (sums a list of encrypted values in one operation) and `FHE.isIn` (set
membership) were introduced in FHEVM v0.13. They exist on testnet and **not** on Ethereum mainnet, which was on v0.11.
Both are attractive for the prefix sum. Wrap any use behind an internal function with a documented loop fallback so a
future mainnet deployment is a configuration change rather than a rewrite.

---

## 5. Access control

```solidity
FHE.allowThis(handle);            // this contract may operate on it in later transactions
FHE.allow(handle, addr);          // addr may request decryption
```

Rules for this codebase:

- Call `FHE.allowThis` on every handle you persist in storage. Omitting it means the value is unusable in a later
  transaction — a common and confusing failure.
- Call `FHE.allow(handle, owner)` for every value the owner is entitled to read: their balance, their θ, their per-draw
  credit.
- **Never** grant a non-owner rights to a per-user value, except through the explicit delegated decryption feature if
  optional item (a) is built.
- Grant patterns must be **uniform across users**. Asymmetric grants leak (F6).

A dedicated public-decryption path is required to make an _aggregate_ readable by everyone. This is a distinct mechanism
from `FHE.allow`, and the API for it changed in v0.9 when `FHE.requestDecryption` was deprecated in favour of a
relayer-mediated flow. **[VERIFY]** Read the public decryption documentation page, record the exact call sequence and
any on-chain proof-verification helper in `docs/API-VERIFIED.md`, and implement against that record. Do not guess this
API — it is the one place in the design where a wrong assumption invalidates the whole draw pipeline.

---

## 6. Canonical patterns for this project

### Accepting an encrypted input

```solidity
function deposit(externalEuint64 encAmount, bytes calldata inputProof) external {
  _syncUser(msg.sender);
  euint64 amount = FHE.fromExternal(encAmount, inputProof);
  // ... clamp, credit, allow ...
}
```

The client encrypts and produces a zero-knowledge proof of correct encryption; the protocol charges a fee for verifying
that proof. This is why input verification is a real cost centre and why you should avoid designs that need many
separate encrypted inputs per user action.

### Clamped transfer — the standard confidential-token idiom

```solidity
ebool enough   = FHE.le(amount, balance[from]);
euint64 moved  = FHE.select(enough, amount, FHE.asEuint64(0));
balance[from]  = FHE.sub(balance[from], moved);
balance[to]    = FHE.add(balance[to],   moved);
// surface `enough` to the caller as an encrypted status; do not let it fail silently
```

### Saturating a value to keep a bound provable

```solidity
euint128 raw = FHE.mul(FHE.asEuint128(balance[u]), FHE.asEuint128(theta[u]));
rate[u] = FHE.min(raw, FHE.asEuint128(RATE_CAP));   // deliberate, documented saturation
```

### Scaling down before a hot comparison loop

```solidity
euint64 w64 = FHE.asEuint64(FHE.shr(w128, TICKET_SCALE_BITS));
```

### Paginated accumulation with a persisted encrypted cursor

```solidity
function crankA(uint256 batch) external {
  uint256 i = draw.cursor;
  uint256 end = Math.min(i + batch, participants.length);
  require(batch <= BATCH_A_MAX, "batch too large");
  euint64 running = draw.cumRunning; // load once
  for (; i < end; ++i) {
    /* ... running = FHE.add(running, w64) ... */
  }
  draw.cumRunning = running; // store once
  draw.cursor = i;
}
```

Load and store the accumulator once per transaction rather than per iteration. Cap `batch` by a constant so a caller
cannot force a revert by requesting an oversized batch — and expose the cap so the keeper can read it.

---

## 7. Known developer friction

Budget time for these; they are reported repeatedly by developers on this stack.

| Symptom                                                                                                 | Cause and remedy                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "execution reverted for an unknown reason", no decodable error, on any call touching `FHE.fromExternal` | Usually a mismatch between the contract's configured chain/protocol addresses and the SDK instance, or a stale input proof. Verify the config contract, the relayer URL and the SDK version agree. Reproduce in mock mode first to isolate contract logic from infrastructure. |
| SDK reports connected but no encryption occurs                                                          | WASM not bundled. Use Vite; confirm the WASM asset is emitted in the build output.                                                                                                                                                                                             |
| Encrypted value unusable in a later transaction                                                         | Missing `FHE.allowThis` when the handle was stored.                                                                                                                                                                                                                            |
| Decryption returns nothing, intermittently                                                              | Shared testnet relayer under load. Retry with backoff out of band; never inline.                                                                                                                                                                                               |
| A transaction that worked yesterday reverts today                                                       | Protocol version rolled forward. Check the protocol changelog and status page before debugging your own code.                                                                                                                                                                  |

---

## 8. Sources to consult, in priority order

1. `docs/API-VERIFIED.md` in this repository — the project's own confirmed record. Check here first.
2. The official Zama agent skills repository (`zama-ai/skills`) — purpose-built, current agent context.
3. Live protocol documentation: the Solidity guides, the HCU page, the random-number page, the public decryption page,
   the SDK reference, and the protocol changelog for version status.
4. `@openzeppelin/confidential-contracts` source — the authoritative reference for ERC-7984 and the ERC-20 wrapper.
5. The community forum — useful for error messages, and often the only place a specific revert is explained.

Your own recollection of this API is **not** on this list. Use it to form hypotheses, then verify.
