"""
Base Python model of XartIA bonding curve protocol.

Reference implementation for cross-verification against Solidity
(see S.1.01.03 verify_math.py). Works in human units (XRT, USDC),
not in 18-dec wei — float64 cannot represent 1e18 precisely.

Config: E.1.01.01 (P), E.1.01.02 (R), E.1.01.04 (ΔS solver),
        E.1.01.05 (poolPrice), E.1.01.06 (invariants), E.1.01.07 (corridor proof).

Block: E.2.01.01
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional


BASIS_POINTS = 10_000


@dataclass
class Level:
    """One segment of the bonding curve. See E.1.01.03."""
    S_start: float
    S_end: float
    P_start: float
    P_end: float
    maxBalance: float

    def validate(self) -> None:
        if self.S_end <= self.S_start:
            raise ValueError(f"Level: S_end ({self.S_end}) <= S_start ({self.S_start})")
        if self.P_end < self.P_start:
            raise ValueError(f"Level: P_end ({self.P_end}) < P_start ({self.P_start})")
        if self.P_start <= 0:
            raise ValueError(f"Level: P_start ({self.P_start}) <= 0")


class ProtocolError(Exception):
    """Base for protocol-level revert conditions (analog of Solidity custom errors)."""


class NotInitialized(ProtocolError):
    pass


class InvalidAmount(ProtocolError):
    pass


class MinimalPurchaseNotMet(ProtocolError):
    pass


class MaxPurchaseExceeded(ProtocolError):
    pass


class MaxBalanceExceeded(ProtocolError):
    pass


class MaxSellPerDayExceeded(ProtocolError):
    pass


class SlippageExceeded(ProtocolError):
    pass


class DeadlineExpired(ProtocolError):
    pass


class CircuitBreakerActive(ProtocolError):
    pass


class InsufficientFreeReserve(ProtocolError):
    pass


class InsufficientBalance(ProtocolError):
    pass


class MaxCurveForExceeded(ProtocolError):
    pass


class ReserveInvariantViolation(ProtocolError):
    pass


class BondingCurve:
    """
    Модель XartIA: bonding curve + пул + резерв + treasury.

    State:
        S             — S_curve (XRT)
        reserve       — USDC в ReserveManager
        pool          — XRT в PoolController
        pool_price    — USDC/XRT в пуле (None до init)
        treasury_balance — накопленный sellTeamFee (USDC)
        vesting       — teamTokens, удерживаемые Vesting (XRT)
        user_credits  — dict[user] -> баланс XRT
        total_supply  — общий supply XRT (сумма всех балансов)
        time          — виртуальное время (секунды, для earlySellFee / dailySold)
    """

    def __init__(
        self,
        levels: list[Level],
        buy_fee_bp: int = 50,
        redeem_fee_bp: int = 50,
        early_sell_fee_bp: int = 0,
        early_sell_period_sec: float = 0.0,
        sell_team_fee_bp: int = 10,
        team_percent_bp: int = 50,
        max_purchase_pct_bp: int = 500,
        max_sell_pct_per_day_bp: int = 200,
        cb_threshold_bp: int = 1000,
        max_gap_bp: int = 1000,
        k_mult_bp: int = 15_000,
        max_sold_pct_bp: int = 100,
        max_curve_for_pct_bp: int = 2000,
        minimal_purchase_usdc: float = 1.0,
    ):
        if not levels:
            raise ValueError("levels must be non-empty")
        for i, l in enumerate(levels):
            l.validate()
            if i > 0:
                prev = levels[i - 1]
                if abs(l.S_start - prev.S_end) > 1e-9:
                    raise ValueError(
                        f"Level {i}: S_start ({l.S_start}) != S_end_{i-1} ({prev.S_end})"
                    )
                if abs(l.P_start - prev.P_end) > 1e-18:
                    raise ValueError(
                        f"Level {i}: P_start ({l.P_start}) != P_end_{i-1} ({prev.P_end})"
                    )

        self.levels = levels

        self.buy_fee_bp = buy_fee_bp
        self.redeem_fee_bp = redeem_fee_bp
        self.early_sell_fee_bp = early_sell_fee_bp
        self.early_sell_period_sec = early_sell_period_sec
        self.sell_team_fee_bp = sell_team_fee_bp
        self.team_percent_bp = team_percent_bp
        self.max_purchase_pct_bp = max_purchase_pct_bp
        self.max_sell_pct_per_day_bp = max_sell_pct_per_day_bp
        self.cb_threshold_bp = cb_threshold_bp
        self.max_gap_bp = max_gap_bp
        self.k_mult_bp = k_mult_bp
        self.max_sold_pct_bp = max_sold_pct_bp
        self.max_curve_for_pct_bp = max_curve_for_pct_bp
        self.minimal_purchase_usdc = minimal_purchase_usdc

        # mutable state
        self.S: float = 0.0
        self.reserve: float = 0.0
        self.pool: float = 0.0
        self.pool_price: Optional[float] = None
        self.treasury_balance: float = 0.0
        self.vesting: float = 0.0
        self.total_supply: float = 0.0
        self.user_credits: dict[str, float] = {}
        self.time: float = 0.0

        # earlySell / dailySold
        self.last_buy_time: dict[str, float] = {}
        self.daily_sold: dict[str, float] = {}
        self.last_reset_day: dict[str, int] = {}

    # ------------------------------------------------------------------ init

    def init_pool_price(self, initial_price: float) -> None:
        if initial_price <= 0:
            raise InvalidAmount("initial pool price must be > 0")
        if self.pool_price is not None:
            raise ValueError("pool price already initialized")
        if self.S != 0:
            raise ValueError(f"genesis gate: S_curve = {self.S} != 0")
        p_s0 = self.P(0.0)
        if p_s0 <= 0:
            raise ValueError(f"P(0) = {p_s0} <= 0")
        lower = p_s0 * BASIS_POINTS / (BASIS_POINTS + self.max_gap_bp)
        upper = p_s0 * (BASIS_POINTS + self.max_gap_bp) / BASIS_POINTS
        if not (lower <= initial_price <= upper):
            raise ValueError(
                f"initial price {initial_price} outside [{lower}, {upper}]"
            )
        self.pool_price = initial_price

    # ------------------------------------------------------------------ curve math

    def get_level_idx(self, S: float) -> int:
        n = len(self.levels)
        for i, l in enumerate(self.levels):
            if S < l.S_end:
                return i
        return n - 1

    def P(self, S: float) -> float:
        """E.1.01.01: piecewise-linear price at S."""
        if S < 0:
            raise ValueError(f"S = {S} < 0")
        i = self.get_level_idx(S)
        l = self.levels[i]
        D = l.S_end - l.S_start
        if D <= 0:
            return l.P_start
        if S <= l.S_start:
            return l.P_start
        if S >= l.S_end:
            return l.P_end
        d = S - l.S_start
        return l.P_start + (l.P_end - l.P_start) * d / D

    def _R_i(self, S: float, l: Level) -> float:
        """E.1.01.02: integral of P_i from S_start to S (clamped to S_end)."""
        D = l.S_end - l.S_start
        if D <= 0:
            return 0.0
        if S <= l.S_start:
            return 0.0
        capped = min(S, l.S_end)
        d = capped - l.S_start
        linear = l.P_start * d
        quad = (l.P_end - l.P_start) * d * d / (2 * D)
        return linear + quad

    def R(self, S: float) -> float:
        """E.1.01.02: cumulative integral of P from 0 to S."""
        if S == 0:
            return 0.0
        if S < 0:
            raise ValueError(f"S = {S} < 0")
        last = self.levels[-1].S_end
        if S > last + 1e-9:
            raise ValueError(f"S = {S} > S_end_last = {last}")
        acc = 0.0
        for l in self.levels:
            if S <= l.S_start:
                break
            if S >= l.S_end:
                acc += self._R_i(l.S_end, l)
            else:
                acc += self._R_i(S, l)
                break
        return acc

    def deltaS_for_buy(self, S: float, X: float) -> float:
        """
        E.1.01.04: solve R(S + ΔS) - R(S) = X for ΔS, with floor rounding.
        Returns the maximum ΔS such that R(S + ΔS) - R(S) <= X.
        If X exceeds remaining supply, returns S_end_last - S.
        """
        if X <= 0:
            return 0.0
        current_S = S
        remaining_X = X
        start_level = self.get_level_idx(S)

        for i in range(start_level, len(self.levels)):
            l = self.levels[i]
            s_end = l.S_end
            if current_S >= s_end:
                continue
            cap_x = self._R_i(s_end, l) - self._R_i(current_S, l)
            if remaining_X < cap_x:
                d = self._solve_on_level(current_S, remaining_X, l)
                return (current_S - S) + d
            remaining_X -= cap_x
            current_S = s_end
        return current_S - S

    def _solve_on_level(self, current_S: float, X: float, l: Level) -> float:
        max_d = l.S_end - current_S
        p_s = l.P_start + (l.P_end - l.P_start) * (current_S - l.S_start) / (l.S_end - l.S_start)
        if p_s <= 0:
            raise ValueError("MathOverflow: P(S) <= 0")

        upper = min(X / p_s, max_d)
        if upper <= 0:
            return 0.0

        r_start = self._R_i(current_S, l)
        if self._R_i(current_S + upper, l) - r_start <= X:
            return upper

        # binary search with numeric tolerance
        lo = 0.0
        hi = upper
        for _ in range(200):
            mid = (lo + hi) / 2
            if self._R_i(current_S + mid, l) - r_start <= X:
                lo = mid
            else:
                hi = mid
            if hi - lo < 1e-12 * max(1.0, current_S):
                break
        return lo

    def amount_for_redeem(self, S: float, deltaS: float) -> float:
        """E.1.01.02: R(S) - R(S - ΔS)."""
        if deltaS <= 0:
            return 0.0
        if deltaS > S + 1e-9:
            raise InvalidAmount(f"deltaS = {deltaS} > S = {S}")
        return self.R(S) - self.R(S - deltaS)

    # ------------------------------------------------------------------ views

    def free_reserve(self) -> float:
        cb = self.R(self.S)
        return max(0.0, self.reserve - cb)

    def curve_backing(self) -> float:
        return self.R(self.S)

    def user_balance(self, user: str) -> float:
        return self.user_credits.get(user, 0.0)

    def circuit_breaker_active(self) -> bool:
        r = self.reserve
        if r <= 0:
            return False
        fr = self.free_reserve()
        return fr * BASIS_POINTS / r < self.cb_threshold_bp

    def effective_minimal_x6(self) -> float:
        bp = BASIS_POINTS
        return math.ceil(self.minimal_purchase_usdc * bp / (bp - self.buy_fee_bp) * 1e6) / 1e6

    # ------------------------------------------------------------------ invariant checks

    def check_invariant(self) -> None:
        """E.1.01.06: reserve >= curveBacking."""
        cb = self.curve_backing()
        if self.reserve + 1e-9 < cb:
            raise ReserveInvariantViolation(
                f"reserve {self.reserve} < R(S) {cb} (S = {self.S})"
            )

    def check_supply_invariant(self) -> None:
        total = sum(self.user_credits.values()) + self.vesting + self.pool
        if abs(total - self.total_supply) > 1e-6:
            raise ValueError(
                f"total_supply invariant broken: sum {total} != S {self.total_supply}"
            )

    def check_pool_price_invariant(self) -> None:
        """E.1.01.07: poolPrice in corridor."""
        if self.pool_price is None:
            return
        p_s = self.P(self.S)
        floor = p_s * BASIS_POINTS / (BASIS_POINTS + self.max_gap_bp)
        ceiling = p_s * (BASIS_POINTS + self.max_gap_bp) / BASIS_POINTS
        if self.pool_price + 1e-9 < floor:
            raise ValueError(f"poolPrice {self.pool_price} < floor {floor}")
        if self.pool_price - 1e-9 > ceiling:
            raise ValueError(f"poolPrice {self.pool_price} > ceiling {ceiling}")

    # ------------------------------------------------------------------ mutations

    def warp(self, dt: float) -> None:
        if dt < 0:
            raise ValueError("warp: negative dt")
        self.time += dt

    def buy_from_curve(
        self,
        user: str,
        x_usdc: float,
        min_tokens_out: float = 0.0,
        deadline: Optional[float] = None,
    ) -> float:
        if self.pool_price is None:
            raise NotInitialized()
        if deadline is not None and self.time > deadline:
            raise DeadlineExpired()
        if x_usdc < self.effective_minimal_x6():
            raise MinimalPurchaseNotMet()
        if x_usdc <= 0:
            raise InvalidAmount()

        fee = x_usdc * self.buy_fee_bp / BASIS_POINTS
        x_net = x_usdc - fee

        deltaS = self.deltaS_for_buy(self.S, x_net)
        if min_tokens_out > 0 and deltaS < min_tokens_out:
            raise SlippageExceeded()
        if self.S > 0 and deltaS > self.max_purchase_pct_bp * self.S / BASIS_POINTS:
            raise MaxPurchaseExceeded()

        team_tokens = deltaS * self.team_percent_bp / BASIS_POINTS
        new_S = self.S + deltaS
        level_new = self.get_level_idx(new_S)
        if self.user_balance(user) + deltaS - team_tokens > self.levels[level_new].maxBalance:
            raise MaxBalanceExceeded()

        # state
        self.reserve += x_usdc
        self.S = new_S
        self.total_supply += deltaS
        self.vesting += team_tokens
        self.user_credits[user] = self.user_balance(user) + (deltaS - team_tokens)
        self.last_buy_time[user] = self.time

        self.check_invariant()
        self._enforce_pool_price_floor(new_S)
        self.check_supply_invariant()
        self.check_pool_price_invariant()

        return deltaS - team_tokens

    def redeem_from_curve(
        self,
        user: str,
        deltaS: float,
        min_usdc_out: float = 0.0,
        deadline: Optional[float] = None,
    ) -> float:
        if deltaS <= 0:
            raise InvalidAmount()
        if self.pool_price is None:
            raise NotInitialized()
        if deadline is not None and self.time > deadline:
            raise DeadlineExpired()

        bal = self.user_balance(user)
        if bal + 1e-9 < deltaS:
            raise InsufficientBalance(f"balance {bal} < deltaS {deltaS}")

        amount = self.amount_for_redeem(self.S, deltaS)

        fee = amount * self.redeem_fee_bp / BASIS_POINTS
        early_fee = 0.0
        if self.time < self.last_buy_time.get(user, 0.0) + self.early_sell_period_sec:
            early_fee = amount * self.early_sell_fee_bp / BASIS_POINTS
        sell_team_fee = amount * self.sell_team_fee_bp / BASIS_POINTS

        user_amount = amount - fee - early_fee - sell_team_fee
        if min_usdc_out > 0 and user_amount < min_usdc_out:
            raise SlippageExceeded()

        new_S = self.S - deltaS

        self.reserve -= user_amount + sell_team_fee
        self.treasury_balance += sell_team_fee
        self.S = new_S
        self.total_supply -= deltaS
        self.user_credits[user] -= deltaS

        self.check_invariant()
        self._clamp_pool_price_corridor(new_S)
        self.check_supply_invariant()
        self.check_pool_price_invariant()

        return user_amount

    def buy_from_pool(
        self,
        user: str,
        x_usdc: float,
        min_tokens_out: float = 0.0,
        deadline: Optional[float] = None,
    ) -> float:
        if deadline is not None and self.time > deadline:
            raise DeadlineExpired()
        if self.pool_price is None:
            raise NotInitialized()
        if x_usdc <= 0:
            raise InvalidAmount()
        if x_usdc < self.effective_minimal_x6():
            raise MinimalPurchaseNotMet()

        fee = x_usdc * self.buy_fee_bp / BASIS_POINTS
        x_net = x_usdc - fee

        tokens_needed = x_net / self.pool_price
        tokens_from_pool = min(self.pool, tokens_needed)
        x_pool_used = tokens_from_pool * self.pool_price
        x_remaining = x_net - x_pool_used

        self.reserve += fee
        tokens_from_curve = 0.0

        if tokens_from_pool > 0:
            self.pool -= tokens_from_pool
            if x_remaining <= 1e-9:
                level_cur = self.get_level_idx(self.S)
                if (
                    self.user_balance(user) + tokens_from_pool
                    > self.levels[level_cur].maxBalance
                ):
                    raise MaxBalanceExceeded()
            self.reserve += x_pool_used
            self.user_credits[user] = self.user_balance(user) + tokens_from_pool

        if x_remaining > 0:
            tokens_from_curve = self._buy_from_curve_for(user, x_remaining, deadline)

        self.last_buy_time[user] = self.time

        self.check_invariant()
        self.check_supply_invariant()
        self.check_pool_price_invariant()

        return tokens_from_pool + tokens_from_curve

    def _buy_from_curve_for(
        self, buyer: str, x_18: float, deadline: Optional[float] = None
    ) -> float:
        if deadline is not None and self.time > deadline:
            raise DeadlineExpired()
        if x_18 <= 0:
            raise InvalidAmount()
        if self.pool_price is None:
            raise NotInitialized()

        if self.S > 0:
            free_r = self.free_reserve()
            cap = free_r * self.max_curve_for_pct_bp / BASIS_POINTS
            if x_18 > cap + 1e-9:
                raise MaxCurveForExceeded(f"X = {x_18} > cap = {cap}")

        deltaS = self.deltaS_for_buy(self.S, x_18)
        if self.S > 0 and deltaS > self.max_purchase_pct_bp * self.S / BASIS_POINTS:
            raise MaxPurchaseExceeded()

        team_tokens = deltaS * self.team_percent_bp / BASIS_POINTS
        new_S = self.S + deltaS
        level_new = self.get_level_idx(new_S)
        if self.user_balance(buyer) + deltaS - team_tokens > self.levels[level_new].maxBalance:
            raise MaxBalanceExceeded()

        self.reserve += x_18
        self.S = new_S
        self.total_supply += deltaS
        self.vesting += team_tokens
        self.user_credits[buyer] = self.user_balance(buyer) + (deltaS - team_tokens)
        self.last_buy_time[buyer] = self.time

        self.check_invariant()
        self._enforce_pool_price_floor(new_S)

        return deltaS - team_tokens

    def sell_to_pool(
        self,
        user: str,
        deltaP: float,
        min_usdc_out: float = 0.0,
        deadline: Optional[float] = None,
    ) -> float:
        if deltaP <= 0:
            raise InvalidAmount()
        if deadline is not None and self.time > deadline:
            raise DeadlineExpired()
        if self.pool_price is None:
            raise NotInitialized()
        if self.circuit_breaker_active():
            raise CircuitBreakerActive()

        bal = self.user_balance(user)
        if bal + 1e-9 < deltaP:
            raise InsufficientBalance(f"balance {bal} < deltaP {deltaP}")

        day = int(self.time // 86400)
        if self.last_reset_day.get(user) != day:
            self.daily_sold[user] = 0.0
            self.last_reset_day[user] = day

        s_curve = self.S
        if (
            self.daily_sold.get(user, 0.0) + deltaP
            > self.max_sell_pct_per_day_bp * s_curve / BASIS_POINTS
        ):
            raise MaxSellPerDayExceeded()

        amount_gross = deltaP * self.pool_price
        fee = amount_gross * self.redeem_fee_bp / BASIS_POINTS
        sell_team_fee = amount_gross * self.sell_team_fee_bp / BASIS_POINTS
        amount_user = amount_gross - fee - sell_team_fee

        if amount_user + sell_team_fee > self.free_reserve() + 1e-9:
            raise InsufficientFreeReserve()
        if min_usdc_out > 0 and amount_user < min_usdc_out:
            raise SlippageExceeded()

        self.daily_sold[user] = self.daily_sold.get(user, 0.0) + deltaP

        self.reserve -= amount_user + sell_team_fee
        self.treasury_balance += sell_team_fee
        self.pool += deltaP
        self.user_credits[user] -= deltaP

        p_s = self.P(s_curve)
        q = min(deltaP / max(s_curve, 1e-9), self.max_sold_pct_bp / BASIS_POINTS)
        mult = 1.0 + (self.k_mult_bp / BASIS_POINTS) * q
        new_price = self.pool_price * mult
        ceiling = p_s * (BASIS_POINTS + self.max_gap_bp) / BASIS_POINTS
        if new_price > ceiling:
            new_price = ceiling
        self.pool_price = new_price

        self.check_invariant()
        self.check_supply_invariant()
        self.check_pool_price_invariant()

        return amount_user

    # ------------------------------------------------------------------ internal

    def _enforce_pool_price_floor(self, new_S: float) -> None:
        p_new = self.P(new_S)
        floor = p_new * BASIS_POINTS / (BASIS_POINTS + self.max_gap_bp)
        if self.pool_price is not None and self.pool_price < floor:
            self.pool_price = floor

    def _clamp_pool_price_corridor(self, new_S: float) -> None:
        p_new = self.P(new_S)
        ceiling = p_new * (BASIS_POINTS + self.max_gap_bp) / BASIS_POINTS
        floor = p_new * BASIS_POINTS / (BASIS_POINTS + self.max_gap_bp)
        if self.pool_price is None:
            return
        if self.pool_price > ceiling:
            self.pool_price = ceiling
        elif self.pool_price < floor:
            self.pool_price = floor


# ------------------------------------------------------------------ default config

def default_levels() -> list[Level]:
    """Matches config/levels.json (E.1.01.03)."""
    return [
        Level(S_start=0.0,           S_end=50_000.0,    P_start=0.002, P_end=0.002, maxBalance=50_000.0),
        Level(S_start=50_000.0,      S_end=250_000.0,   P_start=0.002, P_end=0.004, maxBalance=250_000.0),
        Level(S_start=250_000.0,     S_end=1_250_000.0, P_start=0.004, P_end=0.008, maxBalance=1_250_000.0),
    ]


def default_curve(**overrides) -> BondingCurve:
    """Helper: default levels + init pool price at P(0)."""
    c = BondingCurve(default_levels(), **overrides)
    c.init_pool_price(c.P(0))
    return c


if __name__ == "__main__":
    # smoke test
    c = default_curve()
    print(f"P(0)        = {c.P(0.0):.6f} USDC/XRT")
    print(f"R(50_000)   = {c.R(50_000.0):.4f} USDC")
    print(f"R(150_000)  = {c.R(150_000.0):.4f} USDC")
    print(f"R(1_250_000)= {c.R(1_250_000.0):.4f} USDC")

    tokens = c.buy_from_curve("alice", 1000.0)
    print(f"buy 1000 USDC → {tokens:.2f} XRT, S = {c.S:.2f}")
    print(f"reserve = {c.reserve:.4f}, freeReserve = {c.free_reserve():.4f}")
    print(f"poolPrice = {c.pool_price:.6f}")