# Production acceptance - release remains BLOCKED

Version: 0.3.0-rc.1. All unchecked items below are required acceptance work, not completed work. Use an isolated staging deployment and synthetic records. Record the tester, build commit/ZIP checksum, environment, actual result and date for each item. Do not enter real patient data until the responsible owner signs off.

## Build and dependency gate

- [ ] Install actual dependencies successfully and resolve every compatibility error.
- [ ] Generate/review/commit package-lock.json; a fresh npm ci succeeds.
- [ ] npm test, npm run test:types, npm run typecheck and npm run build all pass on the exact release source.
- [ ] Dependency security audit passes or has formally assessed, documented exceptions; no unreviewed high/critical issue.
- [ ] Isolated integration suite passes; no test points to production.
- [ ] Actual browser checks pass on supported desktop/mobile browsers; no console errors, unusable controls or broken layouts.

## Migration, accounts and authorization

- [ ] Restore a backup into staging; preserve database name, original IDs and both encryption keys.
- [ ] Review dry run, resolve identity collisions, stop old writers, apply and inspect migration exceptions.
- [ ] Test Agent, each department Head, Management, Admin and legacy Super Admin separately.
- [ ] Wrong password denied; enrollment block denies correct password, existing session and direct API access; re-enrollment restores permitted access.
- [ ] Privileged MFA required; password change/reset/recovery and eye controls work; no plaintext passwords returned or stored.
- [ ] New device gets a code only after credentials; the server-only configured mailbox receives it. Security email does not appear in public API/client bundle.
- [ ] Wrong, expired, replayed and excessive-attempt codes rejected. Codes are single use under two simultaneous requests.
- [ ] Trusted device avoids another challenge only for the same user; revoked/expired/cleared-cookie and session-version changes require verification again.
- [ ] Every successful login/explicit logout has correct server actor, special ID, designation and timestamp, visible only to Mg/Admin. Browser-close is not misrepresented as explicit logout.
- [ ] Unauthorized export/delete/settings/record-ID manipulation fails via direct HTTP requests, including stolen cross-department IDs.

## Workflows and concurrency

- [ ] Generation submit and all legacy rework resubmissions go directly to Q/A and leave the prior active queue.
- [ ] Two QA agents see the same single record. One claims it; others cannot edit fields, activities, files or outcomes while claimed.
- [ ] Claim expiry, holder renewal/release, reasoned Head release and conflicting simultaneous claims behave correctly.
- [ ] Q/A GOOD -> Chasing; BAD -> original Generation agent. No duplicate leads appear.
- [ ] Chasing Head COMPLETE -> Management; DENY -> PV with denial provenance; agents cannot perform Head-only final actions.
- [ ] PV COMPLETE -> Management. Unapproved/direct PV create/import/reopen attempts fail, including Admin API calls.
- [ ] Management reopen derives the permitted destination; finalized/archived/legacy records behave correctly.
- [ ] Lead ID remains constant; version conflicts are not silently overwritten; audit records include source/destination/action/user/special ID/time.

## Storage, logo and deletion

- [ ] Versioning, private/public-access-block, encryption, exact-origin CORS and least-privilege identities are verified.
- [ ] Upload multiple PDF, approved Office/text/image and supported audio files from every authorized department; view/download only after scanning.
- [ ] Reject executable/SVG/macros/path traversal/MIME mismatch/oversize/empty files; exercise bounded archive expansion/content checks.
- [ ] Use approved harmless antivirus test fixtures in an isolated test bucket; verify rejection, no execution and no unauthorized download.
- [ ] Stop scanner/update signatures/expire lease: uploads fail closed or files remain quarantined; retries never auto-release a file.
- [ ] Revoked/enrollment-blocked/cross-department users cannot use saved content URLs.
- [ ] Mg/Admin can preview, scan, save/replace/remove logo; all pages update; staff cannot change it.
- [ ] Confirmed deletion removes authorized lead/file access, preserves appropriate audit and queues bytes. Purge worker removes exact object versions with separate credentials.
- [ ] Retention/backups/audit handling is approved; operational deletion is not falsely described as total erasure.

## Data and operational acceptance

- [ ] Full Mg/Admin exports contain unmasked Medicare/member IDs, all supported scalar fields and related metadata/history. Formula injection neutralized.
- [ ] Export continuation includes all requested pages; detail/cell limits fail clearly, never silently truncate.
- [ ] Medicare/member/username/special-ID search matches expected rows and never broadens role/department access.
- [ ] Independently compute monthly sample totals; test timezone boundaries, repeat department visits, movement counts, historical migration and future empty months. Overall receipt totals are labeled correctly.
- [ ] Import limits, validation, duplicate handling and interruption/resume work. No direct PV intake.
- [ ] Notification popup/buzzer, multiple tabs, reconnection and polling fallback behave as documented.
- [ ] Load/throughput, service timeouts, storage streaming and database index/connection capacity meet the measured business target.
- [ ] Monitoring, incident alerts, scanner-signature/queue alerts, backup restoration, secret recovery and rollback drill pass.
- [ ] Privacy/security review and organizational approval completed for real patient data.

## Approval record

Release checksum: ____________________
Build/commit: ____________________
Environment and service versions: ____________________
Test evidence location: ____________________
Unresolved defects: ____________________
Responsible technical approver and date: ____________________
Responsible business/security approver and date: ____________________

**Approval has not been given by this archive.**
