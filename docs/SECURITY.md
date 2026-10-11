# Security and sensitive-data handling

This document describes implemented boundaries and acceptance duties. It is not a compliance certification, penetration-test report or claim of perfect security.

## Source controls

Protected API endpoints authenticate database-backed sessions and enforce account/enrollment status, roles, department and record scope on the server. Destructive/export/configuration operations have explicit policy checks. Q/A mutations require the live claim holder and record versions. Ownership changes use transactions. Request origin/CSRF checks, input validation and database rate limits are retained.

Passwords are salted/hashed; never plaintext. Patient/audit/activity contents use authenticated encryption and distinct keyed search indexes. Public lead views mask restricted identifiers and omit ciphertext/index material. Only authorized exports/reveal/history paths decrypt full values. Never rotate keys by replacing environment values in place.

Agent/Head device verification uses a random HttpOnly, SameSite browser cookie, hashed codes, five-minute expiry, five counted attempts, single-use consume and revocation/session-version checks. HTTPS is required for secure production cookies. Existing privileged TOTP MFA remains independent. Trust is a browser credential, not proof of a unique physical device.

The verification email is server-only and restricted in settings/API responses. Access to the security mailbox must be controlled operationally. SMTP credentials, scanner secret, database URL, encryption keys and session cookies must never be public or embedded in client bundles.

Uploads use allowlists, exact size/type constraints, random keys, immutable versions, quarantine, bounded content inspection, maintained ClamAV and authenticated downloads. Operational scanning errors fail closed. SVG, executables, macro-enabled office packages, unsafe ZIP contents and active-content examples are rejected. Magic checks/deny lists do not prove every file safe; real scanner and hostile-file testing remain mandatory. Only the selected scanned raster logo is public. Do not use a patient image as a logo.

## Retention and deletion

Lead/file deletion requires permission, confirmation and a reason. Lead content is removed; file bytes are queued for the purge worker. Historical audit events survive and can contain encrypted snapshots. Backups also survive according to retention. Do not tell a person that their data has been completely erased based only on this action.

## Required deployment review

Review all dependencies and pin a lockfile after installation; scan for known vulnerabilities. Test every role through direct API requests and changed IDs, not only hidden buttons. Verify SMTP/TLS, cookie flags, session revocation, concurrent claim/routing behavior, file storage permissions, scan fail-closed behavior, security-email privacy and export completeness. Record backup restoration and encryption-key recovery tests.

Use least-privilege runtime identities, a separate destructive purge identity, restricted migration credentials and independently protected audit backups. Rotate secrets through a tested migration plan. Assess XSS/CSP and safe document rendering on the actual hosting setup. Avoid verbose payload logging and public source maps containing secrets. Decide applicable privacy, health-data, residency and business obligations with qualified responsible personnel.

Residual limits are in FEATURE_STATUS.md. Complete-build, browser, integration, load and external-service tests have not passed in this environment. Any failure in the production acceptance checklist blocks release.
