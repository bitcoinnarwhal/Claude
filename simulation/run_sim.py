#!/usr/bin/env python3
"""Phase 0 scenario runner. See README.md for what this is and is not."""

import argparse

import numpy as np

from synthdollar_sim import (
    ContinuityParams,
    HedgeParams,
    ProtocolParams,
    continuity,
    paths,
    protocol,
    watchtower,
)

SCENARIOS = {
    "gbm": lambda rng, p0, n, dt, m: paths.gbm(rng, p0, n, dt, n_paths=m),
    "jump": lambda rng, p0, n, dt, m: paths.merton_jump(rng, p0, n, dt, n_paths=m),
    "crash": lambda rng, p0, n, dt, m: paths.crash_preset(rng, p0, n, dt, n_paths=m),
    "flash": lambda rng, p0, n, dt, m: paths.flash_preset(rng, p0, n, dt, n_paths=m),
}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--scenario", choices=sorted(SCENARIOS) + ["csv"], default="jump")
    ap.add_argument("--csv", help="timestamp_s,price file for --scenario csv")
    ap.add_argument("--paths", type=int, default=1000)
    ap.add_argument("--days", type=float, default=30.0)
    ap.add_argument("--dt", type=float, default=60.0, help="protocol step, seconds")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--floor-ratio", type=float, default=0.5)
    ap.add_argument("--epsilon-bps", type=float, default=25.0)
    ap.add_argument("--roll-latency", type=float, default=30.0)
    ap.add_argument("--legs", type=int, default=10)
    args = ap.parse_args()

    hp = HedgeParams(floor_ratio=args.floor_ratio)
    pp = ProtocolParams(epsilon_frac=args.epsilon_bps / 10_000.0,
                        roll_latency_s=args.roll_latency)
    cp = ContinuityParams(n_legs=args.legs)
    rng = np.random.default_rng(args.seed)

    n_steps = int(args.days * 86400 / args.dt)
    if args.scenario == "csv":
        if not args.csv:
            ap.error("--scenario csv requires --csv FILE")
        px = paths.load_csv(args.csv, args.dt)
        px = px * (hp.P0 / px[0, 0])  # normalize to the model entry price
    else:
        px = SCENARIOS[args.scenario](rng, hp.P0, n_steps, args.dt, args.paths)

    print(f"== hedge/protocol ({args.scenario}, dt={args.dt:.0f}s) ==")
    res = protocol.simulate(px, args.dt, hp, pp, rng)
    print(protocol.report(res, hp, pp))

    print("\n== watchtower load ==")
    cp_day = float(np.mean(res["n_checkpoints"] / (res["sim_seconds"] / 86400.0)))
    print(watchtower.report(cp_day, n_channels=args.legs, horizon_days=args.days))

    # Continuity runs on a coarser grid; regenerate paths at that dt.
    cdt = 300.0
    print(f"\n== continuity ({args.legs} legs, dt={cdt:.0f}s) ==")
    if args.scenario == "csv":
        cpx = paths.load_csv(args.csv, cdt)
        cpx = cpx * (hp.P0 / cpx[0, 0])
    else:
        cn = int(args.days * 86400 / cdt)
        cpx = SCENARIOS[args.scenario](rng, hp.P0, cn, cdt, args.paths)
    cres = continuity.simulate(cpx, cdt, pp.tenor_s, cp, rng)
    print(continuity.report(cres))


if __name__ == "__main__":
    main()
