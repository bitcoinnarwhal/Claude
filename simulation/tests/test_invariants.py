"""Invariants that must hold regardless of parameters. Run: pytest tests/"""

import numpy as np

from synthdollar_sim import (
    HedgeParams,
    ProtocolParams,
    collateral_for_floor,
    holder_usd,
    p_floor,
    payout_btc,
    protocol,
)
from synthdollar_sim.continuity import rolling_max

B, P0, V = 1.0, 100_000.0, 100_000.0


def test_floor_formula_roundtrip():
    C = collateral_for_floor(V, B, 50_000.0)
    assert np.isclose(C, 1.0)
    assert np.isclose(p_floor(V, B, C), 50_000.0)


def test_holder_usd_exact_above_floor():
    C = 1.0
    floor = p_floor(V, B, C)
    P = np.linspace(floor * 1.0001, 10 * P0, 5000)
    assert np.allclose(holder_usd(P, B, V, C), V, rtol=1e-9)


def test_holder_usd_degrades_linearly_below_floor():
    C = 1.0
    P = np.linspace(1_000.0, p_floor(V, B, C) * 0.999, 1000)
    assert np.allclose(holder_usd(P, B, V, C), (B + C) * P, rtol=1e-9)


def test_payout_clipped_to_posted_collateral():
    C = 1.0
    q = payout_btc(np.array([1.0, P0, 1e9]), B, V, C)
    assert q[0] == C          # crash: capped at provider collateral
    assert abs(q[1]) < 1e-9   # entry price: no transfer
    assert q[2] >= -B         # melt-up: holder never owes more than the stack


def test_rolling_max_matches_naive():
    rng = np.random.default_rng(7)
    x = rng.random((3, 200))
    w = 17
    m = rolling_max(x, w)
    naive = np.array([[x[i, max(0, j - w + 1):j + 1].max() for j in range(200)]
                      for i in range(3)])
    assert np.allclose(m, naive)


def _run(pxs, dt=60.0, **pp_kwargs):
    hp = HedgeParams()
    pp = ProtocolParams(**pp_kwargs)
    return protocol.simulate(pxs, dt, hp, pp), hp, pp


def test_calm_path_never_breaches():
    t = np.arange(0, 30 * 1440 + 1) * 60.0
    px = (P0 * (1 + 0.05 * np.sin(t / 86400.0)))[None, :]
    res, _, _ = _run(px)
    assert not res["breach"].any()
    assert res["worst_shortfall_usd"].max() == 0.0
    assert res["n_rolls"][0] >= 14  # ~48h tenor over 30 days


def test_cliff_with_slow_roll_breaches():
    # -60% over 10 minutes: falls through trigger and floor faster than a
    # stressed roll can complete.
    n = 1440
    px = np.full(n + 1, P0)
    px[700:711] = np.linspace(P0, 0.4 * P0, 11)
    px[711:] = 0.4 * P0
    res, _, _ = _run(px[None, :], roll_latency_s=600.0)
    assert res["breach"][0]
    assert res["worst_shortfall_usd"][0] > 0


def test_drift_capped_near_epsilon_on_smooth_path():
    # On a smooth path, drift between checkpoints stays within eps*V plus one
    # step's move (checkpoints are evaluated after the step lands).
    t = np.arange(0, 7 * 1440 + 1) * 60.0
    px = (P0 * (1 + 0.10 * np.sin(t / 43200.0)))[None, :]
    res, hp, pp = _run(px)
    step_usd = np.max(np.abs(np.diff(px[0]))) * hp.B
    assert res["max_drift_usd"][0] <= pp.epsilon_frac * hp.V + step_usd


def test_deterministic_given_seed():
    from synthdollar_sim import paths as pth
    px1 = pth.merton_jump(np.random.default_rng(42), P0, 500, 60.0, n_paths=4)
    px2 = pth.merton_jump(np.random.default_rng(42), P0, 500, 60.0, n_paths=4)
    assert np.array_equal(px1, px2)
