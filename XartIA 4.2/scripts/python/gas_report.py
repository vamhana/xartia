"""
Parse Foundry gas-test results and compare against spec limits.

Requires:
    - `forge test --match-path 'test/gas/*' --json` output (default: run via subprocess)

Spec limits (R.2.01.10 testing-guide, T.6.*):
    buyFromCurve        <= 250_000
    redeemFromCurve     <= 250_000
    buyFromPool         <= 200_000
    sellToPool          <= 200_000
    levelTransition     <= 300_000

Usage:
    python gas_report.py
    python gas_report.py --json path/to/forge_test.json
    python gas_report.py --no-run    # only parse --json

Block: S.1.01.06
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


LIMITS = {
    "buyFromCurve":    250_000,
    "redeemFromCurve": 250_000,
    "buyFromPool":     200_000,
    "sellToPool":      200_000,
    "levelTransition": 300_000,
}


def run_forge(test_path: str = "test/gas/*") -> dict:
    """Run forge test --json and return parsed dict."""
    cmd = ["forge", "test", "--match-path", test_path, "--json"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    # forge returns non-zero if tests fail; that's fine, we still parse
    if not result.stdout.strip():
        raise RuntimeError(f"forge produced no output:\n{result.stderr}")
    return json.loads(result.stdout)


def extract_logs(forge_json: dict) -> dict[str, int]:
    """
    Look for logs matching `gas <op> = N` in test output.
    Foundry's --json output puts decoded logs under `decoded_logs` (list of strings).
    """
    reports: dict[str, int] = {}
    for suite_name, suite in forge_json.items():
        if not isinstance(suite, dict):
            continue
        for test_name, test in suite.get("test_results", {}).items():
            logs = test.get("decoded_logs", []) or []
            for line in logs:
                # line looks like "gas buyFromCurve: 123456" or "gas buyFromCurve = 123456"
                if not isinstance(line, str):
                    continue
                s = line.strip()
                if not s.startswith("gas "):
                    continue
                # strip "gas " prefix
                body = s[4:]
                # find separator "=" or ":"
                sep = "=" if "=" in body else ":" if ":" in body else None
                if sep is None:
                    continue
                name, val = body.split(sep, 1)
                name = name.strip()
                try:
                    n = int(val.strip())
                except ValueError:
                    continue
                # keep max across duplicates (shouldn't be duplicates, but be safe)
                reports[name] = max(reports.get(name, 0), n)
    return reports


def compare(reports: dict[str, int]) -> list[dict]:
    rows = []
    for name, limit in LIMITS.items():
        actual = reports.get(name)
        if actual is None:
            rows.append({"name": name, "actual": None, "limit": limit, "ok": None})
        else:
            rows.append({"name": name, "actual": actual, "limit": limit, "ok": actual <= limit})
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Gas report (T.6.*)")
    parser.add_argument("--json", default=None, help="pre-captured forge test --json output")
    parser.add_argument("--no-run", action="store_true", help="do not invoke forge test")
    parser.add_argument("--out", default=None, help="write JSON report here")
    args = parser.parse_args(argv)

    if args.json:
        with open(args.json) as f:
            forge_json = json.load(f)
    elif args.no_run:
        print("error: --no-run requires --json", file=sys.stderr)
        return 2
    else:
        forge_json = run_forge()

    reports = extract_logs(forge_json)
    rows = compare(reports)

    print(f"{'operation':<20} {'actual':>10} {'limit':>10}  status")
    print("-" * 55)
    any_fail = False
    for r in rows:
        if r["actual"] is None:
            print(f"  {r['name']:<18} {'?':>10} {r['limit']:>10}  MISSING")
            any_fail = True
        elif r["ok"]:
            print(f"  {r['name']:<18} {r['actual']:>10} {r['limit']:>10}  OK")
        else:
            print(f"  {r['name']:<18} {r['actual']:>10} {r['limit']:>10}  FAIL (+{r['actual'] - r['limit']})")
            any_fail = True

    if args.out:
        with open(args.out, "w") as f:
            json.dump({"reports": reports, "rows": rows}, f, indent=2)
        print(f"\nwritten: {args.out}")

    return 1 if any_fail else 0


if __name__ == "__main__":
    sys.exit(main())