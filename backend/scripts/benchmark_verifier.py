#!/usr/bin/env python3
"""Benchmark the Python and Rust reconciliation implementations.

No performance claim is made anywhere in this repository without a number from
this script. Run it, read the output, quote that.

    python scripts/benchmark_verifier.py --rows 10000

Requires the Rust binary. Without it only the Python timing is reported, and
the comparison is skipped rather than estimated.
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.verify import rust_bridge  # noqa: E402
from app.verify.canonical import reconcile as python_reconcile  # noqa: E402

FIELDS = ["customer_id", "full_name", "email", "signup_date", "balance"]


def build(rows: int, damage_every: int = 7):
    source, destination = {}, {}
    for index in range(rows):
        key = f"{index:06d}"
        row = {
            "customer_id": key,
            "full_name": f"Person {index}",
            "email": f"person{index}@example.com",
            "signup_date": "2024-03-16",
            "balance": Decimal(f"{index % 10000}.{index % 100:02d}"),
        }
        source[key] = row
        if index % damage_every == 0:
            destination[key] = {**row, "customer_id": int(key)}
        else:
            destination[key] = dict(row)
    return source, destination


def time_it(callable_, repeats: int) -> list[float]:
    timings = []
    for _ in range(repeats):
        start = time.perf_counter()
        callable_()
        timings.append(time.perf_counter() - start)
    return timings


def report(label: str, timings: list[float]) -> float:
    best = min(timings)
    print(
        f"  {label:<10} best {best * 1000:8.1f} ms   "
        f"median {statistics.median(timings) * 1000:8.1f} ms"
    )
    return best


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=10_000)
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()

    print(f"Reconciling {args.rows} rows over {len(FIELDS)} fields, "
          f"{args.repeats} repeats")
    source, destination = build(args.rows)

    python_best = report(
        "python", time_it(lambda: python_reconcile(source, destination, FIELDS), args.repeats)
    )

    if not rust_bridge.is_available():
        print()
        print("  rust       not built, comparison skipped")
        print("  Build it with `cargo build --release` in rust-verifier.")
        return 0

    rust_best = report(
        "rust", time_it(lambda: rust_bridge.reconcile(source, destination, FIELDS), args.repeats)
    )

    print()
    ratio = python_best / rust_best
    if ratio > 1:
        print(f"  Rust is {ratio:.2f}x faster on this workload.")
    else:
        print(f"  Python is {1 / ratio:.2f}x faster on this workload.")
    print(
        "  The Rust timing includes process start and JSON transfer, which is "
        "the cost the pipeline actually pays."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
