"""
CLI wrapper over E.2.01.* simulations.

Usage:
    python simulate.py --scenario mass_exit  --pct 50
    python simulate.py --scenario whale      --pct 50
    python simulate.py --scenario cycles     --n 100
    python simulate.py --scenario pool       --n 100
    python simulate.py --scenario levels
    python simulate.py --scenario full_cycle
    python simulate.py --all  --output results/

Block: S.1.01.01
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# adjust sys.path — e/02_simulation is not a package, but scripts/python needs it
_THIS = Path(__file__).resolve().parent
sys.path.insert(0, str(_THIS.parent.parent / "e" / "02_simulation"))

import base_model  # noqa: E402
import crash_mass_exit  # noqa: E402
import crash_whale  # noqa: E402
import crash_cycles  # noqa: E402
import crash_pool  # noqa: E402
import crash_levels  # noqa: E402
import crash_full_cycle  # noqa: E402


SCENARIOS = {
    "mass_exit":   "Scenario: % of holders exit (10|25|50|80|100).",
    "whale":       "Scenario: whale holds pct% of supply, attempts exit.",
    "cycles":      "Scenario: N buy+sell cycles; check rounding / invariants.",
    "pool":        "Scenario: N pool cycles (buy/sell pool/curve).",
    "levels":      "Scenario: cross all level boundaries; check P continuity.",
    "full_cycle":  "Scenario: full lifecycle (mint → pool → buy → redeem → ...).",
}


def run_scenario(name: str, args: argparse.Namespace) -> dict:
    if name == "mass_exit":
        return crash_mass_exit.run(scenario=str(args.pct), sell_team_fee_bp=args.sell_team_fee_bp)

    if name == "whale":
        return crash_whale.run(whale_pct=float(args.pct), sell_team_fee_bp=args.sell_team_fee_bp)

    if name == "cycles":
        return crash_cycles.run(cycles=int(args.n), sell_team_fee_bp=args.sell_team_fee_bp)

    if name == "pool":
        return crash_pool.run(cycles=int(args.n), sell_team_fee_bp=args.sell_team_fee_bp)

    if name == "levels":
        return crash_levels.run(sell_team_fee_bp=args.sell_team_fee_bp)

    if name == "full_cycle":
        return crash_full_cycle.run(sell_team_fee_bp=args.sell_team_fee_bp)

    raise ValueError(f"unknown scenario: {name}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="XartIA simulation CLI (E.2.*)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="\n".join(f"  {k:<12} — {v}" for k, v in SCENARIOS.items()),
    )
    parser.add_argument(
        "--scenario",
        choices=list(SCENARIOS.keys()),
        help="scenario to run (omit + --all to run all)",
    )
    parser.add_argument("--pct", default="50", help="percent (mass_exit / whale), default 50")
    parser.add_argument("--n", default="100", help="cycles count (cycles/pool), default 100")
    parser.add_argument("--sell-team-fee-bp", type=int, default=10, help="sellTeamFee in bp, default 10")
    parser.add_argument("--all", action="store_true", help="run all scenarios")
    parser.add_argument("--output", default=None, help="output dir for JSON results")
    parser.add_argument("--quiet", action="store_true", help="suppress per-scenario prints")
    args = parser.parse_args(argv)

    if not args.scenario and not args.all:
        parser.print_help()
        return 2

    names = list(SCENARIOS.keys()) if args.all else [args.scenario]

    results: dict[str, dict] = {}
    any_fail = False

    for name in names:
        try:
            r = run_scenario(name, args)
        except Exception as e:
            print(f"[{name}] ERROR: {type(e).__name__}: {e}", file=sys.stderr)
            any_fail = True
            continue

        results[name] = r

        inv = r.get("invariants", {})
        ok = all(inv.values()) if inv else True
        if not ok:
            any_fail = True

        if not args.quiet:
            print(f"=== {name} ===")
            print(f"  invariants: {inv}  → {'OK' if ok else 'FAIL'}")
            fs = r.get("final_state", {})
            for k, v in fs.items():
                if isinstance(v, float):
                    print(f"  {k:<32} = {v:.6f}")
            print()

    if args.output:
        out = Path(args.output)
        out.mkdir(parents=True, exist_ok=True)
        path = out / "simulate_results.json"
        with open(path, "w") as f:
            json.dump(results, f, indent=2)
        print(f"written: {path}")

    return 1 if any_fail else 0


if __name__ == "__main__":
    sys.exit(main())