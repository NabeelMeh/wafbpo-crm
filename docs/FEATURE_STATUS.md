# Feature status and acceptance boundaries

This matrix separates implemented code from unverified integrations and remaining requirements. "Implemented" means source paths and backend behavior exist; it does not mean the external integration or browser workflow was executed in this environment.

| Area | Implemented in v0.1 | Remaining acceptance work |
|---|---|---|
| Department order and routing | All five navigation departments, Generation -> QA -> Chasing -> Management; Management-controlled PV | Business acceptance with actual Heads/Agents |
| Roles and accounts | Global admin/management plus multi-department head/agent memberships, hierarchy, status changes, password reset and session revocation | Identity-provider SSO is not included; user administration/assignee lists currently cap at 500 |
| Lead generation | Required fields, draft autosave, head review, permanent year-based IDs | Clinical/insurance eligibility validation is not provided; NPI checks are format-only, not registry validation |
| Duplicate handling | Identifier, member ID, phone, name+DOB, phone+DOB keyed matches; transaction guards; reasoned Management override | Fuzzy names, international phone canonicalization, sophisticated match scoring and override delegation to selected non-Management roles |
| QA/rework | Full authorized edits, GOOD/BAD, mandatory bad reason/comment, original agent return, resubmission sequence | Additional convenient copy controls for all permitted patient/insurance fields |
| Chasing | Doctor-only Agent field edits, calls/fax/comments, head assignments/pullback/denial/incomplete/completion | Spreadsheet-style inline cell editing is not included; grid opens the detailed editor |
| Patient Verification | Separate intake, assignment, calls, verification statuses/results, head final actions | Business validation of organization-specific verification rules |
| History | Separate append-only event/activity records; no overwrite/delete routes for history | Database enforcement of insert/find-only audit privileges and independently retained audit copies |
| Files | Multiple private version-pinned PDFs/recordings, quarantine/scanner script, allowed preview/download | S3/ClamAV live testing, scanner hosting/signature updates, advanced content sanitization; no external URL-only recording import |
| Incoming alerts | Durable notification records, private realtime hints, 10-second polling fallback, popups, opt-in buzzer, atomic claim, bulk grouping | Multi-browser/end-to-end testing; inbox exposes latest 100, not a full historical paging UI; claim-before-sound is at-most-once and can lose a sound if a tab crashes immediately after claiming |
| Presence | Head/Management cross-department basic status, active/away/offline/inactive, last login/activity; heartbeat/expiry | Not a hard realtime SLA; status is heartbeat-derived and background tabs may appear offline |
| Scale and grid | Indexed Mongo queries, bounded reads, cursor pagination, server filtering/sorting/search | No virtual scrolling, no million-record benchmark, no Atlas capacity sizing; some filter combinations require additional measured indexes |
| Imports | CSV/XLSX mapping, preview, validation, 25-row transactional chunks, idempotent resume, duplicate/failure reports, grouped completion alert | Current file limit 5 MB / 5,000 rows; no unattended large-dataset worker; no user-selected skip-row UI; XLSX dates handled but ID columns should be text |
| Exports | Authorized, masked CSV/XLSX up to 1,000 rows per response with next-cursor header | UI does not orchestrate multi-part/full million-record downloads; async full-export worker required |
| Search/filters | Lead/patient/contact/doctor/NPI/insurance/member/campaign/batch indexed prefixes; API dept/agent/head/status/date filters | Not arbitrary substring/fuzzy/full-text search; most advanced API filters are not exposed as dedicated toolbar controls |
| Reports | Event counts with agent completion attribution, rolling 7/30-day and custom ranges, CSV export | Full requested parity: QA total reviewed/resubmitted reviewed, unique records worked, PDF-only counts and some departmental KPI distinctions; calendar-period grouping and reporting timezone policy |
| Security | Password hashing, opaque sessions, CSRF/origin checks, rate limiting, MFA, field sealing/masking, audit, RBAC/row checks | Penetration test, full CSP design, infrastructure hardening, encryption-key rotation migration, threat/compliance review |
| Operations | Vercel-compatible route, env templates, indexes/bootstrap, CI definition, scanner script, isolated DB integration suite | Live deployment, operational monitoring/error integration, alerting, backup jobs, restore drills and on-call runbooks |

## Deliberate implementation choices

- Users can have one global role and multiple department memberships. This represents the ten requested effective user types without brittle mutually exclusive role strings.
- Incoming unassigned work is sent to active department Heads. An Agent is notified when assigned; unassigned Agents cannot browse someone else's queue. Generation drafts remain private to the creator and Management before submission.
- Management alone overrides duplicate warnings. Heads can see all non-draft work within their department, but other departments' lead contents are not exposed by the live-team screen.
- Patient Verification remains separately controlled. Both a directly imported PV record and a Management-routed record are supported.
- The realtime transport is Ably, an equivalent external coordination architecture permitted by the source. This is not a claim that Vercel lacks native WebSocket support. Vercel hosts the Next.js frontend and all public CRM APIs.
- Dates are stored in UTC, displayed in the browser's locale/timezone. Daily reporting boundaries should be agreed before rollout across countries.
- History/file counts are not stored in unbounded lead-document arrays. This avoids document growth from accumulating calls and recordings, but historical records and idempotency keys still require a retention/capacity policy.

The supplied source is unchanged in `ORIGINAL_REQUIREMENTS.txt`. This repository must not be advertised as fully production-ready until the open items relevant to your deployment are closed.
