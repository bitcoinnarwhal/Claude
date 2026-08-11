"""Payout math for the fully-collateralized inverse contract (ARCHITECTURE.md § 1).

All functions are vectorized over price arrays.
"""

import numpy as np


def p_floor(V: float, B: float, C: float) -> float:
    """Price below which stability is lost: floor = V / (B + C)."""
    return V / (B + C)


def collateral_for_floor(V: float, B: float, floor: float) -> float:
    """Provider collateral needed to place the floor at `floor`. Grows as 1/floor."""
    c = V / floor - B
    if c < 0:
        raise ValueError("floor above V/B implies negative collateral")
    return c


def payout_btc(P, B: float, V: float, C: float):
    """DLC payout to holder in BTC at price P: clip(V/P - B, -B, C)."""
    P = np.asarray(P, dtype=float)
    return np.clip(V / P - B, -B, C)


def holder_btc(P, B: float, V: float, C: float):
    return B + payout_btc(P, B, V, C)


def holder_usd(P, B: float, V: float, C: float):
    """Holder's dollar value at settlement price P.

    Equals V exactly for P >= floor; degrades to (B + C) * P below the floor.
    """
    P = np.asarray(P, dtype=float)
    return holder_btc(P, B, V, C) * P
