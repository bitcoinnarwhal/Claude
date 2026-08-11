# A Bitcoin-Native, Self-Balancing Synthetic Dollar

**Design document — architecture, trust boundaries, unsolved problems, build plan**

Status: design/research document. Nothing in here is production-ready. Sections are
explicitly labeled **[SHIPPED]** (exists today in usable form), **[ENGINEERING]**
(no new science, but real spec/implementation work), or **[RESEARCH]** (unsolved;
do not deploy against real funds).

---

## 0. Executive summary

The instrument: hold spot BTC, and against that same stack, enter a
fully-collateralized inverse contract (a Discreet Log Contract) whose payout curve
delivers `V/P` BTC at settlement price `P`, for a target dollar value `V`. The spot
long and the DLC short cancel BTC volatility; what remains is a synthetic dollar
whose custody never leaves Bitcoin script.

Three honest framings up front, because the rest of the design depends on them:

1. **The hedge is self-correcting *by construction*, not by activity.** A DLC with a
   continuous inverse payout curve is already "continuously rebalanced" at
   settlement: whatever the price does between contract open and maturity, the
   settlement transaction pays out the right amount. The streaming layer is **not**
   what keeps you hedged tick-to-tick — the pre-signed contract does that. Streaming
   exists to (a) roll the contract forward before maturity, (b) re-center the covered
   price range and realize P&L before it drifts near a collateral boundary, (c) give
   instant, machine-detectable liveness signals, and (d) carry funding payments.
   Getting this distinction right removes most of the imagined "kHz settlement"
   problem — and § 4.4 restructures the update stream into tiers accordingly.

2. **"One stack does double duty" is true for the holder, not for the system.**
   The holder's spot stack fully collateralizes the *upside* leg (as price rises,
   the holder surrenders appreciation from the stack, bounded by the stack itself —
   liquidation-proof). But the *downside* leg (as price falls, the holder must
   receive extra BTC to keep dollar value constant) is paid from collateral the
   counterparty posts. Someone's BTC always collateralizes the downside; the DLC
   just makes that trustless and pre-signed. The consequence is a **hard stability
   floor** (§ 1.2): the synthetic dollar is exactly stable only down to
   `P_floor = V / (B + C)` where `C` is counterparty collateral. Below the floor it
   degrades to long BTC. This must be disclosed to holders as a first-class
   property, not buried.

3. **Reflexivity is a system-level, not contract-level, risk.** Inside one contract,
   full collateralization kills liquidation risk. The reflexive danger migrates to
   the *continuity layer*: counterparty collateral is BTC, so the standby liquidity
   you need to replace a dropped short is scarcest exactly when BTC is crashing and
   every provider is impaired at once. § 6 designs for that correlation instead of
   assuming independent counterparties.

---

## 1. The instrument, precisely

### 1.1 Payout math

Holder owns `B` BTC at entry price `P₀`; target stable value `V = B·P₀` (or any
`V ≤ B·P₀`). At settlement price `P`, the holder should hold `V/P` BTC.

DLC payout to holder, as a function of attested price `P`:

```
payout(P) = V/P − B          (BTC; positive when P < P₀, negative when P > P₀)
```

- **P rises:** holder pays `B − V/P` from the stack. Bounded above by `B` as
  `P → ∞`. The stack itself is the collateral → the holder can never be margin
  called. This is the "double duty" leg.
- **P falls:** holder receives `V/P − B`, which grows **without bound** as `P → 0`
  (this is the reflexivity in one line: the dollar-short's BTC-denominated payout is
  convex in falling prices). It is capped by counterparty collateral `C`.

This inverse (hyperbolic) payout curve is directly expressible in the DLC spec's
numeric payout-curve machinery — the dlcspecs payout-function format includes
hyperbola pieces, added for precisely this stable-value use case. **[SHIPPED]**

### 1.2 The stability floor — the honest capital structure

Counterparty posts `C` BTC. The contract is exactly stable on
`P ∈ [P_floor, ∞)` with:

```
P_floor = V / (B + C)
```

Worked example: `B = 1 BTC`, `P₀ = $100k`, `V = $100k`, provider posts `C = 1 BTC`
→ `P_floor = $50k`. At $50k the holder owns 2 BTC = $100k exactly. Below $50k the
holder is long 2 BTC, unhedged. Doubling provider collateral moves the floor to
$33k; no finite `C` covers `P → 0`.

The counterparty's position, stated in both numéraires because both matter:

- **BTC-denominated:** the provider is short — they pay out sats as price falls.
- **USD-denominated:** the provider is a *leveraged long*. Their dollar delta is
  `(B + C)` BTC-equivalents on `C` of posted capital — with `C = B`, that is 2×
  long leverage, fully collateralized, liquidation-free down to the floor.

This is why "long-term holders happy to be partially short" is a real market: the
product being sold to the provider side is **liquidation-proof leverage**, which is
scarce and priced (perp funding historically pays for it). The funding flow between
the two legs is market-determined and can go either direction: in high-funding bull
regimes the stability seeker may *earn* carry (this is the Stablesats/Ethena
observation); in bear regimes they pay. The "cost of the dollar" is this funding
spread plus the provider's capital charge — do not promise holders it is always
near zero.

### 1.3 What the streaming layer actually has to prevent

Between contract open and the next roll, the holder is hedged by pre-signed CETs.
The residual risks the streaming/rolling machinery must manage:

| Gap | Cause | Mitigation (section) |
|---|---|---|
| Price exits covered range | Fast move toward `P_floor` (or the upper truncation) | Roll early and re-center range; top up `C` from standby market (§ 4, § 6) |
| Contract matures unhedged | Counterparty offline at roll time | Maturity laddering + replacement market (§ 6) |
| Stale-state broadcast | Counterparty posts revoked channel state | Penalty + high-frequency watchtower (§ 5) |
| Settlement tx stuck | Fee spike at crash time (correlated!) | Anchors/package relay on CETs (§ 2.4) |
| Oracle lies/equivocates | Manipulation, coercion | Threshold + medianized + bonded oracles (§ 3) |

---

## 2. Architecture

### 2.1 Component diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│  L6  NATIVE RATE / TERM STRUCTURE                              [RESEARCH]  │
│      BTC yield curve from lease auctions + DLC funding prints              │
│      (Lightning Pool-style auctions; attested reference-rate index)        │
├────────────────────────────────────────────────────────────────────────────┤
│  L5  CONTINUITY & LIQUIDITY MARKET                          [ENGINEERING]  │
│      N-counterparty hedge portfolio · maturity ladder · standby RFQ        │
│      market (Nostr transport) · drop detection = stream silence            │
├────────────────────────────────────────────────────────────────────────────┤
│  L4  STREAMING REBALANCE PROTOCOL                    [ENGINEERING/RESEARCH]│
│      price-carrying packets (custom LN peer msgs / TLV) · tiered update    │
│      cadence · auto-roll state machine · keysend funding flow              │
│      cryptographic price-payment fusion via PTLC          [RESEARCH]       │
├────────────────────────────────────────────────────────────────────────────┤
│  L3  DLC CHANNELS (off-chain renewable DLCs)         [ENGINEERING, forked] │
│      rust-dlc channel machine + patched rust-lightning (ex-10101           │
│      "ln-dlc-node" lineage; no maintained upstream today)                  │
├──────────────────────────────┬─────────────────────────────────────────────┤
│  L2a LIGHTNING               │  L2b DLC ENGINE                  [SHIPPED]  │
│      LDK or CLN · penalty    │  dlcspecs v0 · rust-dlc / bitcoin-s ·       │
│      machinery · watchtowers │  adaptor sigs · numeric decomposition ·     │
│      (rust-teos, LND tower)  │  hyperbola payout curves · multi-oracle     │
│      [SHIPPED, stressed by   │                                             │
│       our update rate — § 5] │                                             │
├──────────────────────────────┴─────────────────────────────────────────────┤
│  L1.5 ORACLE LAYER                                   [ENGINEERING/RESEARCH]│
│      threshold attestation (contract-level m-of-n: SHIPPED in spec/libs;   │
│      FROST single-point m-of-n: RESEARCH-grade in secp256k1 production) ·  │
│      bonded oracles w/ equivocation ⇒ key-leak ⇒ bond-sweep ·              │
│      deterministic-signature reuse (adoption problem, not crypto problem)  │
├────────────────────────────────────────────────────────────────────────────┤
│  L1  BITCOIN                                                    [SHIPPED]  │
│      Taproot (BIP341/342) · Schnorr (BIP340) · MuSig2 (BIP327) ·           │
│      adaptor signatures (libsecp256k1-zkp) · v3/TRUC + 1p1c package        │
│      relay (Core 28+) for fee-bumping pre-signed settlement txs            │
└────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Concrete library / standard mapping

| Component | Concrete choice | Status & caveats |
|---|---|---|
| Contract format & negotiation | [dlcspecs](https://github.com/discreetlogcontracts/dlcspecs) (v0 messaging, contract descriptors, numeric decomposition, multi-oracle) | Spec is stable but v0; ecosystem small |
| DLC engine | [rust-dlc](https://github.com/p2pderivatives/rust-dlc) (`dlc`, `dlc-manager`, `dlc-messages`, `dlc-trie`); alternative: [bitcoin-s](https://github.com/bitcoin-s/bitcoin-s) (Scala, full DLC wallet + oracle server) | rust-dlc maintenance is thin post-10101; audit before real funds. [dlcdevkit](https://github.com/bennyhodl/dlcdevkit) is the most active downstream (rust-dlc + BDK + Nostr transport) |
| Adaptor signatures | libsecp256k1-zkp (ECDSA adaptor module, used by rust-dlc); Schnorr adaptors for Taproot-native DLCs | ECDSA adaptor path is what's shipped; Schnorr-adaptor DLCs reduce on-chain footprint but are less deployed |
| Lightning node | LDK (rust) — best surface for custom channel logic & custom peer messages (`CustomMessageHandler`); CLN viable via `sendcustommsg` + plugins (this is Stable Channels' route) | LND is least suitable: no custom channel machinery |
| DLC-in-channel | rust-dlc "channels" (split-transaction construction: channel funding output → split tx → [buffer tx → DLC] + LN balance), the ex-10101 `ln-dlc-node` lineage | **[ENGINEERING, forked]**: requires a patched rust-lightning; 10101's fork is unmaintained since Oct 2024. Budget for owning this fork — it is the single largest engineering liability in the stack |
| Watchtower | [rust-teos](https://github.com/talaia-labs/rust-teos) (Eye of Satoshi), LND altruist tower as references; our high-frequency design in § 5 | Existing towers do **not** survive our update rate unmodified |
| Oracle attestation | dlcspecs oracle announcements/attestations (per-digit nonces, base-2); multi-oracle contracts with threshold + bounded-error (in spec and rust-dlc) | No public production oracle network exists today (Suredbits gone); running/recruiting oracles is on us — § 3 |
| Threshold signing | Contract-level m-of-n: dlcspecs **[SHIPPED]**. Single-point FROST m-of-n: RFC 9591; `frost-secp256k1` (ZF crates); secp256k1-zkp FROST module still WIP | FROST on secp256k1 in production against funds: **[RESEARCH]**-adjacent; contract-level m-of-n is the deployable path |
| Streaming price packets | LN custom peer messages (odd types ≥ 32768, bLIP conventions); keysend (bLIP-3) with custom TLV for funding flow | **[ENGINEERING]** — protocol defined in § 4 |
| Price↔payment cryptographic atomicity | PTLC with adaptor point = oracle attestation point | **[RESEARCH]** — PTLCs unspecced/undeployed on mainnet LN; requires taproot channels (still experimental in LND; absent elsewhere) — § 4.5 |
| Fee-bumping pre-signed settlements | CPFP anchors on buffer/CET txs; TRUC (v3) + ephemeral anchors + 1p1c package relay (Bitcoin Core 28+) | dlcspecs v0 CETs use fixed feerates — **must** be extended with anchors before real funds (§ 2.4) |
| Yield curve venue | Lightning Pool-style lease auctions (shadow venue initially) | Pool itself is thin/moribund; treat as design template, not dependency — § 7 |
| State-collapse upgrade path | LN-Symmetry/eltoo via BIP118 (APO) or CTV+CSFS | **[RESEARCH/political]** — not activated; solves § 5 outright if it ever lands |

### 2.3 Why DLC-in-channel rather than on-chain DLCs

On-chain DLCs (plain funding tx + CETs) work today with mature-ish tooling, but
every roll is an on-chain event → rolling at any useful cadence is fee-prohibitive
and privacy-leaking. Putting the DLC inside a channel (rust-dlc's split-tx
construction) makes rolls off-chain: renew = build new CET set + adaptor-sign +
revoke old split state (penalty applies to stale splits). On-chain is reserved for
open, close, and disputes. This is the only construction consistent with
"continuous, streamed rebalancing," and it is also the least-maintained part of the
ecosystem — hence its **[ENGINEERING, forked]** flag everywhere it appears.

### 2.4 Settlement-under-congestion (do not skip this)

The moment you most need unilateral settlement — counterparty vanished during a
crash — is the moment mempools are fullest, because liquidations everywhere are
correlated. dlcspecs v0 pre-signs CETs at a fixed feerate chosen at contract time.
A naive implementation is therefore **unsafe with real money**: your enforcement
path can be priced out exactly when it matters. Required mitigations:

- Anchor outputs (or TRUC/ephemeral anchors) on buffer txs and CETs so either party
  can CPFP at broadcast time; rely on 1p1c package relay (Core 28+).
- Timeout margins sized for multi-block congestion (CSV delays, refund locktimes).
- A fee-reserve UTXO policy per party, held outside the channel, earmarked for
  justice/CPFP.

---

## 3. Oracle layer — the linchpin, designed first

### 3.1 Mechanics (what DLCs actually consume)

An oracle pre-announces: event id, settlement time, and per-digit nonce points
`R_i` for a numeric outcome (base-2 decomposition, ~18–20 digits for a price with
adequate range/precision). At settlement it publishes Schnorr signatures over each
digit using those exact nonces. Parties pre-encrypt CET adaptor signatures against
the anticipated attestation points; the real attestation scalar decrypts only the
CET matching the actual price. Two structural properties fall out:

- **Oracles are blind & non-interactive.** They never see contracts, deposits, or
  parties. They cannot gate users, censor a specific contract, or steal directly.
  They can only lie about the price — publicly and attributably.
- **Equivocation is self-punishing.** Signing two different outcomes for one event
  reuses a nonce → leaks the oracle's private key (standard Schnorr nonce-reuse
  algebra). Anyone can then sweep any funds locked to that key. This converts
  "reputation" into an enforceable bond (§ 3.3).

### 3.2 Trust minimization stack (in deployment order)

1. **Contract-level m-of-n multi-oracle** **[SHIPPED]**: dlcspecs numeric contracts
   support k-of-n oracles with a bounded allowed deviation between attestations
   (the "bounded error" compromise handles oracles reporting from different venues
   at slightly different times). This is implemented in rust-dlc/bitcoin-s today.
   CET-set size grows meaningfully with n — budget CPU accordingly (§ 4.3).
2. **Independent price *derivation*, not just independent signers**: each oracle
   must attest a **median over a time window** (e.g., 1-minute median of
   volume-weighted prices across ≥3 spot venues), never an instantaneous single
   print. A stream of medianized micro-attestations is the design's answer to "one
   catastrophic price print" — manipulation must now be sustained across venues
   and across time, against arb flow, to move the attested path. **[ENGINEERING]**
3. **Bonded oracles** **[ENGINEERING]**: oracle posts a bond to an output spendable
   by its attestation key. Equivocation ⇒ key leak ⇒ the bond is sweepable by
   anyone (first-seen race; or pre-commit a burn path). No new opcodes needed.
   Note the limit honestly: the bond punishes *equivocation* (two attestations),
   not *unilateral lying* (one wrong attestation). Lying is only punished by m-of-n
   dilution and reputation. That residual trust does not go to zero in this design.
4. **FROST single-point m-of-n** **[RESEARCH-adjacent]**: aggregate the committee
   into one attestation point (RFC 9591; `frost-secp256k1`). Benefits: constant-size
   attestations and CET sets independent of committee size; hides committee
   composition. Costs: DKG ceremony risk, nonce-coordination liveness, and secp256k1
   production maturity. Do this in phase 4, not phase 1.
5. **Deterministic-signature reuse** (the original Dryja vision — piggyback on
   signatures an entity already publishes for its own business, so there is no
   "oracle" to coerce): cryptographically trivial, **adoption-blocked**. It requires
   publishers to pre-announce nonces on a schedule, which no exchange or data
   vendor does today. Treat as a business-development target (get one exchange to
   add nonce pre-announcement to its signed ticker feed), not an architecture
   dependency. **[RESEARCH/adoption]**

### 3.3 High-frequency attestation surface

Streaming multiplies the oracle surface in three concrete ways; each has a
concrete answer:

- **Nonce logistics**: per-attestation pre-announced nonces. At 1 attestation/sec
  per committee member, that's ~86k announcements/day/oracle. Answer: Merkleized
  announcement batches (publish a signed Merkle root daily; reveal paths with each
  attestation) + deterministic event-id schedule (`BTCUSD-median60s-<unix-minute>`)
  so clients can verify against the root without per-event fetches. Nonce state on
  the oracle side must be written before signing (nonce reuse after a crash-restart
  is key-fatal — this is an HSM/persistence engineering requirement, flag it in
  every code review). **[ENGINEERING]**
- **Manipulation cadence**: more attestations = more chances to print a bad one,
  but *less value per print* — contracts referencing 60s-median micro-attestations
  and rolling continuously have bounded sensitivity to any single attestation
  (§ 4's tier structure caps per-tick value movement). The design goal stated
  precisely: **the value extractable by corrupting any single attestation must be
  less than the cost of corrupting the committee for that window.**
- **Consumer-side circuit breakers**: nodes refuse to auto-sign rolls on
  attestations implying a price move beyond a per-window bound (e.g., >X% in 60s
  vs. own independent price taps); fall back to "hold last enforceable state and
  alarm." Circuit breakers trade stability for safety during real crashes —
  document that tradeoff to holders; do not pretend it away.

---

## 4. Streaming rebalance protocol (L4)

### 4.1 Tiered cadence — resolving "thousands of updates/sec" honestly

A kHz stream of *penalty-secured state updates* is not buildable on today's
Lightning penalty machinery, and a kHz stream of *DLC renewals* is not buildable
on any adaptor-signature engine (numbers in § 4.3). But the design goal — "never
let a large imbalance accumulate" — does not require either. Tier the stream:

- **Tier 0 — price/heartbeat ticks** (10–1000+ Hz capable; no money moves).
  Custom LN peer messages carrying oracle micro-attestations + sequence + HMAC.
  Zero watchtower load, zero signatures beyond transport. Purpose: shared view of
  the attested price path, and *liveness*: silence for > `T_alarm` (seconds) ⇒
  counterparty presumed dropped ⇒ continuity machinery fires (§ 6). The "price
  signal and alarm signal are the same packet" property comes from this tier.
- **Tier 1 — mark-to-market checkpoints** (~0.02–1 Hz; money moves, penalty-secured).
  Cooperative channel-state update shifting realized P&L between LN balance and
  DLC margin, keeping the *unrealized* delta between checkpoints below a hard cap
  `ε` (e.g., 25 bps of `V`). `ε` is the maximum a cheating counterparty can steal
  by broadcasting the immediately-previous state — chosen so that even total
  watchtower failure for one interval is a bounded, priced loss, not a collapse.
- **Tier 2 — contract rolls** (minutes→hours, or event-triggered). Full DLC
  renewal: new maturity, re-centered price range, replenished collateral, new CET
  set + adaptor signatures, revocation of the old split state. Event-triggered
  early roll when price approaches range boundary or `C` utilization crosses a
  threshold.

Self-correction on each price update, as demanded, is then: Tier 0 updates the
shared state machine on every tick; the state machine *deterministically* forces
Tier 1/Tier 2 actions the moment drift bounds are hit. No human, no discrete
margin call, no accumulation beyond `ε` — but also no pretense that every tick is
a settlement.

### 4.2 Wire protocol sketch **[ENGINEERING]**

Transport: LN custom peer messages (odd types ≥ 32768 per BOLT 1 "it's ok to be
odd"; bLIP-style registration), via LDK `CustomMessageHandler` or CLN
`sendcustommsg`. Not HTLC onions — heartbeats shouldn't cost HTLC slots or imply
payments.

```
msg price_tick {
  channel_ref, seq (u64), oracle_event_id,
  attestation_digits[] | merkle_batch_ref,   // full micro-attestation or batch ref
  local_view_price (u64 msat-per-usd),       // sender's own tap, for divergence checks
  hmac                                        // keyed per-channel, anti-spoof
}
msg checkpoint_propose { channel_ref, seq, new_balances, price_tick_ref, sig }
msg checkpoint_ack     { channel_ref, seq, sig, revocation_for_prev }
msg roll_offer         { ...dlcspecs renew messages, referencing tick seq... }
```

Funding-flow payments ride ordinary keysend with a TLV pointing at the tick
sequence they cover — funding is *metered against the attested stream*, which is
the "payment carries the price update" mechanic in its deployable form. The tick
justifies the checkpoint; both parties' nodes verify the attestation and the
implied balance delta independently before signing. Atomicity here is
**software-enforced, not cryptographic**: each side is protected by *refusing to
sign* bad updates (self-interest), and by the penalty if the other side uses old
state. That is the honest description of what ships in phase 2.

### 4.3 Throughput reality (measured constraints to design against)

- A numeric DLC with hyperbola payout, sensible rounding, and 1 oracle needs on the
  order of **10²–10³ CETs**; each CET needs an adaptor signature from each side.
  Adaptor sign+verify on libsecp256k1 is ~50–150 µs each → a full roll costs
  roughly **100 ms–1 s of CPU per side** (plus trie construction and messaging
  RTTs). k-of-n multi-oracle multiplies CET count combinatorially (bounded-error
  compression helps but does not erase it). ⇒ Rolls are ~0.1–1 Hz *per channel*
  at best. This is why Tier 2 exists and why kHz "renewal" is a non-goal.
- LN cooperative updates (2 sigs + revocation bookkeeping): 10s–100s of Hz per
  channel in principle; our Tier 1 runs far below that, chosen by watchtower
  economics (§ 5), not by signing throughput.
- Tier 0 is bounded only by transport; kHz is trivially fine.

### 4.4 Where the residual gap risk lives

Between checkpoints, exposure drift ≤ `ε` by construction. Between rolls, the DLC
itself covers the price path — *except* near the boundaries of its covered range.
So the whole "timing gap during fast moves" problem compresses into one number:
**the probability that price crosses from the roll-trigger threshold to the
collateral boundary faster than a roll + top-up can complete** (seconds of
signing + RTTs + possibly a standby-market fill). Simulation phase (§ 8, Phase 0)
must estimate exactly this with jump models and historical worst windows
(e.g., March 2020, June 2022, Aug 2024 wicks), and it sets `C` sizing and
roll-trigger margins. Do not let anyone pick these constants by feel.

### 4.5 Cryptographic price↔payment fusion **[RESEARCH]**

The fully-fused version — where *claiming* the streamed payment is only possible
given the oracle's attestation — wants PTLCs: the payment's adaptor point set to
(a function of) the oracle attestation point, so redeeming reveals/requires the
attestation scalar. Status: PTLCs are not specced or deployed on mainnet LN;
they need taproot channels (experimental in LND only) and new gossip/onion
conventions. Related machinery (barrier escrows for atomic multi-party entry,
oracle-contingent payments) is discussed in DLC-over-Lightning literature
(Le Guilly et al.) but nothing is production-grade. Build the software-atomic
version (§ 4.2) now; keep the PTLC upgrade as a tracked research line. Any code
that pretends this fusion is cryptographic today would be lying to its users.

---

## 5. Hard liveness: penalty + watchtowers at high state churn

### 5.1 The problem, quantified

LN-penalty requires the defrauded party (or its tower) to punish **any** revoked
state. Existing towers (LND altruist tower, rust-teos) store one encrypted blob
(~0.3–1 KB) per revoked state, keyed by breach txid — by design the tower learns
nothing until a breach. At our Tier 1 rate this is untenable at scale: even 0.2 Hz
of checkpoints is ~17k states/day/channel (~6–17 MB/day/channel encrypted-blob
storage, forever-growing until channel close, times every channel in the
portfolio). At the naive "thousands per second" framing it's GB/day/channel —
dead on arrival. Two structural fixes, one deployable and one blocked:

### 5.2 Deployable: compact-state ("full-knowledge") towers **[ENGINEERING — needs spec work; this is the new component the design contributes]**

Key observation: LN revocation secrets are already compressible. Per-commitment
secrets come from a shachain — O(log n) stored elements derive *all* prior
secrets. The per-state blob model exists to preserve **privacy** (tower is blind),
not because the state is incompressible. For this system's dedicated,
high-frequency channels, trade privacy for compression:

- Tower is given: the channel's script templates, both revocation basepoints'
  public halves, the holder's revocation-basepoint secret share, the shachain
  receive-chain (updated with O(1) data per checkpoint, O(log n) total storage),
  and a **fixed sweep address = holder's cold key**.
- On seeing any commitment/split tx on-chain, the tower derives that state's
  revocation key from the shachain, constructs the justice tx itself, signs, and
  sweeps to the holder's cold address. Constant-ish storage per channel; per-update
  cost is one hash-chain element, not a stored blob.
- Trust delta vs. blind towers: this tower learns channel existence, balances, and
  update timing (privacy loss), and holds enough to *react* — but it cannot steal
  (sweep path is fixed to the holder's cold key) and cannot forge states (it never
  holds funding keys). Bond/insure towers anyway (Pisa/Cerberus-style bonded
  accountability) because a lazy tower is still a loss.
- Keep channels **HTLC-free at checkpoint boundaries** (quiesce in-flight HTLCs
  before each Tier 1 checkpoint): justice txs stay single-template; the
  second-stage-HTLC justice mess — the expensive part of general-purpose towers —
  is designed out rather than solved.

This needs a written spec, adversarial review, and a reference implementation
(natural home: extend rust-teos). No new cryptography — but nobody has shipped it,
so treat every line as unaudited until it is.

### 5.3 Blocked-on-softfork: eltoo/LN-Symmetry **[RESEARCH/political]**

APO (BIP118) or CTV+CSFS would collapse penalty state to "latest state only":
towers store O(1) per channel with zero privacy trade, and the entire § 5.2
apparatus shrinks to a rebroadcaster. Track covenant-softfork progress; design
L3/L4 messages so the state machine can migrate. Do not schedule anything against
its activation.

### 5.4 Soft liveness

Both parties (or their delegates) must run always-on nodes for the stream itself.
This is a real centralization pressure — holders will delegate to "streaming
agents" (an LSP-shaped role), re-introducing an availability intermediary. Contain
it: the delegate holds session keys that can sign Tier 0/Tier 1 messages within
pre-authorized drift bounds (`ε`-bounded delegation) but **cannot** sign Tier 2
rolls or move funds beyond `ε`. Worst-case damage from a rogue delegate = one
checkpoint interval's drift + downtime; funds custody never leaves the holder.
The stream's per-tick sequence numbers + HMAC give the "silence = alarm" property
for free: any gap ≥ `T_alarm` is an unambiguous, machine-readable drop signal —
no probing, no interpretation.

---

## 6. Counterparty continuity (safety ≠ staying hedged)

Penalties make counterparty failure *safe* (you keep enforceable state) but not
*neutral* (your short leg is gone; you are long BTC again — the thing the holder
explicitly did not want). Continuity design:

1. **Portfolio construction**: target value `V` split across `N ≥ 10`
   counterparties (independent operators, jurisdictions, infra), each leg
   independently rolled on a **staggered maturity ladder** — at any moment, most
   legs have hours→days of enforceable hedge remaining. One drop = `V/N` exposure
   with a laddered runway, not a cliff. (Cost: N× channel collateral
   fragmentation, N× streams, N× watchtower state, and N× more frequent *some-leg*
   events — the ops burden scales linearly and must be automated from day one.)
2. **Standby market**: a persistent RFQ book for hedge legs — "seeking short leg,
   `V/N` notional, range `[P_a, P_b]`, maturity `T`, funding bid `f`" — with
   pre-negotiated *dormant* channels to standby providers (channel open is the
   slow, on-chain step; keep it pre-paid and idle so replacement = contract
   negotiation only, seconds not blocks). Transport: Nostr events (open, spam-
   resistant-enough with PoW/paid relays, no venue operator) — consistent with
   "the venue is the protocol." dlcdevkit's Nostr DLC transport is a usable
   starting point. **[ENGINEERING]**
3. **Detection → replacement state machine**: Tier 0 silence ≥ `T_alarm` ⇒ mark
   leg suspect; ≥ `T_drop` ⇒ broadcast RFQ to standbys; fill ⇒ new leg live,
   suspect leg allowed to expire at maturity (or cooperatively closed if it
   returns). Every threshold machine-checked, no human in the loop for the happy
   path.
4. **Graceful degradation ladder** (no fill available), in order:
   a. run remaining maturity of the enforceable contract (hedged, clock ticking);
   b. re-tranche: reduce stabilized target `V` and re-spread over surviving legs
      (partial stability honestly accounted, holder notified);
   c. last resort, holder-preconfigured policy: accept unhedged BTC exposure
      (conviction-holder default) — or exit to on-chain sale / external venue,
      which leaves the Bitcoin-native envelope and is therefore strictly opt-in.
5. **The reflexive catch, stated plainly**: standby liquidity is BTC-collateralized
   leveraged-long capacity, which evaporates in the exact crash scenarios where
   drops cluster. Diversification across *operators* does not diversify the
   *asset* all their collateral is denominated in. Partial mitigations — funding
   rates that spike to attract capital in stress (price it, don't ration it),
   deliberately over-provisioned dormant standby collateral (paid for via a
   standing option-premium-like fee), conservative `C` sizing from Phase 0 stress
   sims — reduce but do not eliminate this. **Systemic-crash continuity is a
   residual risk of the whole design and must be disclosed as such.** Any
   documentation that claims otherwise is marketing, not engineering.

---

## 7. Native yield / term structure (L6, stretch) **[RESEARCH]**

Mechanism: standardized-duration markets in BTC-denominated capital commitments —
channel-liquidity leases (Lightning Pool's LCV model) *and* our own hedge-leg
funding at standardized maturities (§ 9, piece b) — produce market-clearing rates
at multiple tenors ⇒ a BTC-native yield curve ⇒ a base rate.

Honesty first: Lightning Pool exists and pioneered exactly this shape
(sealed-bid, batched lease auctions), but its volumes are thin and the "curve" it
implies today is noise. The realistic path is that **this system's own funding
market becomes the rate source**: hedge-leg funding is genuine, sustained economic
demand (stability seekers) meeting genuine supply (leverage seekers), at
standardized tenors, with every print observable in DLC contract terms. Publish a
reference index (median funding across legs per tenor per epoch) as an
oracle-attested feed — making the rate itself referenceable by other DLCs
(floating↔fixed funding swaps, FRA-analogues) — and the curve bootstraps from real
flow rather than from a venue we don't control. Circularity and manipulation of
the index are first-class risks: see § 9(d)/(e).

---

## 8. Trust-assumptions table

"Trustless" below always still assumes: Bitcoin consensus validity, secp256k1/
Schnorr hardness, and censorship-resistant tx inclusion within timelock windows at
feasible feerates (see § 2.4 — fee-market inclusion is an *economic* assumption,
and it is correlated with exactly our stress scenarios).

| Layer | Trustless (enforced by construction) | Must be trusted (and by whom) |
|---|---|---|
| L1 Bitcoin | Settlement finality, script enforcement, timelocks | Fee-market inclusion during correlated stress; no deep reorgs |
| L2b DLC engine | Payout correctness *given honest attestation*: only the attested-outcome CET is redeemable; full collateralization ⇒ no liquidation, no margin call, counterparty cannot pay less than the curve says | Software correctness of rust-dlc/CET-trie code (unaudited for this use); both parties' key management |
| Oracle (m-of-n, bonded, medianized) | Non-custody (oracles never touch funds); blindness (can't censor specific contracts); equivocation ⇒ key leak ⇒ bond loss, permissionlessly enforced | **≥ m oracles not colluding to sign one false price** — the irreducible core trust of the whole system. Bond only punishes equivocation, not coordinated unilateral lying. Oracle infra security (nonce persistence!), and honest median methodology per oracle |
| L2a LN penalty | Cheating with revoked state is punishable (attributable, collateral-backed) | Punishment requires *someone watching* within the CSV window: your node or tower liveness; tower honesty is bounded (§ 5.2 tower can't steal — sweep path fixed — but a lazy tower = unpunished breach ⇒ bond/insure towers); loss between last checkpoint and breach ≤ `ε` by construction |
| L3 DLC channel | Off-chain roll integrity: old split states revocable + punishable; unilateral settlement always available from last confirmed state | Forked ln-dlc-node/rust-lightning code correctness — the thinnest-maintained code in the stack; **treat as the top software risk** |
| L4 streaming | Nothing cryptographic beyond L2/L3 — refusal-to-sign protects each side; penalty covers stale state; HMAC'd sequenced ticks make silence/tampering evident | Both nodes' (or `ε`-bounded delegates') availability; own price taps for circuit breakers; delegate compromise costs ≤ `ε` + downtime by construction |
| L5 continuity | Each leg's settlement (as L2b); drop detection (silence is unforgeable-ly evident); no venue can custody or gate (RFQ is transport, not counterparty) | **Market depth is not a protocol guarantee**: standby fills in stress are economic hope backed by incentives, not enforcement; Nostr relay set for RFQ transport (mitigate: many relays + direct connections) |
| L6 rate | Index computation reproducible from published contract prints | Index publisher honesty until the index is itself threshold-attested; thin-market manipulation of early prints |
| Holder endpoint | Self-custody throughout; worst case ≈ long BTC + bounded `ε` + funding paid | Own node/delegate ops, own key management, understanding of `P_floor` |

**The irreducible trust core, in one sentence:** m-of-n oracle honesty about a
public number, plus liveness of watching infrastructure whose failure costs are
capped (`ε`) and insurable, plus market depth for continuity — everything else is
Bitcoin script.

---

## 9. The five unsolved pieces (first-class risks)

### (a) Liquidity depth & volume — **the** existential risk **[UNSOLVED — market, not math]**

Every dollar of stability requires roughly a dollar of provider collateral locked
in DLCs (floor-dependent). The direct precedents are sobering and must be named:
**10101 shipped almost exactly this architecture** (rust-dlc channels, synthetic
USD) and shut down in Oct 2024; ItchySats (DLC CFDs) before it; Stable Channels
remains tiny. None died of cryptography — all died of two-sided-market failure
plus regulatory drag.
**Approach:** sell the provider side *as its own product* — bonded, liquidation-
proof ~2× long BTC (§ 1.2) — to the natural audience (treasuries/whales already
long-and-never-selling; funding yield on coins they'd hold anyway); publish
funding prints from day one (visible yield recruits supply); bootstrap with an
anchor-LP consortium contractually committed to standby quotes at capped spreads
for the pilot; keep `V` capped (hard protocol-level cap) until measured standby
depth at stress-tested funding levels exceeds a safety multiple of open interest.
Success metric to publish honestly: *time-to-refill a dropped leg at ≤ X bps
funding premium, in backtested stress windows* — not TVL.

### (b) Standardized durations **[ENGINEERING + coordination]**

Bespoke maturities fragment liquidity into puddles and make every leg an OTC
negotiation. **Approach:** a public "term sheet" profile on top of dlcspecs fixing:
tenor grid (48h / 1w / 1m rolling), maturity timestamps (fixed daily/weekly
expiries, options-market style), oracle event-id schema + committee set, digit
decomposition + rounding grid, collateral ratio tiers (floor classes:
`P_floor = 0.5·P₀ / 0.33·P₀`), funding quotation convention (annualized bps on
`V`), and anchor/fee policy. Publish as an open spec extension (dlcspecs PR or
bLIP-style document) so any wallet/front-end produces byte-compatible,
*fungible* legs. Standardization is what makes (c) possible at all.

### (c) Secondary market / early exit **[RESEARCH — genuinely unsolved]**

A DLC position is a bilateral bundle of pre-signed adaptor signatures; you cannot
unilaterally transfer it — a new party means a new CET set signed by the
*remaining* counterparty, so **novation requires counterparty cooperation** by
construction. No known trick removes this (adaptor-signature "re-encryption" to a
new key without the counterparty is not a thing; anything claiming otherwise
should be treated as broken until proven).
**Approach, layered:** (1) make maturities short and rolling — "exit = don't
roll" bounds exit latency to the tenor, which is the honest baseline; (2)
protocol-embedded novation: cooperative transfer messages (new party re-signs, old
party released) with a standing fee to the cooperating counterparty — works
whenever they're live and rational, and (b)'s standardization makes the
replacement leg identical; (3) exit-by-offset: enter the mirrored leg with a
standby provider for the residual tenor — instant, trustless, but doubles locked
collateral until both mature and carries funding basis; (4) tokenized/tradeable
claims on legs (Taproot Assets or similar): speculative, custody-blurring —
**[RESEARCH]**, explicitly out of scope for real funds until the trust model is
written down and reviewed.

### (d) Manipulation resistance of rate & oracle **[partially mitigable engineering; residual research]**

Two distinct targets, often conflated: the **price feed** (settles contracts, § 3)
and the **funding-rate index** (prices new ones, § 7). Price feed defenses:
medianized multi-venue windows per oracle, m-of-n across operators/jurisdictions,
bonds vs. equivocation, per-window movement caps + consumer circuit breakers,
value-at-risk-per-attestation bounded by tiering (§ 4.1) — sustained multi-venue
manipulation is then required, against arbitrage flow, with per-window extractable
value capped: raise cost above prize and publish both numbers. Funding-rate index
defenses are weaker and must be said so: early prints are thin; wash-quoting to
paint the index is cheap; mitigations (volume-weight by *settled* — not quoted —
funding actually paid inside completed contracts, trimmed medians per epoch,
manipulation-resistant estimator choice, minimum-print thresholds before the index
is referenceable) reduce but don't eliminate it. **Residual:** m-of-n collusion
on the price feed, and thin-market index games until real volume exists. Anyone
integrating the index before depth exists must treat it as informational, not
load-bearing.

### (e) One base rate across the stack **[RESEARCH — circularity is the hard part]**

Goal: DLC funding, lease markets, and stablecoin carry all referencing one
BTC-native reference rate (a "BTC-SOFR"). Two hard sub-problems: **circularity**
(the rate is derived from the very contracts that would reference it — a bad print
propagates into new contract pricing, which feeds the next print; reflexivity
again, now in the rate) and **attestation** (the index itself needs an oracle,
inheriting all of (d)).
**Approach:** SOFR's own design pattern, translated: derive strictly from
*realized, settled* transactions (funding actually paid inside matured legs —
observable, costly to fake at volume) over trailing windows, trimmed; version the
methodology publicly; threshold-attest the index with the same committee
machinery as prices (making rate-referencing DLCs — floating/fixed swaps —
possible with zero new cryptography); dampen circularity with trailing windows +
per-epoch movement caps + a published fallback rate; and **sequence honestly**:
publish informational-only for phases 1–3, allow rate-referencing contracts only
after depth criteria from (a) are met. A reference rate you can't yet defend is
worse than none.

---

## 10. Phased build plan

Rule for every phase: **a phase ships only with its kill-criteria and measured
numbers, not vibes.** Every ⚠ marks a point where a naive implementation is
unsafe with real money.

### Phase 0 — Paper + simulation (no Bitcoin at all)
- Agent-based simulation of the full loop: price paths (historical replay:
  Mar 2020, May 2021, Jun 2022, Aug 2024; plus jump-diffusion beyond-worst-case),
  tiered protocol latencies, roll CPU costs from real rust-dlc benchmarks,
  counterparty-drop processes *correlated with drawdowns*, standby-fill models.
- Outputs that gate everything downstream: `C` sizing vs. floor-breach
  probability; `ε` and Tier 1 cadence vs. watchtower load; roll-trigger margins
  vs. § 4.4 gap-race probability; N and ladder spacing vs. continuity survival
  curves; funding levels needed to clear the market in stress.
- ⚠ Skipping correlated-drop modeling (independent-failure assumptions) will
  produce beautiful, wrong constants — this is the reflexivity error in
  statistical clothing.

### Phase 1 — Regtest/signet: one leg, slow motion
- rust-dlc (or dlcdevkit) + on-chain DLCs first, then the DLC-channel construction;
  own oracle (bitcoin-s oracle server or hand-rolled attester); hyperbola payout;
  manual rolls at minutes-cadence. Verify: CET correctness across the price range
  incl. boundary truncation, unilateral settlement from every reachable state,
  penalty on every revocable state, floor behavior exactly as § 1.2.
- Stand up the forked ln-dlc-node lineage and take ownership of the patch set —
  budget this as a first-class workstream, not a dependency install.
- ⚠ Single self-run oracle = you are the trust model; fine on signet, disqualifying
  beyond it. ⚠ Fixed-feerate CETs without anchors: build § 2.4 anchors *in this
  phase* — retrofitting fee-bumping onto pre-signed trees later is a rewrite.

### Phase 2 — Streaming protocol on testnet/signet
- Implement § 4.2 messages (LDK custom messages or CLN plugin), tiered state
  machine, auto-roll triggers, circuit breakers, keysend funding metered to ticks;
  Merkleized oracle announcement batches; measure real roll throughput and Tier 1
  ceilings on commodity hardware; chaos-test: drop streams mid-crash-replay, kill
  nodes mid-roll, replay/reorder ticks, equivocate the test oracle and watch the
  bond-sweep fire.
- ⚠ The auto-signer is now a hot wallet signing money-moving updates on external
  input (price). `ε`-bounds, drift caps, and circuit breakers are the *only* thing
  between a bad feed/bug and drained channels — adversarial-review this component
  above all others. ⚠ Nonce persistence on the oracle: crash-restart nonce reuse
  leaks the oracle key (§ 3.3); test the crash paths explicitly.

### Phase 3 — Multi-everything + high-frequency watchtower (testnet)
- Contract-level 2-of-3 → k-of-n oracles (independent operators, medianized
  windows); N-leg portfolio with maturity ladder; Nostr RFQ standby market with
  dormant pre-opened channels; drop→replace state machine end-to-end under
  crash-replay; § 5.2 compact-state tower: write the spec, extend rust-teos,
  adversarial review; publish the (b) term-sheet profile draft.
- ⚠ DKG/FROST not here — contract-level m-of-n only; FROST waits for Phase 4+ and
  independent cryptographic review. ⚠ The tower design is novel: treat as
  unaudited until externally reviewed; run blind-blob towers in parallel as belt-
  and-braces at low Tier 1 cadence.

### Phase 4 — Hardened mainnet pilot, capped
- External security audit of: DLC engine usage, the channel fork, auto-signer,
  tower, oracle infra. Independent oracle committee with published bonds and
  methodologies. Hard cap on total `V` (e.g., low five figures USD), anchor-LP
  consortium, published floors/`ε`/funding prints, incident runbooks, kill
  switches that degrade to "hold last enforceable state."
- Entry criteria (from Phase 0/3 measurements, pre-committed): gap-race
  probability below target at chosen margins; standby refill time under stress
  replay below ladder runway; tower failure loss ≤ `ε` verified under fault
  injection.
- ⚠ Do not scale `V` past measured standby depth (§ 9a metric). ⚠ Funding-rate
  index remains informational-only. ⚠ Regulatory review before any public
  offering — several predecessors died of this, not of code.

### Phase 5+ — Research tracks (parallel, never blocking, never silently assumed)
PTLC price↔payment fusion (§ 4.5) · FROST single-point committees ·
eltoo migration path · deterministic-signature-reuse partnerships ·
rate-referencing DLCs after § 9(e) criteria · novation/tokenized exit (§ 9c-4).

---

## 11. Prior art (read before writing code)

- **Dryja, "Discreet Log Contracts"** — original paper; already sketches the
  synthetic-asset/stable-value use and oracle key-leak-on-equivocation.
- **dlcspecs** + **rust-dlc** / **bitcoin-s** — the working substrate, incl.
  numeric decomposition, hyperbola payouts, multi-oracle bounded-error.
- **10101 (ln-dlc-node)** — shipped self-custodial synthetic USD on DLC channels;
  shut down 2024. Its code and its post-mortem are both required reading; its
  fork burden is now yours.
- **ItchySats** — DLC CFDs, shut down 2023 (same market lesson).
- **Stable Channels (toneloc)** — the no-DLC minimal version: cooperative LN
  balance-shifting to peg USD value. Proves Tier-1-style mechanics live; lacks
  enforceable settlement when cooperation stops — exactly the gap DLCs close.
- **Stablesats (Galoy)** — same synthetic-USD math, hedge on centralized perp
  venues; the custody/counterparty model this design exists to remove.
- **Le Guilly et al., DLC-over-Lightning work** (barrier escrows, DLC channels,
  oracle-contingent payments) — the research base for L3/L4 and § 4.5.
- **Lightning Pool** (Lightning Labs) — lease-auction design template for L6.
- **Watchtowers**: LND altruist tower, rust-teos; Pisa & Cerberus papers for
  bonded-accountability designs feeding § 5.2.
- **Eltoo / LN-Symmetry (BIP118), CTV+CSFS** — the state-collapse endgame for § 5.

---

*Written as a design brief for technically fluent readers. Every [RESEARCH] label
is load-bearing: nothing so labeled may be silently assumed solved in any
implementation phase.*
