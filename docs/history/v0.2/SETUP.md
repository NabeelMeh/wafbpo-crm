# Local setup and first-use walkthrough

## 1. Install prerequisites

Install Node.js 22 and npm. Use MongoDB Atlas or a properly initialized MongoDB replica set that supports multi-document transactions. Use a dedicated development database. Do not initially test with production patient information.

From the extracted `wafbpo-crm` directory:

```sh
npm install
cp .env.example .env.local
npm run secrets:generate
```

The dependency versions in `package.json` are ranges, not an executed dependency lock. Preserve and commit `package-lock.json` after successfully installing and validating your environment.

## 2. Configure environment variables

| Variable | Required | Purpose |
|---|---|---|
| APP_URL | Yes | Exact application origin; localhost during development, deployed HTTPS origin in production. |
| MONGODB_URI | Yes | Dedicated Atlas/replica-set connection string; never a client-side variable. |
| MONGODB_DB | Yes operationally | Dedicated database name; code defaults to `wafbpo_crm`. |
| DATA_ENCRYPTION_KEY | Yes | One random 32-byte base64 key for AES-GCM encryption. Back it up separately. |
| SEARCH_HMAC_KEY | Yes | A different random 32-byte base64 key for search, duplicate and retry fingerprints. |
| ADMIN_USERNAME / ADMIN_PASSWORD / ADMIN_NAME | Bootstrap only | Your first administrator; password must have 14-128 characters. |
| REQUIRE_PRIVILEGED_MFA | Production: true | Require Super Admin/Management MFA before lead access. |
| ABLY_API_KEY | Realtime option | Server-only key; browser gets short-lived subscribe-only capability. |
| AWS_REGION / AWS credentials / S3_BUCKET | File workflows | Private versioned S3 object storage. Prefer managed short-lived credentials in production. |
| S3_ENDPOINT | Optional | Only for compatible implementations with versioning and presigned POST support. |
| FILE_SCAN_SECRET | Files | At least 32 random characters, shared with the scanner. |
| SCANNER_APP_URL / CLAMSCAN_PATH | Scanner host only | Application origin and installed ClamAV executable. |

Do not prefix secrets with `NEXT_PUBLIC_`. Do not check `.env.local` into Git. Copy the two distinct key values from `npm run secrets:generate` into the corresponding fields; repeatedly generating or changing keys after saving data will make existing ciphertext unreadable or search indexes unusable.

## 3. Initialize and run

```sh
npm run env:check
npm run db:indexes
npm run db:admin
npm run dev
```

The index script is repeatable. The administrator bootstrap is deliberately one-time and refuses when a Super Admin already exists. It inserts no sample leads. Atlas database roles used for migration must permit index creation; use a more restricted account for the deployed application afterward.

Open `http://localhost:3000`, sign in, enroll MFA in **Security**, securely save the eight one-use recovery codes, then sign out and sign in again. The enrollment response does not retroactively grant MFA verification to older password-only sessions.

## 4. Create your organization

In **Users & access**, create an active Head for each of Generation, Q/A, Chasing and Patient Verification. Then create Agents and attach each Agent membership to an active Head in that same department. Accounts may have multiple department memberships. Global Management and Super Admin access are separate from department memberships.

New/reset passwords force a password change before lead work. User role, membership, password-reset and status changes revoke existing sessions. The last active Super Admin cannot be demoted or deactivated through the API.

## 5. Exercise the actual pipeline

Create a Generation Agent lead and save a draft. Supply every required patient and doctor field before submitting. Sign in as the Generation Head and approve it to Q/A. The Q/A Head assigns it to an Agent; QA BAD needs a reason and comment, while GOOD moves it to the Chasing Head's queue. The Chasing Head assigns an Agent, who can log calls, add PDFs and update doctor/fax information but cannot change the brace or complete the record. The Head completes it to Management.

Management can also import directly into Chasing/PV, or route/reopen a record to PV. The PV Head assigns work and performs final completion. Management reviews, finalizes, reopens or archives. There is no implicit Chasing -> PV transfer.

Click **Enable buzzer** in the header. Browsers require a user gesture before audible alerts; the application does not claim to bypass that restriction. Test popup/buzzer delivery in two open tabs to check the server's single delivery claim.

## 6. Tests and a production build

```sh
npm run typecheck
npm test
npm run build
```

The unit suite runs without installed application dependencies on Node 22 using the experimental type-stripping flag. The full application checks require `npm install`.

For real database integration testing:

```sh
cp .env.test.example .env.test
# Set a dedicated replica-set URI and an EMPTY wafbpo_*test database.
npm run test:integration
```

The suite refuses a populated database and requires explicit write permission. Its generated encryption keys are ephemeral, and all fixture records are synthetic. Set `TEST_ALLOW_DB_DROP=true` only for this isolated database to remove it after the suite. No external storage, browser or Vercel end-to-end checks are included in that suite.

## Common startup failures

A MongoDB standalone/transaction error means a replica set or Atlas deployment is required. `CONFIGURATION_REQUIRED` or CSRF failures usually mean `APP_URL` does not match the exact browser origin. `PASSWORD_CHANGE_REQUIRED` directs the user to Security. `MFA_REQUIRED` requires privileged MFA enrollment; `MFA_REAUTH_REQUIRED` requires a new MFA-verified login after enrollment. A file that remains quarantined needs a functioning scanner, not a bypass. A `VERSION_CONFLICT` means another edit changed the record: reload and reconcile rather than overwriting.
