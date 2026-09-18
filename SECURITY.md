# Security Policy

## Supported code

Security fixes target the current `main` branch and actively deployed revisions derived from it.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities, credentials, tokens, personal data, production configuration, wallet/ledger data, or payment information in a public issue.

Use GitHub's private vulnerability reporting flow when the repository exposes a **Report a vulnerability** option. If that option is unavailable, contact the repository owner through an existing private GMVKASINO communication channel before sharing technical details.

A useful report includes:

- affected component and revision;
- concise reproduction steps;
- expected and observed behavior;
- security or financial-integrity impact;
- whether any credential, account, wallet, ledger, payment, or production system may be affected.

Do not use real player or payment data in proof-of-concept material.

## High-priority classes

Treat the following as high priority:

- authentication/session or authorization bypass;
- exposed credentials or signing material;
- unauthorized wallet or balance mutation;
- ledger inconsistency or settlement replay;
- deposit/withdrawal idempotency failure;
- payment or reconciliation integrity failure;
- injection or remote code execution;
- audit-log integrity failure;
- production/staging boundary failure.

## Secret exposure response

If a real credential is committed or otherwise exposed, assume compromise. Revoke or rotate the credential first, verify dependent services, then remove the material from the current tree and Git history as appropriate. Deleting the file in a later commit is not sufficient by itself.
