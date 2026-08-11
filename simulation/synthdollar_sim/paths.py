"""Price-path generators: GBM, Merton jump-diffusion, crash preset, CSV replay.

These are stress generators, not forecasts. Calibrate/replace before trusting
any downstream constant.
"""

import csv

import numpy as np


def gbm(rng, p0: float, n_steps: int, dt_s: float, mu_ann: float = 0.0,
        sigma_ann: float = 0.6, n_paths: int = 1) -> np.ndarray:
    """Geometric Brownian motion. Returns (n_paths, n_steps + 1)."""
    dt = dt_s / (365.0 * 86400.0)
    z = rng.standard_normal((n_paths, n_steps))
    log_inc = (mu_ann - 0.5 * sigma_ann**2) * dt + sigma_ann * np.sqrt(dt) * z
    log_paths = np.cumsum(log_inc, axis=1)
    out = np.empty((n_paths, n_steps + 1))
    out[:, 0] = p0
    out[:, 1:] = p0 * np.exp(log_paths)
    return out


def merton_jump(rng, p0: float, n_steps: int, dt_s: float, mu_ann: float = 0.0,
                sigma_ann: float = 0.6, jump_rate_per_year: float = 12.0,
                jump_mean: float = -0.10, jump_sigma: float = 0.10,
                n_paths: int = 1) -> np.ndarray:
    """Merton jump-diffusion: GBM plus compound-Poisson lognormal jumps.

    Defaults: ~monthly jumps averaging -10%. Jumps are what create gap races;
    do not size roll margins on GBM alone.
    """
    dt = dt_s / (365.0 * 86400.0)
    z = rng.standard_normal((n_paths, n_steps))
    n_jumps = rng.poisson(jump_rate_per_year * dt, size=(n_paths, n_steps))
    jump_log = n_jumps * jump_mean + np.sqrt(n_jumps) * jump_sigma * rng.standard_normal(
        (n_paths, n_steps)
    )
    log_inc = (mu_ann - 0.5 * sigma_ann**2) * dt + sigma_ann * np.sqrt(dt) * z + jump_log
    log_paths = np.cumsum(log_inc, axis=1)
    out = np.empty((n_paths, n_steps + 1))
    out[:, 0] = p0
    out[:, 1:] = p0 * np.exp(log_paths)
    return out


def crash_preset(rng, p0: float, n_steps: int, dt_s: float,
                 n_paths: int = 1) -> np.ndarray:
    """Synthetic Mar-2020-shaped stress: high vol, frequent large negative jumps.

    Roughly -40..-60% over days when jumps cluster. Stand-in until historical
    replay CSVs are added; ARCHITECTURE.md § 10 Phase 0 requires both.
    """
    return merton_jump(
        rng, p0, n_steps, dt_s,
        mu_ann=-1.0, sigma_ann=1.2,
        jump_rate_per_year=400.0, jump_mean=-0.05, jump_sigma=0.05,
        n_paths=n_paths,
    )


def flash_preset(rng, p0: float, n_steps: int, dt_s: float,
                 n_paths: int = 1) -> np.ndarray:
    """Clustered minute-scale downside: jumps arrive in bursts so that -20%+
    inside minutes is plausible. This is the scenario that exercises the
    § 4.4 gap race (trigger -> floor faster than a roll completes)."""
    dt = dt_s / (365.0 * 86400.0)
    sigma_ann = 1.0
    z = rng.standard_normal((n_paths, n_steps))
    # Self-exciting-ish arrival: baseline rate spikes 50x for ~30min after a jump.
    base_rate, spike_mult, decay_steps = 150.0, 50.0, max(1, int(1800 / dt_s))
    rate = np.full(n_paths, base_rate)
    log_inc = np.empty((n_paths, n_steps))
    excited = np.zeros(n_paths, dtype=int)
    for k in range(n_steps):
        rate = np.where(excited > 0, base_rate * spike_mult, base_rate)
        nj = rng.poisson(rate * dt)
        jump = nj * -0.04 + np.sqrt(nj) * 0.03 * rng.standard_normal(n_paths)
        excited = np.where(nj > 0, decay_steps, np.maximum(excited - 1, 0))
        log_inc[:, k] = -0.5 * sigma_ann**2 * dt + sigma_ann * np.sqrt(dt) * z[:, k] + jump
    out = np.empty((n_paths, n_steps + 1))
    out[:, 0] = p0
    out[:, 1:] = p0 * np.exp(np.cumsum(log_inc, axis=1))
    return out


def load_csv(path: str, dt_s: float) -> np.ndarray:
    """Load (timestamp_s, price) rows and resample to a fixed dt via
    previous-tick interpolation. Returns shape (1, n_steps + 1)."""
    ts, px = [], []
    with open(path) as f:
        for row in csv.reader(f):
            if not row or row[0].lstrip("-").split(".")[0].isdigit() is False:
                continue
            ts.append(float(row[0]))
            px.append(float(row[1]))
    if len(ts) < 2:
        raise ValueError(f"{path}: need at least 2 rows of timestamp,price")
    ts_a = np.asarray(ts)
    px_a = np.asarray(px)
    order = np.argsort(ts_a)
    ts_a, px_a = ts_a[order], px_a[order]
    grid = np.arange(ts_a[0], ts_a[-1], dt_s)
    idx = np.searchsorted(ts_a, grid, side="right") - 1
    return px_a[idx][None, :]
