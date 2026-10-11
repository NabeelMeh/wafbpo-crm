# Feature status - 0.3.0-rc.1

"Source implemented" means code exists in this archive. It does not mean full application or live integration acceptance has passed.

| Area | Source implemented | Outstanding verification/limits |
|---|---|---|
| Rebrand/logo | Cloud Nest UI, public branding, restricted settings, raster preview/upload/save/remove | Browser checks; S3/ClamAV required before saving a logo |
| Workflow | Automatic Gen->QA->Chasing, approved->Management, denied->PV->Management; legacy route rejection | Actual transaction/concurrent-browser and migration acceptance |
| Q/A claims | Shared visibility, five-minute exclusive claims, expiry/release, override reason, record versions | Multi-user browser/race acceptance; claim must be renewed/reclaimed before expiry |
| Accounts | Enrollment blocking, session revocation, special ID/designation, admin roles, deletion grants | All-role API/direct-ID and re-enrollment acceptance |
| Passwords/MFA | Hashing, 10-128 character policy, eye controls, existing TOTP/recovery preserved | Browser acceptance; production privileged MFA must be enabled |
| Device trust | Hashed short-lived codes, attempt/rate limits, per-user cookie trust, revocation | SMTP delivery, trust/replay/concurrency and mailbox operational approval tests |
| Exports | Mg/Admin only, full authorized identifiers/fields and related history/metadata | 1,000 leads per response; explicit continuation. 10,000 related records per category per selection; oversize fails explicitly rather than omitting data. Not an unattended million-record export |
| Search | Exact keyed Medicare/member match, indexed username/special-ID search plus original filters | Migration required; no arbitrary substring/fuzzy identifier search or cross-permission access |
| Uploads | Multiple approved docs/images/audio, random names, pinned versions, content checks, quarantined scanning, authenticated download, controlled delete | 20 selected files per UI batch; 25 MB documents, 10 MB images, 100 MB recordings, 2 MB logo. No live scanner/storage acceptance. Macro-enabled/SVG/executable/encrypted unsafe files are intentionally rejected |
| Deletion | Confirmed reasoned lead/file deletion, audit retention, asynchronous physical purge | Purge service and retention/backup policy require deployment; no complete erasure claim |
| Monthly statistics | Unique arrivals per department/month, all 12 months, movement count, server timezone | Backfill migration plus independently checked expected totals; overall total counts department receipts, not unique patients |
| Security activity | Server login/logout events, Mg/Admin notifications, protected paged log, trusted devices | Browser closure/connection loss is not explicit logout; session expiry is not falsely logged as a user logout |
| Imports/grid | Existing server pagination, mapping, preview, validation, chunked import | 5 MB / 5,000 input rows; 25-row batches; not virtualized or benchmarked to 1M rows |
| User/device lists | Existing user management and device screen | User lists/assignee queries are bounded (up to 500); device list up to 100 per user |
| Operations | Migration, env checks, scanner/purge/CI templates and deployment checklist | No infrastructure, monitored backup job, dependency lock, complete build, browser suite or production certification delivered |

Existing WAF-prefixed permanent IDs, internal storage/collection identifiers and historical documents are intentionally retained when changing them would break existing data or compatibility. New display branding and new lead IDs use Cloud Nest/CNB.
