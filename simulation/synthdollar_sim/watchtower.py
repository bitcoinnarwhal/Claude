"""Watchtower load models (ARCHITECTURE.md § 5).

Blind-blob tower: one encrypted blob stored per revoked state, forever until
channel close (the LND-altruist / rust-teos model).
Compact-state tower (§ 5.2): shachain compressibility gives O(log2 n) secrets
plus per-channel constants, traded against channel privacy.
"""

import math

BLOB_BYTES = 600           # order of magnitude for an encrypted justice blob
COMPACT_CONST_BYTES = 2048 # templates, basepoints, sweep address, bookkeeping
SECRET_BYTES = 32


def blind_blob_bytes(n_states: int) -> int:
    return n_states * BLOB_BYTES


def compact_state_bytes(n_states: int) -> int:
    if n_states <= 0:
        return COMPACT_CONST_BYTES
    return COMPACT_CONST_BYTES + SECRET_BYTES * (math.floor(math.log2(n_states)) + 1)


def report(checkpoints_per_day: float, n_channels: int, horizon_days: float) -> str:
    states = int(checkpoints_per_day * horizon_days)
    blind = blind_blob_bytes(states) * n_channels
    compact = compact_state_bytes(states) * n_channels
    return "\n".join([
        f"states/channel over {horizon_days:.0f}d: {states:,}",
        f"blind-blob tower storage ({n_channels} ch): {blind / 1e6:,.1f} MB "
        f"(+{blind_blob_bytes(int(checkpoints_per_day)) * n_channels / 1e6:,.2f} MB/day)",
        f"compact-state tower storage ({n_channels} ch): {compact / 1e3:,.1f} KB (O(log n))",
    ])
