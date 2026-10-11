# Cloud Nest BPO upgrade - 0.3.0-rc.1

This is updated application source, not a production-certification statement. Read README.md and docs/TEST_RESULTS.md first.

The new route removes Generation Head approval as a transfer gate, sends Chasing denial to PV, rejects direct PV intake, and prevents arbitrary manual routing. It adds shared Q/A visibility with exclusive expiring claims, legacy routing migration, expanded exports/uploads, enrollment enforcement, device verification, security settings/logs, deletion controls and logo management.

Preserve the existing database name, permanent lead/user IDs, DATA_ENCRYPTION_KEY and SEARCH_HMAC_KEY. Migration is dry-run by default. Existing invalid PV records are retained and placed in Management migration review; no invented denial is added to their history.

Core/regression tests pass; complete application, database, browser and external-service acceptance are outstanding. This archive must not be represented as a finished production deployment.
