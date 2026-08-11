# Synthetic Sats — front-end sim layer (Base44 app mirror)

Source mirror of the simulation layer of the **Synthetic Sats** Base44 app
(app id `6a7b617b1be23b766979bbda`), whose deployment and full scaffold
(Vite/React/Tailwind/shadcn boilerplate, auth pages, `src/components/ui/*`)
live in Base44. This directory tracks only the files that carry the model and
its visualization; edit them here or there, but sync manually — there is no
automatic link between this repo and the Base44 git remote.

Mirrored at Base44 checkpoint `b93c433` ("Real hedge math wired in: payout
curve, collateral floor, realized breach losses", 2026-08-11). The mirror is
byte-exact (Base44 stores files without trailing newlines; so does this
directory), so a sync check is a plain `sha256sum` comparison of these files
against the app sandbox.

## What it is

An interactive, browser-only visualizer for the instrument specified in
`../ARCHITECTURE.md`, running the same hedge math as the Phase 0 Monte-Carlo
simulator in `../simulation/` (see `simulation/synthdollar_sim/hedge.py`):

- payout `clip(V/P − H, −H, C)` BTC; peg exact above `floor = V/(H+C)`
- rolls settle P&L and re-center the floor at `floorRatio × price`;
  a roll below the floor exhausts provider collateral and **permanently**
  shrinks the stable target (no magic recovery)
- streaming vs. discrete modes contrast per-tick settlement with periodic
  re-strikes; the drift chart shows the unsettled exposure (the ε
  stale-state theft bound of ARCHITECTURE.md § 4.1/§ 5)
- stress panel: −28% / −60% shocks, counterparty drop with a
  floor-frozen replacement gap, adjustable floor ratio

Simulation only: in-memory numbers, no keys, no funds, no network.

## Layout

```
src/hooks/useSyntheticSim.js   model + tick loop (the real math lives here)
src/pages/SyntheticSats.jsx    page wiring
src/components/sim/*.jsx       price feed, position readout, rebalance
                               visualizer, stress panel, liquidity, yield curve
```
