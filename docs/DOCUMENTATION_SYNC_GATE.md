# GMVKASINO Documentation Sync Gate V1

Status: Binding governance gate  
Effective: 2026-09-18  
Parent: `docs/PRODUCT_DELIVERY_OS.md`

## Rule

Every material change to roadmap, architecture, governance, security, product waves, Founder decisions, release gates or build status must be reflected in the existing Casino OS in Notion.

GitHub remains the implementation source of truth. Notion is the operating/decision source of truth.

## Required PR metadata

Every PR must state:
- Casino Product Wave
- Notion impact: none / update required
- Canonical Notion page or destination
- Notion synced: yes / no / pending merge
- Verification: how the post-merge state was checked
- Cross-project learning impact: none / Adopt / Adapt / Reject / Defer

## Sync timing

For normal implementation:
1. define scope and Notion impact before coding
2. implement and merge against GitHub gates
3. update Notion after the merge/gate when the final state is known
4. re-fetch or otherwise verify the canonical Notion page
5. close/update the tracking issue only after sync is confirmed when sync is required

For Founder Decisions or governance changes, Notion may be updated before code when the decision itself is authoritative.

## Drift audit

Run a drift audit:
- after a Casino Product Wave exit
- after a major Integration Wave
- after a security/integrity incident
- after a material architecture or release-gate change
- at least weekly while active development is high

Audit targets:
- active Product Wave and exit gate
- open P0 launch blockers
- current architecture/security contracts
- Founder Decisions
- production/real-money boundary
- GitHub issue/PR evidence links

## No duplicate systems

Do not introduce a second roadmap database, second decision log or separate shadow backlog. Reuse the existing Casino OS Tasks, Knowledge & SOPs, Decision Log and GitHub issues.
