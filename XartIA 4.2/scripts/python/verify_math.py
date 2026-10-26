"""
Cross-verify Python (E.2.01.01) and Solidity (C.2.01.13 CurveMathWrapper).

Calls CurveMathWrapper via web3.py and compares to Python BondingCurve.
Units: Solidity returns 18-dec wei. Python works in human units (USDC/XRT).
Conversion: python_value = solidity_wei / 1e18.

Requires:
    - RPC URL (env RPC_URL or --rpc)
    - CurveMathWrapper address (deployments/<network>.json or --wrapper)
    - Levels (config/levels.json or --levels)

Usage:
    python verify_math.py --network amoy --test-cases config/verify-cases.json
    python verify_math.py --network amoy --cases-default

Block: S.1.01.03
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from web3 import Web3

_THIS = Path(__file__).resolve().parent
sys.path.insert(0, str(_THIS.parent.parent / "e" / "02_simulation"))

from base_model import BondingCurve, Level  # noqa: E402


SCALE = 10**18  # 18-dec wei <-> human units

WRAPPER_ABI = [
    {
        "inputs": [
            {"internalType": "uint256", "name": "S", "type": "uint256"},
            {
                "components": [
                    {"internalType": "uint256", "name": "S_start", "type": "uint256"},
                    {"internalType": "uint256", "name": "S_end", "type": "uint256"},
                    {"internalType": "uint256", "name": "P_start", "type": "uint256"},
                    {"internalType": "uint256", "name": "P_end", "type": "uint256"},
                    {"internalType": "uint256", "name": "maxBalance", "type": "uint256"},
                ],
                "internalType": "struct Types.Level[]",
                "name": "levels",
                "type": "tuple[]",
            },
        ],
        "name": "P",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "pure",
        "type": "function",
    },
    {
        "inputs": [
            {"internalType": "uint256", "name": "S", "type": "uint256"},
            {
                "components": [
                    {"internalType": "uint256", "name": "S_start", "type": "uint256"},
                    {"internalType": "uint256", "name": "S_end", "type": "uint256"},
                    {"internalType": "uint256", "name": "P_start", "type": "uint256"},
                    {"internalType": "uint256", "name": "P_end", "type": "uint256"},
                    {"internalType": "uint256", "name": "maxBalance", "type": "uint256"},
                ],
                "internalType": "struct Types.Level[]",
                "name": "levels",
                "type": "tuple[]",
            },
        ],
        "name": "R",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "pure",
        "type": "function",
    },
    {
        "inputs": [
            {"internalType": "uint256", "name": "S", "type": "uint256"},
            {"internalType": "uint256", "name": "X", "type": "uint256"},
            {
                "components": [
                    {"internalType": "uint256", "name": "S_start", "type": "uint256"},
                    {"internalType": "uint256", "name": "S_end", "type": "uint256"},
                    {"internalType": "uint256", "name": "P_start", "type": "uint256"},
                    {"internalType": "uint256", "name": "P_end", "type": "uint256"},
                    {"internalType": "uint256", "name": "maxBalance", "type": "uint256"},
                ],
                "internalType": "struct Types.Level[]",
                "name": "levels",
                "type": "tuple[]",
            },
        ],
        "name": "deltaSForBuy",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "pure",
        "type": "function",
    },
    {
        "inputs": [
            {"internalType": "uint256", "name": "S", "type": "uint256"},
            {"internalType": "uint256", "name": "deltaS", "type": "uint256"},
            {
                "components": [
                    {"internalType": "uint256", "name": "S_start", "type": "uint256"},
                    {"internalType": "uint256", "name": "S_end", "type": "uint256"},
                    {"internalType": "uint256", "name": "P_start", "type": "uint256"},
                    {"internalType": "uint256", "name": "P_end", "type": "uint256"},
                    {"internalType": "uint256", "name": "maxBalance", "type": "uint256"},
                ],
                "internalType": "struct Types.Level[]",
                "name": "levels",
                "type": "tuple[]",
            },
        ],
        "name": "amountForRedeem",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "pure",
        "type": "function",
    },
]


def load_levels(path: str) -> list[Level]:
    with open(path) as f:
        data = json.load(f)
    levels = []
    for row in data["levels"]:
        levels.append(
            Level(
                S_start=int(row["S_start"]) / SCALE,
                S_end=int(row["S_end"]) / SCALE,
                P_start=int(row["P_start"]) / SCALE,
                P_end=int(row["P_end"]) / SCALE,
                maxBalance=int(row["maxBalance"]) / SCALE,
            )
        )
    return levels


def to_sol_tuple(levels: list[Level]) -> list[tuple]:
    return [
        (
            int(l.S_start * SCALE),
            int(l.S_end * SCALE),
            int(l.P_start * SCALE),
            int(l.P_end * SCALE),
            int(l.maxBalance * SCALE),
        )
        for l in levels
    ]


def check(name: str, py: float, sol_wei: int, epsilon: float = 1e-6) -> dict:
    sol = sol_wei / SCALE
    diff = abs(py - sol)
    return {
        "case": name,
        "python": py,
        "solidity": sol,
        "diff": diff,
        "ok": diff <= epsilon,
    }


def default_cases() -> list[dict]:
    return [
        {"kind": "P", "S": 0.0},
        {"kind": "P", "S": 25_000.0},
        {"kind": "P", "S": 50_000.0},
        {"kind": "P", "S": 150_000.0},
        {"kind": "P", "S": 250_000.0},
        {"kind": "P", "S": 500_000.0},
        {"kind": "R", "S": 0.0},
        {"kind": "R", "S": 50_000.0},
        {"kind": "R", "S": 150_000.0},
        {"kind": "R", "S": 250_000.0},
        {"kind": "R", "S": 1_250_000.0},
        {"kind": "deltaSForBuy", "S": 0.0, "X": 1.0},
        {"kind": "deltaSForBuy", "S": 0.0, "X": 200.0},
        {"kind": "deltaSForBuy", "S": 30_000.0, "X": 50.0},
        {"kind": "amountForRedeem", "S": 500.0, "deltaS": 500.0},
        {"kind": "amountForRedeem", "S": 100_000.0, "deltaS": 10_000.0},
    ]


def verify(
    wrapper_address: str,
    rpc_url: str,
    levels: list[Level],
    cases: list[dict],
    epsilon: float = 1e-6,
) -> dict:
    w3 = Web3(Web3.HTTPProvider(rpc_url))
    if not w3.is_connected():
        raise RuntimeError(f"cannot connect to {rpc_url}")

    wrapper = w3.eth.contract(address=Web3.to_checksum_address(wrapper_address), abi=WRAPPER_ABI)
    sol_levels = to_sol_tuple(levels)
    curve = BondingCurve(levels)

    results = []
    for i, c in enumerate(cases):
        kind = c["kind"]

        try:
            if kind == "P":
                S = c["S"]
                py = curve.P(S)
                sol_wei = wrapper.functions.P(int(S * SCALE), sol_levels).call()
                results.append(check(f"P(S={S})", py, sol_wei, epsilon))

            elif kind == "R":
                S = c["S"]
                py = curve.R(S)
                sol_wei = wrapper.functions.R(int(S * SCALE), sol_levels).call()
                results.append(check(f"R(S={S})", py, sol_wei, epsilon))

            elif kind == "deltaSForBuy":
                S = c["S"]
                X = c["X"]
                py = curve.deltaS_for_buy(S, X)
                sol_wei = wrapper.functions.deltaSForBuy(
                    int(S * SCALE), int(X * SCALE), sol_levels
                ).call()
                results.append(check(f"deltaSForBuy(S={S}, X={X})", py, sol_wei, epsilon))

            elif kind == "amountForRedeem":
                S = c["S"]
                dS = c["deltaS"]
                py = curve.amount_for_redeem(S, dS)
                sol_wei = wrapper.functions.amountForRedeem(
                    int(S * SCALE), int(dS * SCALE), sol_levels
                ).call()
                results.append(check(f"amountForRedeem(S={S}, dS={dS})", py, sol_wei, epsilon))

            else:
                results.append({"case": f"case[{i}]", "ok": False, "error": f"unknown kind: {kind}"})

        except Exception as e:
            results.append({"case": f"case[{i}]", "ok": False, "error": str(e)})

    return {
        "wrapper": wrapper_address,
        "rpc": rpc_url,
        "cases": len(cases),
        "passed": sum(1 for r in results if r.get("ok")),
        "failed": sum(1 for r in results if not r.get("ok")),
        "results": results,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Python↔Solidity cross-check")
    parser.add_argument("--network", default="amoy", help="network name (for deployments/<n>.json)")
    parser.add_argument("--rpc", default=None, help="RPC URL (default: $RPC_URL)")
    parser.add_argument("--wrapper", default=None, help="CurveMathWrapper address (default: from deployments)")
    parser.add_argument("--levels", default="config/levels.json", help="levels JSON path")
    parser.add_argument("--test-cases", default=None, help="test cases JSON (default: built-in)")
    parser.add_argument("--epsilon", type=float, default=1e-6, help="tolerance in human units")
    args = parser.parse_args(argv)

    rpc_url = args.rpc or os.environ.get("RPC_URL", "")
    if not rpc_url:
        print("error: --rpc or RPC_URL env var required", file=sys.stderr)
        return 2

    wrapper = args.wrapper
    if not wrapper:
        dep_path = Path(f"deployments/{args.network}.json")
        if not dep_path.exists():
            print(f"error: {dep_path} not found; pass --wrapper", file=sys.stderr)
            return 2
        with open(dep_path) as f:
            dep = json.load(f)
        wrapper = dep.get("curveMathWrapper")
        if not wrapper:
            print(f"error: curveMathWrapper not in {dep_path}", file=sys.stderr)
            return 2

    levels = load_levels(args.levels)
    cases = default_cases()
    if args.test_cases:
        with open(args.test_cases) as f:
            cases = json.load(f)

    print(f"verify_math: {len(cases)} cases, wrapper={wrapper}, rpc={rpc_url}")
    report = verify(wrapper, rpc_url, levels, cases, args.epsilon)

    for r in report["results"]:
        if "error" in r:
            print(f"  [ERR]  {r['case']:<40}  {r['error']}")
        else:
            mark = "OK " if r["ok"] else "FAIL"
            print(
                f"  [{mark}] {r['case']:<40}  "
                f"py={r['python']:.12f}  sol={r['solidity']:.12f}  "
                f"diff={r['diff']:.3e}"
            )

    print(f"\npassed: {report['passed']} / {report['cases']}, failed: {report['failed']}")
    return 0 if report["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())