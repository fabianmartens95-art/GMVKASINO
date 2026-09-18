# Operational observability

GMVKASINO uses a deliberately small in-process metrics registry for the non-monetary demo. The objective is to make failures diagnosable without creating a high-cardinality telemetry system or exposing session/player data.

## Metrics surface

The metrics endpoint is disabled unless `METRICS_TOKEN` is configured with at least 24 characters.

When enabled:

```text
GET /api/v1/internal/metrics
Authorization: Bearer <METRICS_TOKEN>
```

Requests without the correct token receive HTTP 401. When no token is configured, the route responds as not found.

The token is a server-side secret. Do not place it in frontend code, URLs, analytics, screenshots, source control or general logs.

## Request metrics

Request series are keyed only by:

- normalized route
- HTTP method
- status class (`2xx`, `4xx`, `5xx`, etc.)

Each series tracks:

- request count
- error count
- cumulative latency
- maximum latency
- average latency derived at snapshot time

Arbitrary API paths collapse to `/api/v1/other`. Non-API/static requests collapse to `/frontend`. Raw URLs, query strings, request bodies, session IDs and player names are not metric labels.

## Business metrics

The registry has a fixed allowlist of aggregate counters:

- `session.created`
- `session.resumed`
- `session.expired`
- `session.rotated`
- `session.invalidated`
- `spin.resolved`
- `spin.win`
- `spin.no_win`
- `spin.rate_limited`
- `spin.invalid_bet`
- `spin.insufficient_credits`
- `spin.game_unavailable`
- `spin.session_missing`

Unknown event names are rejected rather than creating new series.

Session expiry is counted where the storage layer actually detects/removes an expired session. Metrics never include the expired token itself.

## Retention and cardinality

Metrics live only for the lifetime of the Node process and reset on restart/deploy. This is intentional for the current demo. There is no in-process historical retention database.

Cardinality is bounded by the fixed route normalization rules, HTTP methods/status classes that actually occur, and the fixed business-event allowlist. Do not add player IDs, session fingerprints, game-specific user identifiers, request IDs or arbitrary error strings as metric labels.

A later monitoring system may scrape/export this surface, but long-term retention belongs in that external system rather than this process.

## Incident signals

During an incident, inspect signals in this order:

1. `/api/v1/health/live` — process alive?
2. `/api/v1/health/ready` — persistence usable?
3. request `5xx` count and latency by normalized route
4. `spin.rate_limited`, `spin.insufficient_credits` and `spin.session_missing` changes
5. unusual `session.expired` growth
6. application/database logs correlated through request IDs, without exposing bearer tokens

Interpretation examples:

- live + not ready: investigate PostgreSQL/JSON persistence before restarting the process repeatedly.
- rising `5xx` on one route: inspect that route's downstream dependency and request-ID-correlated logs.
- rising latency with stable error rate: inspect database latency/resource pressure.
- sudden `session.expired` increase: verify clock/time settings and session TTL configuration.
- sharp `spin.rate_limited` increase: inspect request patterns before changing limits.

## Privacy and secret-safety rules

The metrics payload must never contain:

- raw session bearer tokens
- player names
- request or response bodies
- Authorization headers
- `DATABASE_URL`
- `METRICS_TOKEN`
- TLS CA material
- arbitrary raw URL paths/query parameters

Tests enforce representative secret-safety cases. Any new metric must keep the fixed-cardinality and no-identifier constraints.


## Alert evaluation baseline

GMVKASINO now has a read-only evaluator for the current process-lifetime metrics snapshot. It does not page, email, restart services or promote deployments.

The evaluator supports explicit thresholds for:

- aggregate HTTP `5xx` rate after a minimum request count,
- maximum latency observed for any normalized route/status series,
- process-lifetime `session.expired` count,
- process-lifetime `spin.rate_limited` count.

Default engineering thresholds are:

- minimum 20 requests before evaluating the aggregate `5xx` rate,
- `5xx` rate above 2% = critical,
- route max latency above 2000 ms = warning,
- more than 25 expired sessions in one process lifetime = warning,
- more than 50 rate-limited spins in one process lifetime = warning.

These are engineering baselines, not production SLAs. Because current metrics reset on process restart, the event-count thresholds are process-lifetime signals rather than rolling-window rates. External monitoring/retention must be added before treating them as production alerting.
