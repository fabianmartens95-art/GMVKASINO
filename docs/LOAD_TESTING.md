# Synthetic load and concurrency testing

GMVKASINO includes an explicit load harness for isolated demo/staging environments. It is not part of normal CI and must not be aimed at production user traffic or real player data.

## Command

```bash
LOAD_BASE_URL=https://staging.example.invalid \
LOAD_CONCURRENCY=5 \
LOAD_REQUESTS=50 \
npm run load:staging
```

The harness refuses a missing target and accepts only HTTP(S) origins without embedded credentials, query parameters or fragments.

## What it exercises

1. liveness preflight,
2. public game catalog discovery,
3. synthetic demo-session creation per worker,
4. concurrent server-authoritative spins with a fresh idempotency key per logical request,
5. synthetic session cleanup.

No real account login, payment method, payment provider, cryptocurrency address or real user data is used.

## Output

The JSON report includes:

- configured/completed/failed request counts,
- error rate,
- effective concurrency,
- duration and requests/second,
- p50/p95/p99 spin latency,
- a bounded sample of failures.

A non-zero failed request count causes the command to exit non-zero.

## Operating rule

Run this only against an environment intentionally provisioned for load/concurrency testing. Do not use the primary hosted demo if other users are relying on it. Start with low concurrency, record the revision and environment, and compare results against an agreed baseline before raising limits.

This harness measures API behavior. It does not replace ledger reconciliation, payment reconciliation, staging revision verification, restore drills or the Production Gate.


## Baseline evaluation

Persist a load harness JSON result outside source control, then evaluate it with explicit staging thresholds:

```bash
LOAD_MAX_ERROR_RATE=0.01 \
LOAD_MAX_P95_MS=800 \
LOAD_MAX_P99_MS=1500 \
npm run load:evaluate -- ./load-report.json
```

Default demo/staging thresholds are 1% maximum error rate, 1500 ms p95 and 2500 ms p99. Override them when a reviewed baseline is established for the target environment.

The evaluator fails closed on malformed reports or thresholds and returns machine-readable failure reasons. A passing load baseline never promotes or authorizes a deployment by itself; normal staging, reconciliation, recovery and Production Gate evidence remain required.
