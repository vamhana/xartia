"""
Calibration: tune level parameters (P0, alpha) against target R(S) values.

Grid search over:
  - P0    ∈ [P0_range[0], P0_range[1]]    (P at S=0, in USDC/XRT)
  - alpha ∈ [alpha_range[0], alpha_range[1]]  (P_end_i / P_start_i for each level)

For each (P0, alpha), build a levels table with fixed S-breaks
[S_0=0, S_1, ..., S_n] and escalating P by (1 + alpha) per level.
Compute R(S_target) for each target, sum squared errors, return best.

Defaults are calibrated against targets that reproduce the default
`config/levels.json` table (3 levels, 100% P-growth per level, P0 = 0.002).

Block: E.3.01.01
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

from base_model import Level, BondingCurve, BASIS_POINTS


# ------------------------------------------------------------------ defaults

DEFAULT_S_BREAKS = [0.0, 50_000.0, 250_000.0, 1_250_000.0]

DEFAULT_TARGETS = {
    "levels_count": 3,
    "targets": [
        {"S": 50_000.0, "R": 100.0},
        {"S": 250_000.0, "R": 700.0},
        {"S": 1_250_000.0, "R": 6_700.0},
    ],
    "P0_range": [0.001, 0.005],
    "P0_steps": 50,
    "alpha_range": [0.5, 2.0],
    "alpha_steps": 50,
    "S_breaks": DEFAULT_S_BREAKS,
}


# ------------------------------------------------------------------ core

@dataclass
class LevelRow:
    S_start: float
    S_end: float
    P_start: float
    P_end: float
    maxBalance: float


def build_levels(S_breaks: list[float], P0: float, alpha: float) -> list[Level]:
    """
    Build levels from fixed S-breaks with P escalating by (1 + alpha) per level.
    P_start_0 = P0.
    """
    if len(S_breaks) < 2:
        raise ValueError("S_breaks must contain at least 2 points")
    if P0 <= 0:
        raise ValueError(f"P0 = {P0} <= 0")
    if alpha < 0:
        raise ValueError(f"alpha = {alpha} < 0")

    levels: list[Level] = []
    p_start = P0
    for i in range(len(S_breaks) - 1):
        s_start = S_breaks[i]
        s_end = S_breaks[i + 1]
        p_end = p_start * (1.0 + alpha)
        levels.append(
            Level(
                S_start=s_start,
                S_end=s_end,
                P_start=p_start,
                P_end=p_end,
                maxBalance=s_end,
            )
        )
        p_start = p_end  # continuity
    return levels


def evaluate(levels: list[Level], targets: list[dict]) -> float:
    """Sum of squared errors of R(S_target) vs target R."""
    c = BondingCurve(levels)
    sse = 0.0
    for t in targets:
        try:
            r = c.R(t["S"])
        except ValueError:
            return float("inf")
        sse += (r - t["R"]) ** 2
    return sse


def tune(targets_json: Optional[dict] = None) -> dict:
    """
    Run grid search. Returns:
        {
          "P0": float,
          "alpha": float,
          "levels": [ {S_start, S_end, P_start, P_end, maxBalance}, ... ],
          "sse": float,
          "forecast": [ {S, R, P}, ... ],
          "iterations": int,
          "target_sse": [ {S, R_target, R_actual, error}, ... ],
        }
    """
    cfg = dict(DEFAULT_TARGETS)
    if targets_json is not None:
        cfg.update(targets_json)

    s_breaks = cfg["S_breaks"]
    targets = cfg["targets"]

    p0_lo, p0_hi = cfg["P0_range"]
    a_lo, a_hi = cfg["alpha_range"]
    p0_steps = int(cfg["P0_steps"])
    a_steps = int(cfg["alpha_steps"])

    best: dict = {"sse": float("inf"), "P0": None, "alpha": None, "levels": None}
    iterations = 0

    for i in range(p0_steps):
        p0 = p0_lo + (p0_hi - p0_lo) * i / max(1, p0_steps - 1)
        for j in range(a_steps):
            alpha = a_lo + (a_hi - a_lo) * j / max(1, a_steps - 1)
            iterations += 1
            try:
                levels = build_levels(s_breaks, p0, alpha)
            except ValueError:
                continue
            sse = evaluate(levels, targets)
            if sse < best["sse"]:
                best["sse"] = sse
                best["P0"] = p0
                best["alpha"] = alpha
                best["levels"] = levels

    if best["levels"] is None:
        raise RuntimeError("calibration produced no valid levels")

    # target breakdown
    c = BondingCurve(best["levels"])
    target_sse = []
    for t in targets:
        try:
            r = c.R(t["S"])
        except ValueError:
            r = float("nan")
        target_sse.append(
            {
                "S": t["S"],
                "R_target": t["R"],
                "R_actual": r,
                "error": r - t["R"],
            }
        )

    # forecast: P and R every 10% of last S_break
    last_s = s_breaks[-1]
    forecast = []
    for k in range(1, 11):
        s = last_s * k / 10
        try:
            forecast.append({"S": s, "P": c.P(s), "R": c.R(s)})
        except ValueError:
            pass

    return {
        "P0": best["P0"],
        "alpha": best["alpha"],
        "levels": [asdict(l) for l in best["levels"]],
        "sse": best["sse"],
        "iterations": iterations,
        "target_sse": target_sse,
        "forecast": forecast,
    }


def main() -> None:
    """
    Usage:
        python tune_params.py [--targets targets.json] [--output out/]
    """
    args = sys.argv[1:]
    targets_path = None
    output_dir = "e/03_calibration"

    i = 0
    while i < len(args):
        if args[i] == "--targets" and i + 1 < len(args):
            targets_path = args[i + 1]
            i += 2
        elif args[i] == "--output" and i + 1 < len(args):
            output_dir = args[i + 1]
            i += 2
        else:
            print(f"unknown arg: {args[i]}", file=sys.stderr)
            sys.exit(2)

    targets_json = None
    if targets_path:
        with open(targets_path) as f:
            targets_json = json.load(f)

    result = tune(targets_json)

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    json_path = out / "params_output.json"
    with open(json_path, "w") as f:
        json.dump(result, f, indent=2)

    print(f"=== calibration ===")
    print(f"  iterations  = {result['iterations']}")
    print(f"  P0          = {result['P0']:.8f} USDC/XRT")
    print(f"  alpha       = {result['alpha']:.6f}")
    print(f"  sse         = {result['sse']:.6e}")
    print(f"  levels:")
    for i, l in enumerate(result["levels"]):
        print(
            f"    [{i}] S=[{l['S_start']:.0f}, {l['S_end']:.0f}]  "
            f"P=[{l['P_start']:.6f}, {l['P_end']:.6f}]  "
            f"maxBalance={l['maxBalance']:.0f}"
        )
    print(f"  target breakdown:")
    for t in result["target_sse"]:
        print(
            f"    S={t['S']:>10.0f}  R_target={t['R_target']:>10.2f}  "
            f"R_actual={t['R_actual']:>10.4f}  error={t['error']:>+10.4f}"
        )
    print(f"\nwritten: {json_path}")


if __name__ == "__main__":
    main()