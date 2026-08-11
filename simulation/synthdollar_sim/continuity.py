"""Counterparty continuity simulation (ARCHITECTURE.md § 6).

N staggered hedge legs per path. Drop hazard scales with trailing drawdown —
the reflexivity correlation: drops cluster exactly when BTC is crashing.
A dropped leg stays *enforceably hedged* until its residual maturity runs out
(the ladder runway); a standby refill starts immediately and takes a
stress-scaled time. The leg is unhedged only for the interval where the refill
outlasts the runway.
"""

import numpy as np

from .params import ContinuityParams


def rolling_max(x: np.ndarray, window: int) -> np.ndarray:
    """Trailing max over `window` samples, per row, in O(n log window)."""
    m = x.copy()
    covered = 1
    while covered < window:
        k = min(covered, window - covered)
        m[:, k:] = np.maximum(m[:, k:], m[:, :-k])
        covered += k
    return m


def simulate(price_paths: np.ndarray, dt_s: float, tenor_s: float,
             cp: ContinuityParams, rng=None) -> dict:
    if rng is None:
        rng = np.random.default_rng(0)
    n_paths, n_cols = price_paths.shape
    n_legs = cp.n_legs

    window = max(1, int(round(cp.drawdown_window_s / dt_s)))
    dd = 1.0 - price_paths / rolling_max(price_paths, window)  # in [0, 1)

    # Per-leg state, vectorized over (paths, legs).
    busy_until = np.zeros((n_paths, n_legs))        # drop handling in progress
    unhedged_from = np.full((n_paths, n_legs), np.inf)
    unhedged_to = np.full((n_paths, n_legs), np.inf)

    max_unhedged_frac = np.zeros(n_paths)
    unhedged_leg_seconds = np.zeros(n_paths)
    frac30_seconds = np.zeros(n_paths)
    n_drops = np.zeros(n_paths, dtype=np.int64)

    base_p = cp.base_drop_hazard_per_day * dt_s / 86400.0

    for k in range(1, n_cols):
        t = k * dt_s
        stress = dd[:, k] / 0.5  # 1.0 at a 50% trailing drawdown
        p_drop = base_p * (1.0 + cp.stress_hazard_mult * stress)

        can_drop = busy_until <= t
        drops = can_drop & (rng.random((n_paths, n_legs)) < p_drop[:, None])
        if drops.any():
            runway = rng.uniform(0.0, tenor_s, size=(n_paths, n_legs))
            median = cp.refill_median_s * (1.0 + (cp.refill_stress_mult - 1.0) * stress)
            refill = np.exp(rng.normal(np.log(median)[:, None], cp.refill_sigma,
                                       size=(n_paths, n_legs)))
            # A failed first attempt (no standby quotes in stress) costs ~10x.
            p_fail = np.minimum(1.0, cp.refill_fail_frac_at_stress * stress)
            failed = rng.random((n_paths, n_legs)) < p_fail[:, None]
            refill = np.where(failed, refill * 10.0, refill)

            u_from = t + runway
            u_to = t + np.maximum(runway, refill)
            unhedged_from = np.where(drops, u_from, unhedged_from)
            unhedged_to = np.where(drops, u_to, unhedged_to)
            busy_until = np.where(drops, u_to, busy_until)
            n_drops += drops.sum(axis=1)

        unhedged_now = (unhedged_from <= t) & (t < unhedged_to)
        frac = unhedged_now.mean(axis=1)
        np.maximum(max_unhedged_frac, frac, out=max_unhedged_frac)
        unhedged_leg_seconds += unhedged_now.sum(axis=1) * dt_s
        frac30_seconds += (frac >= 0.3) * dt_s

    return {
        "sim_seconds": (n_cols - 1) * dt_s,
        "n_paths": n_paths,
        "n_legs": n_legs,
        "n_drops": n_drops,
        "max_unhedged_frac": max_unhedged_frac,
        "unhedged_leg_seconds": unhedged_leg_seconds,
        "frac30_seconds": frac30_seconds,
    }


def report(res: dict) -> str:
    days = res["sim_seconds"] / 86400.0
    ulh = res["unhedged_leg_seconds"] / 3600.0 / res["n_legs"]
    return "\n".join([
        f"legs={res['n_legs']}  drops/path (mean): {res['n_drops'].mean():.2f}",
        f"max simultaneous unhedged frac: mean {res['max_unhedged_frac'].mean():.3f}, "
        f"p99 {np.percentile(res['max_unhedged_frac'], 99):.3f}",
        f"unhedged exposure (portfolio-hours over {days:.0f}d): "
        f"mean {ulh.mean():.2f}h, p99 {np.percentile(ulh, 99):.2f}h",
        f"P(>=30% unhedged at some point): {(res['frac30_seconds'] > 0).mean():.4f}",
    ])
