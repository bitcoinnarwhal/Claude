"""Tiered-protocol simulation for a single hedge leg (ARCHITECTURE.md § 4).

Vectorized across Monte-Carlo paths: state is held in per-path arrays and the
time loop steps all paths together. Models:

- Tier 1 checkpoints: fire when unrealized drift reaches eps*V (or the max
  interval elapses); the drift outstanding just before each checkpoint is what
  a stale-state broadcast could steal.
- Tier 2 rolls: at tenor maturity, or early when price nears the contract
  floor; a roll takes wall-clock latency during which price keeps moving.
- Gap breaches: price below the current contract floor — the § 4.4 race lost.
"""

import numpy as np

from .hedge import collateral_for_floor, payout_btc
from .params import HedgeParams, ProtocolParams


def simulate(price_paths: np.ndarray, dt_s: float, hp: HedgeParams,
             pp: ProtocolParams, rng=None) -> dict:
    """Run the leg state machine over price paths of shape (n_paths, n_steps+1).

    Paths are assumed to start at hp.P0. Returns per-path metric arrays.
    """
    if rng is None:
        rng = np.random.default_rng(0)
    n_paths, n_cols = price_paths.shape
    B, V = hp.B, hp.V

    floor = np.full(n_paths, hp.floor_ratio * hp.P0)
    C = np.array([collateral_for_floor(V, B, f) for f in floor])
    maturity_t = np.full(n_paths, pp.tenor_s)
    rolling = np.zeros(n_paths, dtype=bool)
    roll_end_t = np.zeros(n_paths)
    dropped = np.zeros(n_paths, dtype=bool)

    q_ref = payout_btc(price_paths[:, 0], B, V, C)
    cp_last_t = np.zeros(n_paths)

    n_checkpoints = np.zeros(n_paths, dtype=np.int64)
    n_rolls = np.zeros(n_paths, dtype=np.int64)
    n_triggered_rolls = np.zeros(n_paths, dtype=np.int64)
    max_drift_usd = np.zeros(n_paths)
    breach = np.zeros(n_paths, dtype=bool)
    breach_seconds = np.zeros(n_paths)
    worst_shortfall_usd = np.zeros(n_paths)
    max_C_demand = C.copy()

    for k in range(1, n_cols):
        t = k * dt_s
        P = price_paths[:, k]

        # Tier 1: drift since last checkpoint, in USD at current price.
        q = payout_btc(P, B, V, C)
        drift = np.abs(q - q_ref) * P
        np.maximum(max_drift_usd, drift, out=max_drift_usd)
        do_cp = (drift >= pp.epsilon_frac * V) | (t - cp_last_t >= pp.checkpoint_max_s)
        do_cp &= ~dropped
        q_ref = np.where(do_cp, q, q_ref)
        cp_last_t = np.where(do_cp, t, cp_last_t)
        n_checkpoints += do_cp

        # Tier 2: start a roll on maturity or on price approaching the floor.
        trigger_price = (1.0 + pp.roll_trigger_margin) * floor
        by_price = P <= trigger_price
        start = ~rolling & ~dropped & (by_price | (t >= maturity_t))
        latency = np.where(by_price, pp.roll_latency_s * pp.roll_latency_stress_mult,
                           pp.roll_latency_s)
        roll_end_t = np.where(start, t + latency, roll_end_t)
        rolling |= start
        n_triggered_rolls += start & by_price

        # Roll completion: re-center floor at the completion price, repost C.
        done = rolling & (t >= roll_end_t)
        if done.any():
            fail = np.zeros(n_paths, dtype=bool)
            if pp.roll_failure_prob > 0:
                fail = done & (rng.random(n_paths) < pp.roll_failure_prob)
                dropped |= fail
                done &= ~fail
            new_floor = hp.floor_ratio * P
            new_C = np.maximum(V / new_floor - B, 0.0)
            floor = np.where(done, new_floor, floor)
            C = np.where(done, new_C, C)
            maturity_t = np.where(done, t + pp.tenor_s, maturity_t)
            # A roll settles P&L: it is also a checkpoint.
            q_ref = np.where(done, payout_btc(P, B, V, C), q_ref)
            cp_last_t = np.where(done, t, cp_last_t)
            n_rolls += done
            rolling &= ~(done | fail)
            np.maximum(max_C_demand, C, out=max_C_demand)

        # Gap breach: price under the enforceable contract's floor.
        under = P < floor
        breach |= under
        breach_seconds += under * dt_s
        shortfall = np.where(under, V - (B + C) * P, 0.0)
        np.maximum(worst_shortfall_usd, shortfall, out=worst_shortfall_usd)

    sim_seconds = (n_cols - 1) * dt_s
    return {
        "sim_seconds": sim_seconds,
        "n_paths": n_paths,
        "n_checkpoints": n_checkpoints,
        "n_rolls": n_rolls,
        "n_triggered_rolls": n_triggered_rolls,
        "max_drift_usd": max_drift_usd,
        "breach": breach,
        "breach_seconds": breach_seconds,
        "worst_shortfall_usd": worst_shortfall_usd,
        "max_C_demand_btc": max_C_demand,
        "dropped": dropped,
    }


def report(res: dict, hp: HedgeParams, pp: ProtocolParams) -> str:
    days = res["sim_seconds"] / 86400.0
    cp_per_day = res["n_checkpoints"] / days
    lines = [
        f"paths={res['n_paths']}  horizon={days:.1f}d",
        f"floor-breach probability      : {res['breach'].mean():.4f}",
        f"  mean breach time | breached : "
        + (f"{res['breach_seconds'][res['breach']].mean():.0f}s"
           if res["breach"].any() else "n/a"),
        f"  worst shortfall (USD, p99)  : {np.percentile(res['worst_shortfall_usd'], 99):,.0f}",
        f"checkpoints/day (mean, p99)   : {cp_per_day.mean():.0f}, {np.percentile(cp_per_day, 99):.0f}",
        f"max drift vs eps*V={pp.epsilon_frac * hp.V:,.0f} USD : "
        f"mean {res['max_drift_usd'].mean():,.0f}, p99 {np.percentile(res['max_drift_usd'], 99):,.0f}"
        f"  (includes single-tick overshoot: eps is enforceable only down to"
        f" the per-tick move at this dt)",
        f"rolls total (mean)            : {res['n_rolls'].mean():.1f}"
        f"  of which price-triggered: {res['n_triggered_rolls'].mean():.1f}",
        f"provider collateral demand    : start {res['max_C_demand_btc'].min():.2f} BTC, "
        f"p99 max {np.percentile(res['max_C_demand_btc'], 99):.2f} BTC",
    ]
    return "\n".join(lines)
