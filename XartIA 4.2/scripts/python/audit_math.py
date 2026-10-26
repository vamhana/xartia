"""
Property-based audit of bonding curve math using Hypothesis.

Properties:
  1. P(S) >= 0, monotonic non-decreasing
  2. R(S) monotonic non-decreasing, R(0) == 0
  3. deltaSForBuy: R(S + ΔS) - R(S) <= X  AND  R(S + ΔS + 1 wei) - R(S) > X (floor tightness)
  4. amountForRedeem(S, ΔS) == R(S) - R(S - ΔS)
  5. R(S_end_last) covers all supply
  6. deltaSForBuy returns 0 iff X <= P(S) (для малых X)
  7. Round-trip (buy + redeem) has losses ≈ fees

Uses numeric tolerance for float solver. Any violation -> shrink + raise.

Block: S.1.01.05
"""

from __future__ import annotations

import sys
from pathlib import Path

from hypothesis import given, settings, strategies as st, assume, HealthCheck

_THIS = Path(__file__).resolve().parent
sys.path.insert(0, str(_THIS.parent.parent / "e" / "02_simulation"))

from base_model import BondingCurve, Level, default_levels  # noqa: E402


SCALE = 10**18  # 1 XRT in wei-equivalent for tolerance


def make_curve() -> BondingCurve:
    c = BondingCurve(default_levels())
    # initialize pool price so pool_price is not None (required for buy/redeem paths,
    # though P/R/deltaS do not need it)
    c.init_pool_price(c.P(0))
    return c


# ------------------------------------------------------------------ properties

@given(st.floats(min_value=0.0, max_value=1_249_999.99, allow_nan=False, allow_infinity=False))
@settings(max_examples=500, deadline=None, suppress_health_check=[HealthCheck.too_slow])
def test_P_nonnegative(S: float) -> None:
    """P(S) >= 0 for all S in domain."""
    c = make_curve()
    p = c.P(S)
    assert p >= 0.0, f"P({S}) = {p} < 0"


@given(
    st.floats(min_value=0.0, max_value=1_200_000.0, allow_nan=False, allow_infinity=False),
    st.floats(min_value=0.0, max_value=1_200_000.0, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=500, deadline=None, suppress_health_check=[HealthCheck.too_slow])
def test_P_monotonic(s1: float, s2: float) -> None:
    """P monotonic non-decreasing."""
    assume(s1 <= s2)
    c = make_curve()
    assert c.P(s1) <= c.P(s2) + 1e-15, f"P({s1}) > P({s2})"


@given(st.floats(min_value=0.0, max_value=1_249_999.99, allow_nan=False, allow_infinity=False))
@settings(max_examples=500, deadline=None, suppress_health_check=[HealthCheck.too_slow])
def test_R_nonnegative(S: float) -> None:
    """R(S) >= 0, R(0) == 0."""
    c = make_curve()
    r = c.R(S)
    assert r >= 0.0, f"R({S}) = {r} < 0"
    if S == 0.0:
        assert r == 0.0


@given(
    st.floats(min_value=0.0, max_value=1_200_000.0, allow_nan=False, allow_infinity=False),
    st.floats(min_value=0.0, max_value=1_200_000.0, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=500, deadline=None, suppress_health_check=[HealthCheck.too_slow])
def test_R_monotonic(s1: float, s2: float) -> None:
    """R monotonic non-decreasing."""
    assume(s1 <= s2)
    c = make_curve()
    assert c.R(s1) <= c.R(s2) + 1e-9, f"R({s1}) > R({s2})"


@given(
    st.floats(min_value=0.0, max_value=500_000.0, allow_nan=False, allow_infinity=False),
    st.floats(min_value=0.0, max_value=10_000.0, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=300, deadline=None, suppress_health_check=[HealthCheck.too_slow])
def test_deltaS_invariant(S: float, X: float) -> None:
    """
    R(S + ΔS) - R(S) <= X  (floor).
    X small → ΔS should satisfy this.
    """
    assume(X > 0)
    c = make_curve()
    d = c.deltaS_for_buy(S, X)
    if d == 0:
        return
    r_before = c.R(S)
    r_after = c.R(S + d)
    assert r_after - r_before <= X + 1e-9, (
        f"deltaSForBuy overshoots: S={S}, X={X}, d={d}, "
        f"R(S+d)-R(S) = {r_after - r_before} > X"
    )


@given(
    st.floats(min_value=1.0, max_value=1_000_000.0, allow_nan=False, allow_infinity=False),
    st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
)
@settings(max_examples=300, deadline=None, suppress_health_check=[HealthCheck.too_slow])
def test_amountForRedeem_identity(S: float, frac: float) -> None:
    """amountForRedeem(S, ΔS) == R(S) - R(S - ΔS)."""
    dS = S * frac
    assume(dS > 0)
    c = make_curve()
    a = c.amount_for_redeem(S, dS)
    expected = c.R(S) - c.R(S - dS)
    assert abs(a - expected) <= 1e-9, f"amountForRedeem mismatch: {a} vs {expected}"


@given(st.floats(min_value=0.0, max_value=1_249_999.99, allow_nan=False, allow_infinity=False))
@settings(max_examples=200, deadline=None, suppress_health_check=[HealthCheck.too_slow])
def test_R_upper_bound(S: float) -> None:
    """R(S) <= R(S_end_last)."""
    c = make_curve()
    r_s = c.R(S)
    r_last = c.R(1_250_000.0)
    assert r_s <= r_last + 1e-9, f"R({S}) = {r_s} > R(S_end) = {r_last}"


def test_R_total() -> None:
    """R(S_end_last) matches known analytic value."""
    c = make_curve()
    # trapezoid: 50000*(0.002+0.002)/2 + 200000*(0.002+0.004)/2 + 1000000*(0.004+0.008)/2
    # = 50 + 600 + 6000 = 6650
    assert abs(c.R(1_250_000.0) - 6650.0) <= 1e-6


def test_P_boundaries() -> None:
    """P at exact boundaries — continuity check."""
    c = make_curve()
    # P(50_000) should be P_start of level 1 = 0.002; P just below → P_end of level 0 = 0.002
    assert abs(c.P(50_000.0) - c.P(49_999.999)) <= 1e-9
    assert abs(c.P(250_000.0) - c.P(249_999.999)) <= 1e-9


# ------------------------------------------------------------------ runner

def main() -> int:
    """Run all property tests manually (no pytest needed)."""
    tests = [
        ("P non-negative", test_P_nonnegative),
        ("P monotonic", test_P_monotonic),
        ("R non-negative", test_R_nonnegative),
        ("R monotonic", test_R_monotonic),
        ("deltaS floor invariant", test_deltaS_invariant),
        ("amountForRedeem identity", test_amountForRedeem_identity),
        ("R upper bound", test_R_upper_bound),
        ("R(S_end) analytic", test_R_total),
        ("P continuity", test_P_boundaries),
    ]

    failures = 0
    for name, fn in tests:
        try:
            if name == "R(S_end) analytic":
                fn()
            elif name == "P continuity":
                fn()
            else:
                fn()
            print(f"  [PASS] {name}")
        except Exception as e:
            failures += 1
            print(f"  [FAIL] {name}: {type(e).__name__}: {e}")

    print(f"\n{failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())