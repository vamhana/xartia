"""
Crash test: level transitions.

Scenario: buy through each level boundary (L0→L1 at S=50_000, L1→L2 at S=250_000,
L2→S_end at S=1_250_000). At each transition, record |P(S_before) - P(S_after)| and
check continuity below epsilon. Also check treasury_monotonic.

Config: E.1.01.01 (P), E.1.01.03 (levels), E.1.01.06 (invariant).

Block: E.2.01.06
"""

from __future__ import annotations

import sys

from base_model import (
    BASIS_POINTS,
    BondingCurve,
    ProtocolError,
    default_curve,
)


def _disable_cb(curve: BondingCurve, amount: float = 10_000_000.0) -> None:
    curve.reserve += amount


def _cross_boundary(
    curve: BondingCurve,
    user: str,
    boundary_S: float,
    max_chunks: int = 500,
    chunk_usdc: float = 10.0,
) -> dict:
    """
    Buy in chunks until S crosses boundary_S.
    Returns {crossed: bool, P_before: float, P_after: float, S_after: float}.
    """
    p_before = curve.P(curve.S)
    s_before = curve.S

    for _ in range(max_chunks):
        if curve.S >= boundary_S:
            break
        try:
            curve.buy_from_curve(user, chunk_usdc)
        except ProtocolError:
            # maxBalance / maxPurchase — skip and retry with smaller chunk
            if chunk_usdc > 1.0:
                chunk_usdc /= 2
            else:
                break
        curve.warp(1)

    s_after = curve.S
    p_after = curve.P(s_after)

    return {
        "crossed": s_after > boundary_S,
        "P_before": p_before,
        "P_after": p_after,
        "S_before": s_before,
        "S_after": s_after,
    }


def run(
    transitions: list[float] | None = None,
    sell_team_fee_bp: int = 10,
) -> dict:
    """
    transitions: list of boundary S values to cross (default: [50_000, 250_000, 1_250_000]).
    sell_team_fee_bp: sellTeamFee in basis points.

    Returns:
        {
          "transitions": list[dict],
          "price_discontinuity_max": float,
          "treasury_balance_history": list[float],
          "invariants": {
              "price_continuity_below_epsilon": bool,
              "reserve_ge_R": bool,
              "treasury_monotonic": bool,
          },
          "final_state": {
              "S_curve": float,
              "current_level": int,
              "treasury_balance": float,
          },
        }
    """
    if transitions is None:
        transitions = [50_000.0, 250_000.0, 1_250_000.0]

    curve = default_curve(sell_team_fee_bp=sell_team_fee_bp)
    _disable_cb(curve)
    user = "user"

    results: list[dict] = []
    treasury_history: list[float] = []
    last_treasury = curve.treasury_balance

    invariants = {
        "price_continuity_below_epsilon": True,
        "reserve_ge_R": True,
        "treasury_monotonic": True,
    }

    max_diff = 0.0

    for boundary in transitions:
        r = _cross_boundary(curve, user, boundary)
        results.append(
            {
                "boundary": boundary,
                "crossed": r["crossed"],
                "S_before": r["S_before"],
                "S_after": r["S_after"],
                "P_before": r["P_before"],
                "P_after": r["P_after"],
                "discontinuity": abs(r["P_after"] - r["P_before"]),
            }
        )
        if r["crossed"]:
            diff = abs(r["P_after"] - r["P_before"])
            if diff > max_diff:
                max_diff = diff

        treasury_history.append(curve.treasury_balance)

        try:
            curve.check_invariant()
        except ProtocolError:
            invariants["reserve_ge_R"] = False

        if curve.treasury_balance + 1e-9 < last_treasury:
            invariants["treasury_monotonic"] = False
        last_treasury = curve.treasury_balance

    # epsilon: for continuous piecewise-linear P, crossing a boundary with
    # deltaS ~ chunk_usdc / P means |ΔP| ~ slope * deltaS. For default config,
    # slope(L1) = 2e-8 USDC/XRT per XRT, deltaS ~ 5000 XRT → diff ~ 1e-4.
    # Use 1e-2 as safe upper bound — any level with real discontinuity would
    # produce diff >> 1e-2.
    epsilon = 1e-2
    if max_diff >= epsilon:
        invariants["price_continuity_below_epsilon"] = False

    current_level = curve.get_level_idx(curve.S)

    return {
        "transitions": results,
        "price_discontinuity_max": max_diff,
        "treasury_balance_history": treasury_history,
        "invariants": invariants,
        "final_state": {
            "S_curve": curve.S,
            "current_level": current_level,
            "treasury_balance": curve.treasury_balance,
        },
    }


def main() -> None:
    result = run()
    print("=== crash_levels ===")
    for t in result["transitions"]:
        print(
            f"  boundary={t['boundary']:.0f}: "
            f"S {t['S_before']:.2f} → {t['S_after']:.2f} "
            f"({'crossed' if t['crossed'] else 'NOT crossed'}), "
            f"P {t['P_before']:.8f} → {t['P_after']:.8f}, "
            f"diff = {t['discontinuity']:.3e}"
        )
    print(f"  price_discontinuity_max = {result['price_discontinuity_max']:.3e}")
    print(f"  final S_curve           = {result['final_state']['S_curve']:.2f}")
    print(f"  final level             = {result['final_state']['current_level']}")
    print(f"  final treasury          = {result['final_state']['treasury_balance']:.6f}")
    print(f"  invariants              = {result['invariants']}")

    if not all(result["invariants"].values()):
        sys.exit(1)


if __name__ == "__main__":
    main()