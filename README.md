# Cloud Nest BPO CRM

**Version 0.3.0-rc.1 - updated source release candidate - 8 October 2026**

## Readiness: NOT a verified production release

This ZIP contains the actual updated application source, not only a patch or test report. It is an in-place continuation of the existing Next.js / React / TypeScript / MongoDB CRM. It contains no production credentials or patient records.

**191 core and regression tests pass.** The dependency-free core TypeScript check and source syntax/internal-import checks also pass. The full application typecheck/build has NOT passed: application dependencies are unavailable in the authoring environment. MongoDB integration, browser workflows, SMTP delivery, S3 access and ClamAV scanning have NOT been executed here. Do not use real patient data until the release gates in `docs/PRODUCTION_ACCEPTANCE.md` pass in your environment.

There is no verified dependency lockfile. Install and resolve dependencies, audit them, commit the generated lockfile, and use `npm ci` for subsequent deployments. Do not treat a ZIP filename, unit-test count, or the word "candidate" as production approval.

## Required routing implemented in the source

```text
Generation submits/resubmits -> Q/A
Q/A GOOD -> Chasing
Q/A BAD -> original Generation agent for correction -> Q/A
Chasing COMPLETE -> Management
Chasing DENIED -> Patient Verification -> COMPLETE -> Management
```

Direct Patient Verification creation/import and arbitrary manual department routing are rejected. Reopening derives the destination from recorded provenance. Existing permanent lead IDs are preserved; new lead codes use the CNB prefix. Q/A colleagues can view shared work, but only the holder of a live five-minute claim can mutate it. Claims, transitions and lead edits use version/concurrency controls.

## Included source

- Existing workspace, dashboards, queues, lead editor, activities, audits, imports, reports, notifications, MFA and user management.
- Cloud Nest branding, Management/Admin logo upload/preview/save/remove, and server-only security-email settings.
- Enrolled / Not Enrolled account enforcement and session invalidation; special ID, designation and deletion grants.
- Staff/Head new-device email challenges, expiring single-use codes, trusted-device records and administrative revocation.
- Management/Admin-only lead CSV/XLSX exports, including full authorized identifiers, history, activity and attachment metadata. Continued exports use explicit next-page controls.
- Advanced Medicare/member exact matching and username/special-ID searches within authorized row scope.
- Multiple private business-document/image/audio uploads, immutable S3 versions, quarantine, a separate ClamAV worker and authenticated downloads.
- Confirmed lead/file deletion with audit retention and a separate physical-storage purge worker.
- Monthly department-arrival statistics and Management/Admin security activity.
- Additive migration, environment templates, operational worker templates and test evidence.

These are source-level implementations, not claims that their live integrations have passed.

## Existing installation: preserve your data

**Do not regenerate `DATA_ENCRYPTION_KEY` or `SEARCH_HMAC_KEY`, rename the database, or run the initial-admin bootstrap over an existing installation.** Keep existing user/lead identifiers. Take a restorable database/storage backup and test migration on a copy first. Existing internal collection/channel/cookie identifiers are retained where needed for compatibility.

Read `docs/SETUP.md` before running commands. The migration defaults to a dry run and requires an explicit backup acknowledgement before writes.

## New isolated installation

Use Node.js 22.16+ within the package engine range and a transaction-capable MongoDB replica set/Atlas database. From this directory:

```sh
npm install
cp .env.example .env.local
# For a NEW EMPTY database only:
npm run secrets:generate
# Paste the generated keys and configure MongoDB, APP_URL and service credentials.
npm run env:check
npm run db:indexes
npm run db:admin
npm run db:migrate
# After backup acknowledgement and review, see SETUP.md for applying migration.
npm run dev
```

PowerShell: use `Copy-Item .env.example .env.local`. There is no default admin password. New Agent/Head device logins fail closed until SMTP is configured. Uploads fail closed until a valid scanner heartbeat and versioned private storage are available.

## Run checks after dependency installation

```sh
npm test
npm run test:types
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
# Configure an isolated empty test database first:
npm run test:integration
```

`npm run release:check` runs unit tests, the full typecheck and build, but does not substitute for browser, infrastructure, privacy, restoration or load testing.

## Documentation

- `docs/SETUP.md`: installation, existing-database migration and first use.
- `docs/DEPLOYMENT.md`: Vercel, SMTP, private storage, scanner/purge workers, rollout.
- `docs/PRODUCTION_ACCEPTANCE.md`: release-blocking acceptance checklist.
- `docs/FEATURE_STATUS.md`: supported behavior and explicit limits.
- `docs/SECURITY.md`: trust boundaries, handling sensitive data, residual risks.
- `docs/API.md`: protected endpoint contract.
- `docs/TEST_RESULTS.md` and `verification/`: checks actually run for this source snapshot.
- `docs/history/`: older documentation, NOT current instructions.
- `docs/ORIGINAL_REQUIREMENTS.txt`: preserved historical WAFBPO requirements; the newer Cloud Nest routing supersedes conflicting sections.

No live database, cloud deployment, SMTP mailbox, storage bucket, or scanner host was changed by preparing this ZIP.
