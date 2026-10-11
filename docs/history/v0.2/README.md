# CLOUD NEST BPO CRM

**Version 0.1.0 | Source-code foundation | Prepared 21 September 2026**

A database-backed CRM built from the supplied Cloud Nest BPO upgraded specification. This repository contains a Next.js application, API implementation, MongoDB services, role/workflow rules, operational scripts and automated tests. It is **not a deployed or production-certified system**. It contains no demo credentials, real patient data or fabricated dashboard values.

## Workflow preserved

Navigation order: **Generation -> Q/A -> Chasing -> Patient Verification -> Management**.

Operational pipeline: **Generation agent -> Generation Head -> Q/A -> Chasing -> Management**. Patient Verification is a separate, Management-controlled route. QA BAD returns to the original Generation agent. Resubmission after a QA return goes back to Q/A; a Generation Head return goes back to that Head. Head-only completion preserves the assigned agent's attribution.

## What is implemented

- Responsive workspace with department queues, dashboard, lead editor, activity/history views, notifications, live team status, user administration, imports, reports and security settings.
- MongoDB-backed API authorization on reads, writes, exports and workflow actions; multiple department memberships, head/agent hierarchy, account locking/deactivation and session revocation.
- Permanent lead IDs, draft autosave, required-field validation, duplicate checks, QA GOOD/BAD, rework, bulk assignment, calls, fax history, verification results, completion, finalization, reopening and archival.
- Encrypted patient payloads and audit/activity contents, keyed search/duplicate indexes, masked identifiers, audited reveal, secure sessions, password hashing, TOTP MFA and recovery codes.
- Durable notifications, server-side atomic alert claiming, grouped bulk notifications, an opt-in buzzer, private Ably realtime hints, and authenticated polling fallback.
- Private version-pinned S3 PDF/audio uploads, quarantine, a ClamAV worker, permission-checked expiring download/preview URLs, and no historical-file delete API.
- CSV/XLSX mapping, preview, validation, resumable bounded imports, error reports, server-side cursor pagination, indexed prefix search and bounded CSV/XLSX export.

## Start locally

Use **Node.js 22** and an Atlas cluster or MongoDB replica set. A standalone MongoDB server is insufficient because business writes use transactions.

```sh
npm install
cp .env.example .env.local
npm run secrets:generate
```

Paste the generated keys into `.env.local`, then configure `MONGODB_URI`, `MONGODB_DB`, `APP_URL`, and the temporary first-administrator variables. `cp` also works as an alias in PowerShell; alternatively use `Copy-Item .env.example .env.local`.

```sh
npm run env:check
npm run db:indexes
npm run db:admin
npm run dev
```

Open `http://localhost:3000` and sign in using the administrator credentials **you configured**. There is no default password. Remove the bootstrap password from the environment after creating the administrator. Create department Heads before Agents, then enable the buzzer from the workspace header.

Without an Ably key, notifications use polling. Without S3 and a working scanner, files cannot be uploaded or released from quarantine. These integrations never silently return fake success.

## Validation performed in the authoring environment

**118 automated unit/domain/HTTP tests passed; zero failed or skipped.** The dependency-free domain/security modules also passed a strict TypeScript semantic check using the available compiler. The repository's TypeScript/TSX files passed syntax/transpilation and internal-import checks.

The authoring environment could not resolve the npm registry. Therefore **dependencies were not installed, a lockfile was not generated, and the complete Next.js typecheck/build and browser tests were not run**. MongoDB, S3, Ably, scanner and Vercel integration tests were not run without provisioned services. An opt-in isolated-database integration suite is supplied, not represented as executed.

After installation, run:

```sh
npm run typecheck
npm test
npm run build
```

Resolve dependency/API compatibility errors, review `npm audit`, commit the generated `package-lock.json`, then use `npm ci` for reproducible deployments. Do not treat this archive as a passed production build.

## Scope boundaries

This is a substantial first implementation, **not every final acceptance criterion from the master prompt**. The current grid is paginated and scrollable, not virtualized. Interactive imports are limited to 5 MB / 5,000 rows, in 25-row server batches. Exports are capped at 1,000 records per request. Million-record load testing, unattended large-file import/export jobs, full reporting-metric parity, an operational backup/restore program, monitoring integration and a security review remain production gates.

See [feature status](docs/FEATURE_STATUS.md) for the exact implemented/pending distinction; [setup](docs/SETUP.md), [deployment](docs/DEPLOYMENT.md), [security](docs/SECURITY.md), [API](docs/API.md), and [verification results](docs/TEST_RESULTS.md) for implementation details.

## Repository layout

```text
src/app/                 Next.js pages and catch-all API route
src/components/          Workspace, editor, workflow dialogs, alerts and grids
src/lib/domain/          Shared types, permission rules, validation, state machine
src/lib/                 MongoDB, auth, encryption, leads, storage, reports, imports
scripts/                 Index migration, first admin, env checks, secrets, scanner
tests/                   Unit tests and opt-in isolated MongoDB integration suite
docs/                    Setup, deployment, API, security, status, original source
.github/workflows/       Install, typecheck, unit test, build and dependency-audit CI
```

The original user specification is retained in `docs/ORIGINAL_REQUIREMENTS.txt`. Product choices and scope limits are recorded separately rather than silently modifying that source.
