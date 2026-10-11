# Security design and deployment checklist

## Data and authorization

Every business API authenticates the session and checks the current user account status/version. Backend department and row scope restrict reads, searches, exports, field changes, assignments and transitions; hiding controls is not the authorization mechanism. Heads can view basic cross-department team information without gaining access to other departments' records.

Chasing/PV Agents cannot update patient, brace or insurance fields. Only authorized Generation, QA and Management views may reveal identifiers, and the reveal writes an audit event. Standard lead responses, lead history and exports mask identifiers. The authorized Management audit viewer can read decrypted audit detail and must be treated as privileged patient-data access.

All patient fields are sealed together with AES-256-GCM, random IVs and record-specific authenticated context. Audit contents, activities, MFA secrets and idempotent response bodies are also sealed. Search/duplicate indexes use HMAC fingerprints rather than plaintext patient tokens. This protects application payloads at rest but does not replace Atlas encryption, TLS, access management or minimization. Metadata, doctor contacts, file names/descriptions and user/notification information are not all application-encrypted; avoid patient identifiers in filenames, import names and free-text operational labels.

Keep the encryption and search keys different, stable, access-restricted and recoverable. This version has no keyring or automated rotation migration. Plan re-encryption/reindexing before rotation. Losing a key can make data unreadable; copying a production database also requires careful key separation and access review.

## Authentication

Passwords use salted scrypt with a 14-128-character creation/reset policy. There is no plaintext-password retrieval. Opaque session tokens are stored as SHA-256 digests. Cookies are HttpOnly, SameSite=Strict and Secure with a `__Host-` prefix in production. Sessions expire after 30 minutes of inactivity or eight hours total. Password/reset/status/membership changes revoke sessions through version checks.

TOTP enrollment requires the current password, confirmation of the secret, replay-protected codes and one-use recovery hashes. Enabling MFA requires another verified login for previously password-only sessions to access leads. Set `REQUIRE_PRIVILEGED_MFA=true` in production; ordinary staff MFA is supported but is not globally forced by that flag. Store recovery codes offline. There is no email password-reset service or administrative MFA-reset endpoint in this release.

Writes require the configured same origin and suitable fetch-site metadata. The scanner endpoint uses a distinct long bearer secret and is not a browser session API. Distributed rate limits are stored in MongoDB. Apply an upstream rate limit/firewall as well; authentication hashing and database reads are still finite resources.

## Concurrency and audit

Workflow mutations use MongoDB transactions, optimistic lead versions, duplicate-serialization guards and idempotency keys. Replayed patient-data responses recheck current lead access. Bulk workflow changes are capped at 50 and are atomic: a stale or forbidden member fails the whole action instead of silently processing a partial batch.

Audit/activities are append-only through the application API. That is NOT a claim that a database administrator cannot alter them. Use a custom runtime MongoDB role with find/insert (not update/delete) on `events`; keep migration credentials separate. Store an independent immutable audit copy or suitable managed audit trail if required. Test the runtime role against all application paths.

## Private files

Use an S3 bucket with all public access blocked, ACLs disabled and versioning enabled. Each upload gets a random object key. Metadata is finalized against an immutable VersionId. Subsequent reads are pinned to that version so reusing an upload URL cannot silently replace history.

Files stay quarantined until the worker validates the declared file signature and runs ClamAV. Do not mark files CLEAN manually to bypass scanning. PDF/audio formats can still contain active or malicious content that signature/antivirus checks miss; assess sandboxing/content disarm requirements. The provided scanner is an initial control, not a security guarantee.

Download/preview links expire after five minutes but remain usable by anyone holding the link during that period. Treat them as secrets. Do not log URLs or leak them to third-party analytics. Do not put tracking scripts, chat widgets or public error replay tools on patient pages without a data-handling review.

## Production gates

Complete a security review and patient-data handling assessment before real use. Verify vendor contracts/required agreements, authorized collection and retention, staff training, access reviews, encryption and secret backups, deletion/retention requirements, breach response and restore tests as appropriate to your obligations. No compliance certification or legal determination is provided by this repository.

Do not allow broad database network access permanently. Use supported private/network restriction options for the deployed environment, least-privilege database/storage credentials, MFA on infrastructure accounts, monitored secret access and protected production branches. The CSP is a basic framing/object protection baseline, not a complete XSS mitigation policy.
