# Deploying to Vercel with MongoDB Atlas

No external infrastructure was created by the authoring process. This guide and `vercel.json` prepare the application for deployment; they are not a deployment receipt.

## Required rollout order

1. Install dependencies locally or in CI; run the full typecheck, 118 unit tests, Next.js production build and dependency audit. Commit the reviewed lockfile and use `npm ci` thereafter.
2. Provision an Atlas transaction-capable database. Run `npm run db:indexes` and the first-admin bootstrap with migration credentials. Switch production runtime credentials to a least-privilege account.
3. Provision and configure private file storage/scanning and optional Ably realtime using the sections below. Do not accept real files without an operational quarantine worker.
4. Import the repository into Vercel as a Next.js project, with Node.js 22. The repository root is the project root. The API uses the Node runtime and exports a 60-second maximum duration; confirm your Vercel plan/deployment permits your limits.
5. Set all server environment variables in Vercel. Set `APP_URL` to the exact production HTTPS origin and `REQUIRE_PRIVILEGED_MFA=true`. Do not deploy the bootstrap administrator password. Separate preview deployments from production databases and keys.
6. Deploy, then test authentication/MFA, both lead pipelines, version conflicts, duplicate warnings, two-tab alert claims, file quarantine/download, imports, report attribution and account revocation through a browser.

The homepage redirects to the application dashboard; unauthenticated workspace access goes to login. `/api/health` is a process/liveness check only, not a database/storage readiness check.

## MongoDB behavior

The shared client promise reuses a pool per running instance. Pool size is 10, minimum 0; there is still one pool per application instance, not one pool for the whole deployment. Size Atlas connections and request concurrency accordingly. Transactions use snapshot read concern and majority writes. Index migration is a separate deployment step, not an action repeated on every request.

Use Atlas query diagnostics on production-like data to add compound indexes for your actual filter/sort combinations. Keyset pagination avoids high-offset `skip()` paging, but no claim of million-record performance is made without benchmarking. Monitor database connections, query latency, write conflicts, transaction aborts and pool wait timeouts.

## Realtime and sound

Set a server-only `ABLY_API_KEY`. The browser requests a five-minute, subscribe-only capability for `waf:user:<authenticated-user-id>`. Lead contents are fetched only from the authenticated CRM API. Pub/sub messages contain an invalidation timestamp, not patient fields.

The durable source is MongoDB. An Ably hint wakes the polling loop immediately; failed/disconnected realtime falls back to polling approximately every ten seconds in an active tab, with error backoff. Presence is heartbeat-derived, with away after inactivity and offline after an expired heartbeat. Do not promise an exact delivery latency or offline desktop alerts.

Each popup/buzzer is claimed atomically on the server before display, preventing repeated sounds on refresh/reconnect/another tab. This is deliberately at-most-once sound delivery, not exactly-once audible delivery. A tab crash immediately after claiming may prevent the sound; the persisted notification remains. Enable sound with the header button after login. Background browser restrictions still apply.

## S3 configuration

Create a dedicated private bucket, enable versioning, disable public ACLs/block public access, and enable the encryption policy appropriate to your environment. Use `docs/s3-cors.example.json` with the real exact origin. Browser uploads go directly to S3 using a five-minute presigned POST; the CRM API stores metadata only.

A runtime identity requires bucket-versioning read access and object put/get/version-get access for the application's `leads/` prefix. Use the example policy as a starting point, not a universal IAM configuration. Do not grant object-delete permission to the application. Add KMS permissions only if your bucket requires a customer-managed KMS key. Signed POST compatibility must be tested for any alternative S3 endpoint.

The scanner uses authenticated `/api/internal/scan` endpoints and presigned immutable-version reads; it does not need the database credentials. Install/update ClamAV on a controlled worker host, configure the shared scanner secret and HTTPS application origin, and run:

```sh
npm run worker:scan
```

This processes at most five queued files and exits. Schedule recurring invocations in your own worker/job service; this repository does not automatically host or schedule it. Alert on retry failures, signature-update age, queue age and rejected files. Quarantine has no bypass/download endpoint.

## Operations not provisioned here

Enable suitable Atlas backups/PITR and test restoration into a separate environment. Configure S3 version retention/backups, protected audit retention and secret recovery. Define and test retention rules before introducing cleanup jobs. This repository does not silently delete historical recordings, PDFs or events.

Connect Vercel operational logs to an approved monitoring system without logging request bodies, patient values, session tokens, credentials or signed URLs. The API's error log contains a correlation ID and exception type; richer diagnostics need a privacy-safe monitoring integration. Add uptime/readiness checks, alert routing, a rollback process and documented restore targets. Monitoring dashboards, backup jobs and external service accounts are not generated by these source files.
