"""Parameter sets for the Phase 0 simulator.

Latency/CPU defaults are the order-of-magnitude figures from
ARCHITECTURE.md § 4.3, not measurements. Replace with benchmarked values as
Phases 1-2 produce them.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class HedgeParams:
    B: float = 1.0            # holder stack, BTC
    P0: float = 100_000.0     # entry price, USD/BTC
    V: float = 100_000.0      # target stable value, USD
    floor_ratio: float = 0.5  # contract floor as fraction of price at each roll


@dataclass(frozen=True)
class ProtocolParams:
    epsilon_frac: float = 0.0025      # Tier 1 drift cap, fraction of V (25 bps)
    checkpoint_max_s: float = 600.0   # force a checkpoint at least this often
    tenor_s: float = 48 * 3600.0      # Tier 2 roll tenor
    roll_trigger_margin: float = 0.20 # roll when P <= (1 + margin) * floor
    roll_latency_s: float = 30.0      # signing + RTTs + top-up, happy path
    roll_latency_stress_mult: float = 4.0  # latency multiplier under stress
    roll_failure_prob: float = 0.0    # per-roll counterparty no-show (continuity handles it)


@dataclass(frozen=True)
class ContinuityParams:
    n_legs: int = 10
    base_drop_hazard_per_day: float = 0.02   # per-leg, calm conditions
    stress_hazard_mult: float = 25.0         # hazard multiplier at 50% trailing drawdown
    drawdown_window_s: float = 24 * 3600.0
    refill_median_s: float = 120.0           # standby-market fill, calm
    refill_sigma: float = 1.0                # lognormal sigma of refill time
    refill_stress_mult: float = 30.0         # median multiplier at 50% trailing drawdown
    refill_fail_frac_at_stress: float = 0.3  # prob a refill attempt finds no standby at 50% dd
