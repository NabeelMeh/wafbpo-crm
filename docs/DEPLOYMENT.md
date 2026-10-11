# Deployment and operations

No infrastructure was provisioned by generating this archive. Complete docs/PRODUCTION_ACCEPTANCE.md in staging before real patient data is introduced.

## Application and database

Use the package root as a Next.js project. The API uses the Node runtime and declares a 60-second maximum duration. Verify the actual deployment plan supports request sizes/durations and authenticated file streaming. No guarantee of hosting-platform capacity is made.

Run npm install once, fix dependency/API issues, run full checks, commit the reviewed lockfile, and use npm ci thereafter. The example CI refuses to pass without a lockfile. Set production APP_URL to the exact HTTPS origin and REQUIRE_PRIVILEGED_MFA=true. Keep preview and test deployments isolated from production databases and secrets. Do not deploy ADMIN_PASSWORD. Run `npm run env:check:production` against the deployment environment; this only validates configuration format, not service connectivity.

MongoDB needs multi-document transactions. Run the reviewed migration separately under temporary migration privileges, then use least-privilege runtime credentials. Keep the original database name and data/search keys. Use private network access/allowlisting appropriate to the hosting setup. Size pools and query indexes against measured load rather than assuming a million-record performance target has passed.

GET /api/health reports process liveness only. It is not a database, SMTP, storage or scanner readiness result.

## SMTP and new-device codes

Set SMTP_HOST, SMTP_PORT (465 or 587), SMTP_USER, SMTP_PASSWORD and SMTP_FROM in server-only secret storage. The client requires TLS and certificate validation. Use credentials authorized for the sending service; do not paste a personal mailbox password into source code. Configure sender authentication and delivery policy with the provider. Actual delivery, latency and spam handling must be tested.

SECURITY_EMAIL is a server-only fallback. Authorized Management/Admin users can update the encrypted setting in Organization settings. Never use NEXT_PUBLIC_ variables for it. Public branding responses contain only the brand name/logo URL/revision.

Codes expire after five minutes, are single use and limited to five counted attempts. Trust is per user and opaque browser cookie, expires after 90 days and can be revoked. A shared verification mailbox is an organizational approval dependency, not a replacement for privileged MFA or independent identity proofing.

## Private S3 storage

Create a private bucket with VERSIONING ENABLED, all public-access blocks enabled, public ACLs disabled and approved encryption/retention. Set exact-origin CORS using docs/s3-cors.example.json. Test multipart browser POST/CORS and immutable-version reads. The application uses both leads/ and branding/ prefixes. Update the IAM example's bucket name; do not grant application runtime object-delete permission.

Browser uploads use short-lived signed POSTs bound to random object keys, canonical content type and exact size. Completion verifies actual object metadata and pins a version. Files remain unreadable until the separate scanner validates content and marks that exact version CLEAN. Downloads are streamed through the authenticated CRM API, rechecking record authorization rather than returning reusable public file URLs. Only the explicitly selected clean logo is intentionally public.

For custom S3_ENDPOINT deployments, verify versioning, presigned POST, range reads, private access and deletion semantics; compatibility is not assumed.

## ClamAV worker - runs outside Vercel

Use an isolated, maintained worker host with Node dependencies installed and a real ClamAV installation. Run freshclam/signature updates through your host's approved service. The worker requires SCANNER_APP_URL, FILE_SCAN_SECRET, CLAMSCAN_PATH and, optionally, CLAMAV_MAX_SIGNATURE_AGE_HOURS (default 48). It does not need patient data keys or database credentials for scanning.

```sh
clamscan --version
# Start/update freshclam using your host's supported service procedure.
npm run worker:scan
```

Each invocation checks signature freshness, obtains at most ONE leased immutable file, performs bounded content inspection and ClamAV scanning, reports the verdict and exits. Run it repeatedly (for example every 15 seconds after completion). First run it with an empty queue to establish the heartbeat before accepting uploads. The application refuses uploads when the last heartbeat is older than five minutes. Operational errors remain quarantined and retry after the lease expires; they are never treated as clean.

Example systemd unit/timer files are under deploy/. Review paths, service user, secrets permissions, ClamAV flags, resource limits and sandboxing on your host before enabling. These templates have not been run here. Do not make the scan API public without its independent bearer secret or reuse application/data keys as that secret.

Alert on signature age, worker failures, stale heartbeat, growing queue, stuck leases and rejected files. One-file batches may need multiple controlled workers for the required throughput; measure it. Format inspection is a defense layer, not a substitute for maintained malware scanning and safe endpoints.

## Authorized physical deletion

UI/API deletion records an audit event and immediately removes normal access. File bytes are queued for a separate worker:

```sh
npm run worker:purge
```

The purge worker needs narrowly scoped list-versions/delete-version permissions for the private prefixes and database access; the web runtime does not. It removes all versions of the exact object key and marks metadata PURGED. Schedule it according to your approved retention/deletion policy. It processes at most 25 queued files per run.

Audit records intentionally survive deletion and may retain historical encrypted details. Backups and legal retention are not erased by this worker. This is operational deletion, NOT a promise of complete privacy-law erasure. Define lawful retention with the organization's responsible privacy/security personnel before live use.

## Realtime and operations

ABLY_API_KEY is optional; authenticated polling is the fallback. Private channels use stable internal names for upgrade compatibility. Pub/sub signals invalidate data; lead contents still come from authorized APIs. Browser audio requires a user gesture and can be suppressed by the browser. Sound is at-most-once per server claim, not guaranteed exactly-once delivery.

Configure backups/PITR, object retention, recoverable secrets, encrypted audit retention, privacy-safe logs, monitoring/alerts, incident response and restore drills. Add application and infrastructure load tests. Logs must not contain patient payloads, verification codes, passwords, signed URLs or session tokens. Self-hosted deployment needs a deliberately configured trusted proxy/edge rate limiter; arbitrary forwarded IP headers are not trusted by the source.

Do not lift the release block until build, functional, external-service, security, backup/restore and business acceptance are recorded. No compliance certification or penetration-test pass is implied.
