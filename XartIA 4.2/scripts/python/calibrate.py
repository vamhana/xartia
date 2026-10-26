"""
CLI wrapper over E.3.01.01 calibration.

Usage:
    python calibrate.py --targets config/calibration-targets.json --output e/03_calibration/
    python calibrate.py --default --output e/03_calibration/

Block: S.1.01.02
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

_THIS = Path(__file__).resolve().parent
sys.path.insert(0, str(_THIS.parent.parent / "e" / "03_calibration"))

import tune_params  # noqa: E402


def write_csv(result: dict, path: Path) -> None:
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["level_index", "S_start", "S_end", "P_start", "P_end", "maxBalance", "R_level"])
        for i, l in enumerate(result["levels"]):
            # R_level = area under curve within this level
            D = l["S_end"] - l["S_start"]
            r_level = (l["P_start"] + l["P_end"]) / 2.0 * D
            w.writerow([
                i,
                l["S_start"],
                l["S_end"],
                f"{l['P_start']:.12f}",
                f"{l['P_end']:.12f}",
                l["maxBalance"],
                f"{r_level:.6f}",
            ])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="XartIA calibration (E.3.01.01)")
    parser.add_argument("--targets", default=None, help="targets JSON path (default: built-in)")
    parser.add_argument("--default", action="store_true", help="use built-in targets")
    parser.add_argument("--output", default="e/03_calibration", help="output dir")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    targets_json = None
    if args.targets:
        with open(args.targets) as f:
            targets_json = json.load(f)
    elif not args.default:
        parser.print_help()
        print("\nhint: pass --targets <file.json> or --default", file=sys.stderr)
        return 2

    result = tune_params.tune(targets_json)

    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)

    json_path = out / "params_output.json"
    csv_path = out / "params_output.csv"

    with open(json_path, "w") as f:
        json.dump(result, f, indent=2)
    write_csv(result, csv_path)

    if not args.quiet:
        print(f"=== calibration ===")
        print(f"  P0    = {result['P0']:.8f} USDC/XRT")
        print(f"  alpha = {result['alpha']:.6f}")
        print(f"  sse   = {result['sse']:.6e}")
        for i, l in enumerate(result["levels"]):
            print(
                f"  [{i}] S=[{l['S_start']:.0f}, {l['S_end']:.0f}] "
                f"P=[{l['P_start']:.6f}, {l['P_end']:.6f}]"
            )
        print(f"\n  written: {json_path}")
        print(f"  written: {csv_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())