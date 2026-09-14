# MoveProof backend, for Cloud Run.
#
# Two stages. The first compiles the Rust verifier; the second carries only
# the resulting binary alongside the Python service, so the image does not
# ship a Rust toolchain.
#
# The Rust stage is not optional in production. Without the binary the
# canonical reconciliation check reports not verified, which is honest but
# means the deployment is checking less than it could.

# ---------------------------------------------------------------- rust stage
FROM rust:1.85-slim AS rust-build

WORKDIR /build
COPY rust-verifier/Cargo.toml rust-verifier/Cargo.lock ./
COPY rust-verifier/src ./src
COPY rust-verifier/tests ./tests

RUN cargo build --release && cargo test --release

# ------------------------------------------------------------- python runtime
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    MOVEPROOF_VERIFIER_BIN=/usr/local/bin/moveproof-verifier

# libpq is needed by psycopg. Nothing else is installed, so the image stays
# small and the attack surface with it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/sql ./sql
COPY backend/scripts ./scripts

COPY --from=rust-build /build/target/release/moveproof-verifier /usr/local/bin/moveproof-verifier

# The service runs unprivileged.
RUN useradd --create-home --uid 10001 moveproof \
    && chown -R moveproof:moveproof /app
USER moveproof

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8080/health || exit 1

# Cloud Run supplies PORT. One worker with several threads suits a workload
# that spends most of its time waiting on PostgreSQL and on Token Factory.
CMD exec uvicorn app.api.main:app \
    --host 0.0.0.0 \
    --port ${PORT:-8080} \
    --workers 1 \
    --timeout-keep-alive 65
