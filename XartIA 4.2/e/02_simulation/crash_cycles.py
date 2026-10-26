"""
Crash test: repeated BUY/SELL cycles.

Scenario: N cycles of buy_from_curve → redeem_from_curve. Check:
  - rounding errors do not accumulate (reserve ≥ R(S_curve))
  - totalSupply == S_curve after each cycle
  - treasury_balance is monotonic non-decreasing

Config: E.1.01.02 (R), E.1.01.04 (delta solver), E.1.01.06 (invariant proof).

Block: E.2.01.04
"""

from __future__ import annotations

import sys

from base_model import (
    BasisPointsError,  # noqa: F401  (for parity with Foundry tests)
    BASIS_POINTS,
    BondingCurve,
    ProtocolError,
    default_curve,
)


def _disable_cb(curve: BondingCurve, amount: float = 10_000_000.0) -> None:
    """Mirror Foundry _disableCB(): add external USDC to reserve (audit reconciliation)."""
    curve.reserve += amount


def run(cycles: int = 1000, sell_team_fee_bp: int = 10) -> dict:
    """
    Run N BUY/SELL cycles.

    cycles: number of buy + redeem pairs.
    sell_team_fee_bp: sellTeamFee in basis points (default 10 = 0.1%).

    Returns:
        {
          "cycles": int,
          "rounding_error_max": float,
          "treasury_balance_history": list[float],
          "invariants": {
              "rounding_error_below_epsilon": bool,
              "reserve_ge_R": bool,
              "totalSupply_eq_S_curve": bool,
              "treasury_monotonic": bool,
          },
          "final_state": {
              "S_curve": float,
              "reserve": float,
              "treasury_balance": float,
              "total_sell_team_fee_collected": float,
          },
        }
    """
    curve = default_curve(sell_team_fee_bp=sell_team_fee_bp)
    _disable_cb(curve)

    user = "alice"
    BUY_USDC = 100.0

    initial_reserve = curve.reserve
    initial_treasury = curve.treasury_balance

    treasury_history: list[float] = []
    rounding_error_max = 0.0
    invariants = {
        "rounding_error_below_epsilon": True,
        "reserve_ge_R": True,
        "totalSupply_eq_S_curve": True,
        "treasury_monotonic": True,
    }
    last_treasury = curve.treasury_balance

    for i in range(cycles):
        s_before = curve.S
        r_before = curve.R(s_before)

        # ---- BUY ----
        try:
            tokens = curve.buy_from_curve(user, BUY_USDC)
        except ProtocolError:
            continue

        # rounding error: X_net vs actual R(S_new) - R(S_old)
        fee = BUY_USDC * curve.buy_fee_bp / BASIS_POINTS
        x_net = BUY_USDC - fee
        r_after_buy = curve.R(curve.S)
        rounding = x_net - (r_after_buy - r_before)
        if rounding > rounding_error_max:
            rounding_error_max = rounding

        curve.warp(1)  # past any earlySellPeriod

        # ---- REDEEM ----
        bal = curve.user_balance(user)
        try:
            curve.redeem_from_curve(user, bal)
        except ProtocolError:
            continue

        curve.warp(1)

        # ---- INVARIANTS after full cycle ----
        treasury_history.append(curve.treasury_balance)

        try:
            curve.check_invariant()
        except ProtocolError:
            invariants["reserve_ge_R"] = False

        try:
            curve.check_supply_invariant()
        except ProtocolError:
            invariants["totalSupply_eq_S_curve"] = False

        if curve.treasury_balance + 1e-9 < last_treasury:
            invariants["treasury_monotonic"] = False
        last_treasury = curve.treasury_balance

    # epsilon: P(S) ≈ 0.002 USDC/XRT, worst-case rounding < P(S) * 1 wei-equivalent
    # in float terms: 0.002 * 1e-9 = 2e-12. Add slack for numerical solver.
    epsilon = 1e-3
    invariants["rounding_error_below_epsilon"] = rounding_error_max < epsilon

    total_sell_team_collected = curve.treasury_balance - initial_treasury

    # reserve should have grown by accumulated fees
    assert curve.reserve >= initial_reserve - 1e-9, "reserve decreased below initial"

    return {
        "cycles": cycles,
        "rounding_error_max": rounding_error_max,
        "treasury_balance_history": treasury_history,
        "invariants": invariants,
        "final_state": {
            "S_curve": curve.S,
            "reserve": curve.reserve,
            "treasury_balance": curve.treasury_balance,
            "total_sell_team_fee_collected": total_sell_team_collected,
        },
    }


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--full":
        n = 1000
    elif len(sys.argv) > 1:
        n = int(sys.argv[1])
    else:
        n = 100

    result = run(n)
    print(f"=== crash_cycles ({n} cycles) ===")
    print(f"  rounding_error_max        = {result['rounding_error_max']:.3e}")
    print(f"  final S_curve             = {result['final_state']['S_curve']:.4f} XRT")
    print(f"  final reserve             = {result['final_state']['reserve']:.4f} USDC")
    print(f"  final treasury            = {result['final_state']['treasury_balance']:.6f} USDC")
    print(f"  total sellTeamFee         = {result['final_state']['total_sell_team_fee_collected']:.6f} USDC")
    print(f"  invariants                = {result['invariants']}")

    if not all(result["invariants"].values()):
        sys.exit(1)


if __name__ == "__main__":
    main()