# Build and verification record

Prepared: 21 September 2026. Application version: 0.1.0.

## Executed successfully

- `npm test`: **118 tests passed, 0 failed, 0 skipped** under Node.js 22.16.0. Tests use Node's type stripping and test runner, so application dependencies are not needed for this suite.
- Strict semantic TypeScript check of dependency-free domain, validation, encryption, search and HTTP modules plus their unit tests using the preinstalled TypeScript compiler: **passed**.
- Syntax parsing, isolated transpilation and local-import existence checks across repository `.ts`/`.tsx` files: **passed**. See `verification.json` for the final checked file count.

Coverage includes department order, row/field permissions, authorized state transitions, head-only completion, required reasons/follow-ups, QA return/resubmission, original-agent attribution, full pure-domain lifecycle, invalid input/mass-assignment rejection, password validation and hashing, AES-GCM context/tamper behavior, search/duplicate normalization, CSV formula protection, base32/TOTP known vectors and replay checks, CSRF/origin checks, bounded JSON parsing, cursor validation and pagination limits.

## Not executed

A full dependency installation was attempted but the environment could not resolve `registry.npmjs.org`. As a result, no `node_modules` or generated lockfile is delivered. The **complete application typecheck, Next.js production build, browser rendering/accessibility testing and dependency vulnerability audit were not executed**. Passing syntax checks is not equivalent to passing the full application build.

No Atlas URI, S3 bucket, Ably credentials, Vercel deployment or scanner runtime was provisioned. Therefore the real MongoDB integration suite, S3/ClamAV upload/scan/download cycle, realtime provider path, multi-tab browser behavior, capacity tests and deployment smoke tests were not executed here.

`tests/integration.ts` is an opt-in test program for an empty isolated replica-set database. It exercises authentication, stored encryption/masking, API authorization, workflow transitions, retry access checks, notification claim concurrency, stable user-creation retries and account revocation. It is supplied for execution in your environment, not counted in the 118 passed tests.

## Required next verification

After dependency installation, run `npm run typecheck`, `npm test`, `npm run build`, and review `npm audit --omit=dev`. Address any dependency-version/API mismatches before deployment. Commit the reviewed lockfile and update CI to use `npm ci`.

Run the isolated MongoDB suite, then test real browser sessions for all ten effective role types. Verify imports including duplicates/errors/resume, conflicting edits, two-tab delivery, enrollment/recovery/password resets, inactive-user revocation, file-quarantine failures, every head final state and Management reopening. Load-test production-like data with measured Atlas plans before accepting the million-record target. Restore a backup and test operational alerts before onboarding real patient data.
