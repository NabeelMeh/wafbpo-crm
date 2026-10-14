# Setup and safe migration

This is a source release candidate. The commands below are instructions to execute in your environment, not a record of a successful production deployment.

## Prerequisites and dependencies

Use Node.js 22.16 or later within package.json's engine range, npm, and MongoDB Atlas or a replica set with transaction support. A standalone MongoDB process is insufficient. Work with synthetic data in an isolated environment initially.

```sh
npm install
cp .env.example .env.local
```

On PowerShell, use `Copy-Item .env.example .env.local`. Installation needs network access. Resolve any dependency/API compatibility issues, run the complete checks, audit dependencies, and commit package-lock.json. Do not substitute a fabricated lockfile or disable TypeScript checks to obtain a successful build.

## Existing CRM upgrade

1. Back up MongoDB, private storage metadata/versions and existing secret values. Test restoration to an isolated database. Keep all permanent lead IDs and the existing MONGODB_DB value.
2. Reuse the exact existing DATA_ENCRYPTION_KEY and SEARCH_HMAC_KEY. Changing these is not rebranding; it can make patient/audit data unreadable or searchable indexes inconsistent.
3. Populate .env.local from the example without overwriting existing secrets. Configure server-only SMTP and security recipient, S3, the scanner shared secret and the exact browser origin. Do not run secrets:generate or db:admin for an existing database.
4. Install the updated code on staging, stop old writers, and run the read-only migration preview:

```sh
npm run env:check
npm run db:migrate
```

5. Review the counts and identity-conflict errors. Before applying, set `MIGRATION_BACKUP_CONFIRMED=yes` in the local migration environment. Use a maintenance window: stop the old deployment's writes, imports and background writers. `MAINTENANCE_MODE=true` blocks ordinary writes only in deployments running the new code; it does not control the old deployment.

```sh
npm run db:migrate -- --apply
```

6. Migration normalizes user identifiers/enrollment, rebuilds blind exact identifier indexes, sends legacy Generation review work to Q/A, clears obsolete Q/A assignments without valid claims, and preserves invalid legacy PV records in Management migration review. It backfills event-derived reporting fields where existing history supports them, without inventing historical actors or denial events. It creates indexes; it does not rename records, rotate keys or discard leads.
7. Re-running migration preserves identities/content, but may update record versions and scan historical records again. It is a controlled maintenance command, not an application-startup hook. Do not run alongside live editing.
8. Review migration exceptions in Management and use the permitted reopen action. Never manually edit provenance to make an old record appear denied.
9. Complete staging acceptance, then repeat the tested maintenance procedure on production. Set MAINTENANCE_MODE=false only after checks pass. Rollback requires a compatible application/database plan; simply reverting the application can restore obsolete routing rules.

## New empty installation

Only for a new database: generate two distinct keys with `npm run secrets:generate`, paste into .env.local, and set ADMIN_USERNAME, ADMIN_PASSWORD and ADMIN_NAME. Password policy is 10-128 characters with rejection of predictable passwords. A longer unique passphrase is preferable.

```sh
npm run env:check
npm run db:indexes
npm run db:admin
npm run db:migrate
```

Apply the reviewed migration using the explicit acknowledgement above. Remove bootstrap admin credentials after successful creation. Then run `npm run dev`, open the configured APP_URL, enroll privileged MFA, save recovery codes securely and sign in again with MFA.

## Organization and staff

Create department Heads before Agents, then assign the proper memberships and Head relationships. The global Admin and Management roles are separate from departmental Head/Agent membership. Existing Super Admin remains supported.

New users are Enrolled; Not Enrolled blocks password login and every protected API and invalidates active sessions. Changing roles, enrollment or passwords requires a new login. Test re-enrollment explicitly.

Agent/Head login from a new browser/device requires a code delivered to the restricted security recipient. Complete SMTP configuration BEFORE testing this flow. Management verifies the request and shares the code through an approved internal process. The frontend never shows the destination email. A trusted browser cookie is device recognition, not hardware identity; clearing cookies or expiration requires another verification.

## First workflow acceptance

Generate a valid synthetic lead and submit: it should immediately leave Generation and appear in the Q/A shared queue. Claim it as Q/A Agent A; Agent B should still see the record but be unable to change it. GOOD sends it to Chasing; BAD returns it to the original agent and RESUBMIT goes back to Q/A. Test both Chasing completion to Management and Chasing denial to PV then completion to Management. The same permanent lead ID must remain throughout.

## Tests

```sh
npm test
npm run test:types
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
cp .env.test.example .env.test
# Set ONLY an isolated EMPTY replica-set test database and explicit write permission.
npm run test:integration
```

The integration suite guards its database name/emptiness and uses synthetic data. Read tests/integration.ts before granting TEST_ALLOW_DB_WRITE. Do not change its database guard to point at production. Do not set TEST_ALLOW_DB_DROP=true on a database containing anything valuable.

## Common failures

- Missing next executable: application dependencies have not been installed.
- Transaction errors: use Atlas/a replica set, not standalone MongoDB.
- Origin/CSRF failure: APP_URL must be the exact scheme, host and port seen by the browser, with no subpath.
- Device code cannot be sent: fix SMTP credentials, TLS, provider policy and deliverability; never bypass verification.
- Scanner unavailable: run a valid, updated ClamAV worker; it must produce a fresh heartbeat before uploads are accepted.
- File stays quarantined: inspect operational scan errors/lease retry/signature age. Do not manually mark CLEAN.
- Version conflict: reload and reconcile; do not overwrite another operator's work.
