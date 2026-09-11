# moveproof-verifier

Canonical row serialization, stable hashing and reconciliation for MoveProof.

## Its role in the pipeline

Reconciliation is the part of verification that touches every row of every
dataset. It collapses a row to one canonical string under fixed rules and
hashes it, so two rows match only when they are the same row under those
rules. That gives one whole-dataset check rather than one comparison per
field, and it is the check that catches damage the field level rules were not
written to look for.

The Python verifier calls this binary through
`backend/app/verify/rust_bridge.py`. When the binary is not built, the
reconciliation check reports `not_verified` with the reason. It never reports
`passed`, because a check that did not run is not a check that succeeded.

## Build

```bash
cd rust-verifier
cargo build --release
cargo test
```

The binary lands at `target/release/moveproof-verifier`. The Python bridge
looks there first, then on `PATH`, then at `MOVEPROOF_VERIFIER_BIN`.

## Interface

JSON on stdin, JSON on stdout.

```bash
echo '{"row": {"customer_id": {"type": "text", "value": "00127"}}}' \
  | ./target/release/moveproof-verifier hash

echo '{"fields": ["customer_id"],
       "source": {"00127": {"customer_id": {"type": "text", "value": "00127"}}},
       "destination": {"00127": {"customer_id": {"type": "int", "value": 127}}}}' \
  | ./target/release/moveproof-verifier reconcile
```

A value carries its type. That is deliberate: a decimal is normalised
numerically so `1200.50` and `1200.5` agree, while an identifier never is, so
`00127` and `127` stay different. Conflating the two would defeat the purpose.

## Parity

`backend/tests/test_parity.py` runs the same inputs through this crate and
through `backend/app/verify/canonical.py` and fails on any divergence. Two
implementations that disagree about a hash are worse than one, so parity is
enforced rather than assumed.

## Performance

No performance claim is made here. `backend/scripts/benchmark_verifier.py`
measures both implementations on the same generated dataset and prints the
numbers. Run it before quoting a figure.
