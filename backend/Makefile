# Reproducible commands. Every target here is meant to be run from backend/.

DATABASE_URL ?= postgresql://moveproof:moveproof_local_only@localhost:5433/moveproof

.PHONY: install db-up db-down db-wait migrate fixtures test test-core test-db smoke api clean reset rust rust-test bench

install:
	python -m venv .venv
	./.venv/bin/pip install --upgrade pip
	./.venv/bin/pip install -r requirements-dev.txt

db-up:
	docker compose up -d postgres

db-down:
	docker compose down

db-wait:
	@echo "waiting for postgres"
	@until docker compose exec -T postgres pg_isready -U moveproof -d moveproof >/dev/null 2>&1; do sleep 1; done
	@echo "postgres ready"

migrate: db-wait
	DATABASE_URL="$(DATABASE_URL)" python -m app.db.migrations

fixtures:
	python scripts/generate_fixtures.py --out tests/fixtures/generated --sizes 100 1000 10000

# Runs everything that needs no database and no network.
test-core:
	pytest tests -v -m "not database"

# Runs the staging and commit tests against the local database.
test-db: db-wait migrate
	DATABASE_URL="$(DATABASE_URL)" pytest tests -v -m database

test: test-core test-db

# Runs the FastAPI backend on port 8000.
api: db-wait
	DATABASE_URL="$(DATABASE_URL)" uvicorn app.api.main:app --reload --port 8000

# Builds the Rust verifier. Without it, canonical reconciliation reports
# not verified rather than passed.
rust:
	cd ../rust-verifier && cargo build --release

rust-test:
	cd ../rust-verifier && cargo test

# Measures both reconciliation implementations. No performance claim is made
# anywhere without a number from here.
bench:
	python scripts/benchmark_verifier.py --rows 10000

# Checks Token Factory access without touching the rest of the system.
smoke:
	python scripts/nebius_smoke_test.py

# Drops every migration and its derived data. The schema itself is kept.
reset: db-wait
	DATABASE_URL="$(DATABASE_URL)" python -c "\
from app.db.connection import connect; \
conn = connect().__enter__(); \
cur = conn.cursor(); \
cur.execute('DELETE FROM public.customers'); \
cur.execute('DELETE FROM moveproof.migrations'); \
conn.commit(); \
print('demo data cleared')"

clean:
	rm -rf .venv .pytest_cache **/__pycache__ tests/fixtures/generated
