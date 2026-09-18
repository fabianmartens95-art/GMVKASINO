## Build contract

Lane: <!-- identity | ledger | game | player | ops | payments | devops | integration -->
Priority: <!-- P0 | P1 | P2 -->
Depends on: <!-- PR/issue numbers or none -->
Auto merge: <!-- yes/no; yes only for isolated, reversible work after CI -->
Integration wave: <!-- yes/no; yes routes this PR to Integration Wave V2 instead of V1 queue -->
Production gate: <!-- yes/no -->
Founder decision: <!-- yes/no -->

## Goal

<!-- One concrete outcome. -->

## Scope

<!-- Files/domains intentionally changed. -->

## Do not touch

<!-- Explicit boundaries for parallel work. -->

## Acceptance criteria

- [ ] Functional behavior implemented
- [ ] Capability/authorization boundary verified where relevant
- [ ] Idempotency and replay behavior verified for critical mutations
- [ ] Ledger/payment reconciliation covered where relevant
- [ ] Tests added or updated
- [ ] Build and smoke checks pass
- [ ] No secrets or PII added to logs
- [ ] Migration / rollback implications documented if applicable

## Integration

<!-- Dependency order, shared-core impact and downstream lanes. -->

## Production gate

<!-- Required verification before production/real-money promotion, or "Not required." -->
