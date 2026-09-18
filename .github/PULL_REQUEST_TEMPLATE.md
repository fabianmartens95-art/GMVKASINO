## Build contract

Lane: <!-- identity | ledger | game | player | ops | payments | devops | integration -->
Priority: <!-- P0 | P1 | P2 -->
Depends on: <!-- PR/issue numbers or none -->
Auto merge: <!-- yes/no; yes only for isolated, reversible work after CI -->
Integration wave: <!-- yes/no; yes routes this PR to Integration Wave V2 instead of V1 queue -->
Production gate: <!-- yes/no -->
Founder decision: <!-- yes/no -->
Casino Product Wave: <!-- CPW1 | CPW2 | CPW3 | CPW4 | CPW5 | CPW6 | CPW7 | cross-wave | none -->
Notion impact: <!-- none | update required -->
Canonical Notion page: <!-- page name/link or n/a -->
Notion synced: <!-- yes | no | pending merge | n/a -->
Cross-project learning: <!-- none | Adopt | Adapt | Reject | Defer -->

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


## Documentation sync

<!-- If Notion impact is update required: identify the post-merge update and how it was verified. -->

## Cross-project learning check

<!-- Record any reusable GMVGANG/GMVKASINO engineering/governance pattern. Domain logic, repositories and production data stay separate. -->
