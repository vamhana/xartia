"""
Plot simulation results from simulate.py output (JSON).

Generates a 2x2 figure:
  - reserve / freeReserve over time
  - poolPrice over time
  - treasury balance over time
  - R(S_curve) and reserve

Usage:
    python plot_results.py --input results/simulate_results.json --output charts/
    python plot_results.py --input r.json --output charts/ --scenario crash_pool

Block: S.1.01.04
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


SCENARIO_SERIES = {
    "crash_mass_exit": ["reserve_history", "freeReserve_history", "poolPrice_history", "treasury_balance_history"],
    "mass_exit":       ["reserve_history", "freeReserve_history", "poolPrice_history", "treasury_balance_history"],
    "crash_whale":     ["reserve_history", "freeReserve_history", "treasury_balance_history"],
    "whale":           ["reserve_history", "freeReserve_history", "treasury_balance_history"],
    "crash_cycles":    ["treasury_balance_history"],
    "cycles":          ["treasury_balance_history"],
    "crash_pool":      ["poolPrice_history", "freeReserve_history", "treasury_balance_history"],
    "pool":            ["poolPrice_history", "freeReserve_history", "treasury_balance_history"],
    "crash_levels":    ["treasury_balance_history"],
    "levels":          ["treasury_balance_history"],
    "crash_full_cycle": [],
    "full_cycle":      [],
}


def plot_scenario(name: str, data: dict, output_dir: Path) -> list[Path]:
    """Generate one figure per scenario. Returns list of written paths."""
    series = SCENARIO_SERIES.get(name, [])
    if not series:
        return []

    n = len(series)
    fig, axes = plt.subplots(1 if n == 1 else 2, (n + 1) // 2 if n > 1 else 1, figsize=(12, 5 if n == 1 else 8))
    axes = [axes] if n == 1 else axes.flatten()

    written: list[Path] = []

    for i, key in enumerate(series):
        ax = axes[i]
        values = data.get(key, [])
        if not values:
            ax.set_title(f"{key} (no data)")
            ax.axis("off")
            continue
        x = list(range(len(values)))
        label = key.replace("_history", "").replace("_", " ").title()
        ax.plot(x, values, linewidth=1.5)
        ax.set_title(label)
        ax.set_xlabel("step")
        ax.set_ylabel(label)
        ax.grid(True, alpha=0.3)

    # hide unused subplots
    for j in range(n, len(axes)):
        axes[j].axis("off")

    fig.suptitle(f"Scenario: {name}", fontsize=14, fontweight="bold")
    fig.tight_layout(rect=(0, 0, 1, 0.96))

    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / f"{name}.png"
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    written.append(out_path)

    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Plot simulation results")
    parser.add_argument("--input", required=True, help="JSON produced by simulate.py --output")
    parser.add_argument("--output", default="charts", help="output directory for PNG/SVG")
    parser.add_argument("--scenario", default=None, help="restrict to one scenario")
    parser.add_argument("--svg", action="store_true", help="also write SVG")
    args = parser.parse_args(argv)

    with open(args.input) as f:
        results = json.load(f)

    if not isinstance(results, dict):
        print("error: expected dict {scenario: result}", file=sys.stderr)
        return 2

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    names = [args.scenario] if args.scenario else list(results.keys())
    total_written: list[Path] = []

    for name in names:
        if name not in results:
            print(f"warn: scenario '{name}' not in {args.input}", file=sys.stderr)
            continue

        paths = plot_scenario(name, results[name], output_dir)
        total_written.extend(paths)

    print(f"written {len(total_written)} file(s) to {output_dir}/")
    for p in total_written:
        print(f"  {p}")

    return 0


if __name__ == "__main__":
    sys.exit(main())