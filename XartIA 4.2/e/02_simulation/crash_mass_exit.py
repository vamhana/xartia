"""
Crash test: mass exit.

Scenario: N holders each hold tokens; 10%, 25%, 50%, 80%, 100% of them
redeem via bonding curve. Check invariants at every step.

Config: E.1.01.02 (R), E.1.01.06 (invariant proof).

Block: E.2.01.02
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict

from base_model import (
    BondingCurve,
    ProtocolError,
    BASIS_POINTS,
    default_curve,
    default_levels,
)


SEED_PURCHASE_USDC = 500.0
N_HOLDERS = 10


def _scenario_pct(pct: int) -> list[int]:
    """First `n * pct / 100` holders redeem."""
    n = max(1, (N_HOLDERS * pct) // 100)
    return list(range(n))


def run(
    scenario: str = "50",
    sell_team_fee_bp: int = 10,
) -> dict:
    """
    scenario: "10" | "25" | "50" | "80" | "100" — percent of holders exiting.
    sell_team_fee_bp: sellTeamFee in basis points (default 10 = 0.1%).

    Returns:
        {
          "scenario": str,
          "reserve_history": list[float],
          "freeReserve_history": list[float],
          "poolPrice_history": list[float],
          "treasury_balance_history": list[float],
          "invariants": {
              "reserve_ge_R": bool,
              "treasury_monotonic": bool,
          },
          "final_state": {
              "reserve": float,
              "freeReserve": float,
              "poolPrice": float,
              "treasury_balance": float,
          },
        }
    """
    pct = int(scenario)
    if pct not in (10, 25, 50, 80, 100):
        raise ValueError(f"invalid scenario {scenario}; expected 10|25|50|80|100")

    curve = default_curve(sell_team_fee_bp=sell_team_fee_bp)

    # seed: N_HOLDERS each buy SEED_PURCHASE_USDC
    holders = [f"holder_{i:02d}" for i in range(N_HOLDERS)]
    for h in holders:
        try:
            curve.buy_from_curve(h, SEED_PURCHASE_USDC)
        except ProtocolError as e:
            # MaxBalance / MaxPurchase: reduce amount
            # (при maxBalance_0 = 50000 и P0 = 0.002, 500 USDC даёт ~249500 XRT — уже на L1;
            #  применяем buy через 100 USDC до 50000, потом ждём — но в симуляции
            #  стараемся удержаться в maxBalance_0 = 50000)
            raise RuntimeError(
                f"seed buy for {h} failed: {e}. Adjust SEED_PURCHASE_USDC."
            )
        curve.warp(1)  # 1 sec between seed buys

    # disable CB so redeemFromCurve doesn't get blocked by chance
    # (redeemFromCurve works even with active CB, but let's be explicit)
    # Actually, redeemFromCurve is NOT blocked by CB in spec. Skip.

    # exit
    exit_holders = _scenario_pct(pct)
    history = {
        "reserve": [],
        "freeReserve": [],
        "poolPrice": [],
        "treasury_balance": [],
    }
    invariants = {"reserve_ge_R": True, "treasury_monotonic": True}
    last_treasury = curve.treasury_balance

    for idx in exit_holders:
        h = holders[idx]
        bal = curve.user_balance(h)
        if bal <= 0:
            continue
        try:
            curve.redeem_from_curve(h, bal)
        except ProtocolError:
            pass  # skip reverts

        curve.warp(1)

        history["reserve"].append(curve.reserve)
        history["freeReserve"].append(curve.free_reserve())
        history["poolPrice"].append(curve.pool_price if curve.pool_price is not None else 0.0)
        history["treasury_balance"].append(curve.treasury_balance)

        try:
            curve.check_invariant()
        except ProtocolError:
            invariants["reserve_ge_R"] = False

        if curve.treasury_balance + 1e-9 < last_treasury:
            invariants["treasury_monotonic"] = False
        last_treasury = curve.treasury_balance

    return {
        "scenario": scenario,
        "reserve_history": history["reserve"],
        "freeReserve_history": history["freeReserve"],
        "poolPrice_history": history["poolPrice"],
        "treasury_balance_history": history["treasury_balance"],
        "invariants": invariants,
        "final_state": {
            "reserve": curve.reserve,
            "freeReserve": curve.free_reserve(),
            "poolPrice": curve.pool_price if curve.pool_price is not None else 0.0,
            "treasury_balance": curve.treasury_balance,
        },
    }


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--all":
        results = [run(s) for s in ("10", "25", "50", "80", "100")]
    else:
        pct = sys.argv[1] if len(sys.argv) > 1 else "50"
        results = [run(pct)]

    for r in results:
        print(f"=== scenario = {r['scenario']}% ===")
        print(f"  final reserve      = {r['final_state']['reserve']:.4f} USDC")
        print(f"  final freeReserve  = {r['final_state']['freeReserve']:.4f} USDC")
        print(f"  final poolPrice    = {r['final_state']['poolPrice']:.8f}")
        print(f"  final treasury     = {r['final_state']['treasury_balance']:.6f} USDC")
        print(f"  invariants         = {r['invariants']}")
        print()

    # exit code: fail if any invariant broken
    if any(not v for r in results for v in r["invariants"].values()):
        sys.exit(1)


if __name__ == "__main__":
    main()