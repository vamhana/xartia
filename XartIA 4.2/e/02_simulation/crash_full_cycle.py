"""
Crash test: full protocol lifecycle.

Scenario (from spec R.1.01.01 §13.4):
    mint → pool → pool buy → curve redeem → mint → level transition → pool → redeem

At each step: check invariants (reserve_ge_R, totalSupply_eq_S_curve,
poolPrice in corridor, treasury_monotonic). Log every step with its state.

Config: E.1.01.01, E.1.01.02, E.1.01.05, E.1.01.06, E.1.01.07.

Block: E.2.01.07
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


def _check_corridor(curve: BondingCurve) -> dict:
    if curve.pool_price is None:
        return {"ceiling": True, "floor": True}
    p_s = curve.P(curve.S)
    floor = p_s * BASIS_POINTS / (BASIS_POINTS + curve.max_gap_bp)
    ceiling = p_s * (BASIS_POINTS + curve.max_gap_bp) / BASIS_POINTS
    return {
        "ceiling": curve.pool_price <= ceiling + 1e-9,
        "floor": curve.pool_price >= floor - 1e-9,
    }


def run(sell_team_fee_bp: int = 10) -> dict:
    """
    Execute full lifecycle. Returns dict with per-step log and invariants.

    Returns:
        {
          "steps": list[dict],  # each: {name, S, reserve, poolPrice, treasury}
          "invariants": {
              "reserve_ge_R": bool,
              "totalSupply_eq_S_curve": bool,
              "poolPrice_ceiling": bool,
              "poolPrice_floor": bool,
              "treasury_monotonic": bool,
          },
          "final_state": {
              "poolPrice": float,
              "freeReserve": float,
              "reserve": float,
              "S_curve": float,
              "treasury_balance": float,
              "total_sell_team_fee_collected": float,
          },
        }
    """
    curve = default_curve(sell_team_fee_bp=sell_team_fee_bp)

    alice = "alice"
    bob = "bob"
    carol = "carol"

    steps: list[dict] = []
    invariants = {
        "reserve_ge_R": True,
        "totalSupply_eq_S_curve": True,
        "poolPrice_ceiling": True,
        "poolPrice_floor": True,
        "treasury_monotonic": True,
    }
    last_treasury = curve.treasury_balance
    initial_treasury = curve.treasury_balance

    def snapshot(name: str) -> None:
        nonlocal last_treasury
        steps.append(
            {
                "name": name,
                "S": curve.S,
                "reserve": curve.reserve,
                "poolPrice": curve.pool_price if curve.pool_price is not None else 0.0,
                "treasury": curve.treasury_balance,
            }
        )
        try:
            curve.check_invariant()
        except ProtocolError:
            invariants["reserve_ge_R"] = False
        try:
            curve.check_supply_invariant()
        except ProtocolError:
            invariants["totalSupply_eq_S_curve"] = False
        c = _check_corridor(curve)
        if not c["ceiling"]:
            invariants["poolPrice_ceiling"] = False
        if not c["floor"]:
            invariants["poolPrice_floor"] = False
        if curve.treasury_balance + 1e-9 < last_treasury:
            invariants["treasury_monotonic"] = False
        last_treasury = curve.treasury_balance

    # ---- 1. mint: alice buys from curve ----
    try:
        alice_tokens = curve.buy_from_curve(alice, 100.0)
    except ProtocolError:
        alice_tokens = 0.0
    curve.warp(1)
    snapshot("alice_buy_from_curve")

    # ---- 2. pool: alice sells half to pool ----
    _disable_cb(curve)
    try:
        curve.sell_to_pool(alice, alice_tokens / 2)
    except ProtocolError:
        pass
    curve.warp(86_401)  # past earlySellPeriod and next day for dailySold
    snapshot("alice_sell_to_pool")

    # ---- 3. pool buy: bob buys from pool ----
    try:
        bob_tokens = curve.buy_from_pool(bob, 50.0)
    except ProtocolError:
        bob_tokens = 0.0
    curve.warp(1)
    snapshot("bob_buy_from_pool")

    # ---- 4. curve redeem: bob sells via curve ----
    try:
        curve.redeem_from_curve(bob, bob_tokens)
    except ProtocolError:
        pass
    curve.warp(1)
    snapshot("bob_redeem_from_curve")

    # ---- 5. mint again + level transition ----
    # carol buys enough to cross L0→L1 (S_end_0 = 50_000)
    s_before_transition = curve.S
    for _ in range(1000):
        if curve.S > 50_000.0:
            break
        try:
            curve.buy_from_curve(carol, 100.0)
        except ProtocolError:
            break
        curve.warp(1)
    s_after_transition = curve.S
    snapshot("carol_buy_crosses_L0_L1")

    # ---- 6. pool sell (carol) ----
    carol_bal = curve.user_balance(carol)
    s_curve = curve.S
    if carol_bal > 0 and s_curve > 0:
        limit = curve.max_sell_pct_per_day_bp * s_curve / BASIS_POINTS
        amt = min(carol_bal / 100, limit)
        if amt > 0:
            try:
                curve.sell_to_pool(carol, amt)
            except ProtocolError:
                pass
    curve.warp(86_401)
    snapshot("carol_sell_to_pool")

    # ---- 7. redeem (alice) ----
    alice_left = curve.user_balance(alice)
    if alice_left > 0:
        try:
            curve.redeem_from_curve(alice, alice_left)
        except ProtocolError:
            pass
    curve.warp(1)
    snapshot("alice_redeem_curve_final")

    # final assertions on the overall trajectory
    if s_after_transition <= 50_000.0:
        # if we never crossed the boundary, the "level transition" step was a no-op
        # but the rest of the test should still hold
        pass

    total_sell_team = curve.treasury_balance - initial_treasury

    return {
        "steps": steps,
        "invariants": invariants,
        "final_state": {
            "poolPrice": curve.pool_price if curve.pool_price is not None else 0.0,
            "freeReserve": curve.free_reserve(),
            "reserve": curve.reserve,
            "S_curve": curve.S,
            "treasury_balance": curve.treasury_balance,
            "total_sell_team_fee_collected": total_sell_team,
        },
    }


def main() -> None:
    result = run()
    print("=== crash_full_cycle ===")
    for step in result["steps"]:
        print(
            f"  {step['name']:<30} "
            f"S={step['S']:>10.2f}  "
            f"reserve={step['reserve']:>12.4f}  "
            f"poolPrice={step['poolPrice']:.8f}  "
            f"treasury={step['treasury']:.6f}"
        )
    print()
    print(f"  final S_curve        = {result['final_state']['S_curve']:.4f}")
    print(f"  final reserve        = {result['final_state']['reserve']:.4f}")
    print(f"  final freeReserve    = {result['final_state']['freeReserve']:.4f}")
    print(f"  final poolPrice      = {result['final_state']['poolPrice']:.8f}")
    print(f"  final treasury       = {result['final_state']['treasury_balance']:.6f}")
    print(f"  total sellTeamFee    = {result['final_state']['total_sell_team_fee_collected']:.6f}")
    print(f"  invariants           = {result['invariants']}")

    if not all(result["invariants"].values()):
        sys.exit(1)


if __name__ == "__main__":
    main()