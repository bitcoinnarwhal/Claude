# Phase 0 simulator — synthetic-dollar hedge dynamics

Monte-Carlo simulation of the economic and protocol dynamics described in
`../ARCHITECTURE.md`. This is **Phase 0 of the build plan**: no Bitcoin, no
Lightning, no cryptography — pure math over price paths, used to size the
constants that everything downstream depends on:

- `C` (provider collateral) sizing vs. **floor-breach probability** (§ 1.2)
- roll-trigger margins vs. the **gap-race probability** (§ 4.4): can price run
  from the roll trigger to the collateral floor faster than a roll completes?
- `ε` and checkpoint cadence vs. **watchtower load** (§ 5): states/day and
  storage under the blind-blob vs. compact-state tower models
- counterparty **drop/refill dynamics correlated with drawdowns** (§ 6):
  unhedged exposure when drops cluster in crashes

## What this deliberately is NOT

- Not a protocol implementation. Nothing here signs, settles, or talks to a
  node. Latencies and CPU costs are *parameters* (defaults taken from the
  rust-dlc-order-of-magnitude numbers in ARCHITECTURE.md § 4.3); replace them
  with measured values as Phases 1–2 produce benchmarks.
- Not a price model you should trust blindly. GBM/Merton jump-diffusion and the
  synthetic crash preset are stress *generators*, not forecasts. Add historical
  replay CSVs (see `paths.load_csv`) for the windows named in the build plan
  (Mar 2020, May 2021, Jun 2022, Aug 2024) before believing any constant.
- Not validated. Per the build-plan rule, numbers from this simulator gate
  later phases only once the drop/refill and latency models have been reviewed
  and the historical replays are in.

## Run

```
pip install numpy
python run_sim.py --scenario jump --paths 2000 --days 30
python run_sim.py --scenario crash --paths 2000 --days 7    # correlated-stress preset
python -m pytest tests/                                     # invariants
```

## Model summary

One hedged holder: `B` BTC, target value `V`, provider collateral `C` set so the
contract floor sits at `floor_ratio × ` the roll price. Payout at price `P` is
`clip(V/P − B, −B, C)` (ARCHITECTURE.md § 1.1). The protocol loop applies the
tiered cadence of § 4.1: ticks every step, checkpoints when unrealized drift
hits `ε·V` (or a max interval), rolls at tenor maturity or when price nears the
floor — with a latency window during which the price keeps moving, which is
where gap breaches live. The continuity module runs N staggered legs with a
drop hazard that scales with trailing drawdown (the reflexivity correlation of
§ 6.5) and stress-dependent refill times.

Known simplifications (fix before trusting outputs): single-asset stress proxy
(trailing drawdown) for provider impairment; refill times lognormal rather than
order-book-derived; no fee-market model for forced on-chain settlement; roll
latency independent of concurrent roll count.
