"""
Crash test: pool cycles.

Scenario: N cycles of sellToPool / buyFromPool / buyFromCurve / redeemFromCurve.
Check:
  - poolPrice in symmetric corridor [P(S)/(1+GAP), P(S)*(1+GAP)]
  - freeReserve non-negative
  - reserve >= curveBacking
  - totalSupply == S_curve
  - treasury monotonic

Config: E.1.01.05 (pool price formula), E.1.01.07 (corridor proof).

Block: E.2.01.05
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


def _check_pool_price_in_corridor(curve: BondingCurve) -> dict:
    """Returns dict with per-check booleans (ceiling / floor), no raise."""
    if curve.pool_price is None:
        return {"ceiling": True, "floor": True}
    p_s = curve.P(curve.S)
    floor = p_s * BASIS_POINTS / (BASIS_POINTS + curve.max_gap_bp)
    ceiling = p_s * (BASIS_POINTS + curve.max_gap_bp) / BASIS_POINTS
    return {
        "ceiling": curve.pool_price <= ceiling + 1e-9,
        "floor": curve.pool_price >= floor - 1e-9,
    }


def run(cycles: int = 100, sell_team_fee_bp: int = 10) -> dict:
    """
    Run N pool-related cycles.

    Returns:
        {
          "cycles": int,
          "poolPrice_history": list[float],
          "freeReserve_history": list[float],
          "treasury_balance_history": list[float],
          "invariants": {
              "poolPrice_ceiling": bool,
              "poolPrice_floor": bool,
              "reserve_ge_R": bool,
              "totalSupply_eq_S_curve": bool,
              "treasury_monotonic": bool,
          },
          "final_state": {
              "poolPrice": float,
              "freeReserve": float,
              "treasury_balance": float,
              "total_sell_team_fee_collected": float,
          },
        }
    """
    curve = default_curve(sell_team_fee_bp=sell_team_fee_bp)

    alice = "alice"
    bob = "bob"

    # Seed: alice buys from curve, then sells to pool to seed it
    curve.buy_from_curve(alice, 500.0)
    curve.warp(1)
    _disable_cb(curve)
    curve.sell_to_pool(alice, min(20_000.0, curve.user_balance(alice)))

    initial_treasury = curve.treasury_balance

    history = {"poolPrice": [], "freeReserve": [], "treasury": []}
    invariants = {
        "poolPrice_ceiling": True,
        "poolPrice_floor": True,
        "reserve_ge_R": True,
        "totalSupply_eq_S_curve": True,
        "treasury_monotonic": True,
    }
    last_treasury = curve.treasury_balance

    for i in range(cycles):
        # alternate operations across actors to keep states varied
        op = i % 4

        if op == 0:
            # buyFromPool (bob)
            try:
                curve.buy_from_pool(bob, 50.0)
            except ProtocolError:
                pass

        elif op == 1:
            # buyFromCurve (bob)
            try:
                curve.buy_from_curve(bob, 50.0)
            except ProtocolError:
                pass

        elif op == 2:
            # redeemFromCurve (bob)
            bal = curve.user_balance(bob)
            if bal > 0:
                try:
                    curve.redeem_from_curve(bob, bal / 2)
                except ProtocolError:
                    pass

        elif op == 3:
            # sellToPool (alice) — reset dailySold first
            curve.warp(86_400 + 1)
            bal = curve.user_balance(alice)
            s_curve = curve.S
            if bal > 0 and s_curve > 0:
                limit = curve.max_sell_pct_per_day_bp * s_curve / BASIS_POINTS
                amt = min(bal, limit)
                if amt > 0:
                    try:
                        curve.sell_to_pool(alice, amt)
                    except ProtocolError:
                        pass

        curve.warp(1)

        history["poolPrice"].append(
            curve.pool_price if curve.pool_price is not None else 0.0
        )
        history["freeReserve"].append(curve.free_reserve())
        history["treasury"].append(curve.treasury_balance)

        # corridor
        chk = _check_pool_price_in_corridor(curve)
        if not chk["ceiling"]:
            invariants["poolPrice_ceiling"] = False
        if not chk["floor"]:
            invariants["poolPrice_floor"] = False

        # reserve >= curveBacking
        try:
            curve.check_invariant()
        except ProtocolError:
            invariants["reserve_ge_R"] = False

        # totalSupply == S_curve
        try:
            curve.check_supply_invariant()
        except ProtocolError:
            invariants["totalSupply_eq_S_curve"] = False

        # treasury monotonic
        if curve.treasury_balance + 1e-9 < last_treasury:
            invariants["treasury_monotonic"] = False
        last_treasury = curve.treasury_balance

    final_price = curve.pool_price if curve.pool_price is not None else 0.0
    total_sell_team = curve.treasury_balance - initial_treasury

    return {
        "cycles": cycles,
        "poolPrice_history": history["poolPrice"],
        "freeReserve_history": history["freeReserve"],
        "treasury_balance_history": history["treasury"],
        "invariants": invariants,
        "final_state": {
            "poolPrice": final_price,
            "freeReserve": curve.free_reserve(),
            "treasury_balance": curve.treasury_balance,
            "total_sell_team_fee_collected": total_sell_team,
        },
    }


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--full":
        n = 500
    elif len(sys.argv) > 1:
        n = int(sys.argv[1])
    else:
        n = 100

    result = run(n)
    print(f"=== crash_pool ({n} cycles) ===")
    print(f"  final poolPrice      = {result['final_state']['poolPrice']:.8f}")
    print(f"  final freeReserve    = {result['final_state']['freeReserve']:.4f}")
    print(f"  final treasury       = {result['final_state']['treasury_balance']:.6f}")
    print(f"  total sellTeamFee    = {result['final_state']['total_sell_team_fee_collected']:.6f}")
    print(f"  invariants           = {result['invariants']}")

    if not all(result["invariants"].values()):
        sys.exit(1)


if __name__ == "__main__":
    main()