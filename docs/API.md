# API reference

Base path: `/api`. All normal responses are JSON except lead CSV/XLSX exports. Cookies authenticate browser requests. Mutation requests require `Origin` matching `APP_URL`, JSON bodies, and backend authorization. `X-User-Activity: 1` marks genuine foreground interaction; do not send it on unattended polling to keep sessions alive artificially.

Lead creates/patches/workflows/activities, bulk actions, user writes, import mutations and upload initiation require a stable unique **Idempotency-Key** header (8-100 letters/digits/underscores/hyphens). Reuse the exact key AND payload for a transport retry. A new user intent gets a new key. Different payloads with an old key receive a conflict. A replay after queue access changes receives `ALREADY_APPLIED_ACCESS_CHANGED`, not a cached patient-data disclosure.

## Authentication and identity

| Method | Path | Input / purpose |
|---|---|---|
| POST | auth/login | `{username,password,otp?}`; sets session cookie |
| POST | auth/logout | Clears current session |
| GET | auth/me | Effective actor, realtime/storage configuration flags |
| POST | auth/password | `{currentPassword,newPassword}`; revokes sessions |
| POST | auth/mfa/begin | `{password}`; temporary secret and provisioning URI |
| POST | auth/mfa/confirm | `{code}`; enables MFA and returns one-use recovery codes once |
| POST | auth/mfa/disable | `{password,code}`; revokes sessions |
| POST | presence | `{lastInputAt:number,visible:boolean}`; actual last user input time |
| GET | realtime/token | Authenticated private subscribe-only Ably TokenRequest |
| GET | health | Liveness only; no credentials or patient data |

## Leads and work

| Method | Path | Input / result |
|---|---|---|
| GET | dashboard | Scoped queue counts, overdue count, recent authorized records |
| GET | leads | Cursor-paged authorized lead views |
| POST | leads | `{patient,doctor,department?,campaign?,batch?,duplicateOverrideReason?}` |
| GET | leads/:id | Scoped masked lead view |
| PATCH | leads/:id | `{version,patient?,doctor?,campaign?,batch?,duplicateOverrideReason?}` |
| POST | leads/:id/workflow | `{action,version,reason?,comment?,followUpAt?,destination?,assigneeId?}` |
| POST | leads/bulk | `{items:[{id,version}],action,...sharedActionFields}`; 1-50, atomic |
| POST | leads/:id/reveal | Permission-checked/audited identifier reveal |
| GET | leads/:id/history | `{items,nextBefore}`; pass opaque `before` for earlier events |
| GET | leads/:id/activities | `{items,nextBefore}`; same opaque history pagination |
| POST | leads/:id/activities | `{kind:"COMMENT"|"CALL"|"FAX"|"VERIFICATION",data:{...}}` |
| GET | leads/export | CSV default; `format=xlsx` for XLSX; max 1,000 per request |

List filters: `department`, `status`, `q`, `assignedTo`, `headId`, `campaign`, `batch`, `from`, `to`. Sort: `createdAt`, `updatedAt`, `code`; order `asc` or `desc`. Use ISO dates. `limit` defaults 50, maximum 100. Return shape `{items,nextCursor}`. Pass the exact `nextCursor` with the same filters/sort to advance; do not invent cursor values. Exports use `X-Next-Cursor` and `X-Exported-Rows` headers.

Actions: `SUBMIT`, `APPROVE_GENERATION`, `RETURN_GENERATION`, `QA_GOOD`, `QA_BAD`, `RESUBMIT`, `ASSIGN`, `PULL_BACK`, `DENY`, `INCOMPLETE`, `COMPLETE`, `FINALIZE`, `REOPEN`, `ARCHIVE`, `ROUTE_PV`. The state machine enforces both role and status. Required reasons/comments and future follow-ups are checked server-side. Normal finalization does not erase the completed source or agent attribution.

## Activity data

COMMENT: `comment`. CALL: `number`, `outcome`, optional `comment`, `occurredAt`, `followUpAt`. FAX: `faxNumber`, `status`, `faxDate`, optional `sentAt`, `receivedAt`, `followUpAt`, `comment`. VERIFICATION: `status`, `result`, optional/conditionally required `reason`, `verifiedAt`, `followUpAt`, `comment`. Actor/department/timestamp attribution comes from the session/server, not client-supplied identities. Follow the schemas in `src/lib/domain/validation.ts`; unknown fields are rejected.

## Users, visibility and reporting

| Method | Path | Purpose |
|---|---|---|
| GET/POST | users | Management user list/create |
| PATCH | users/:id | Management account edit, status, memberships, password reset |
| GET | users/assignees?department=... | Authorized assignment candidates |
| GET | team?after=... | Head/Management basic live team status, 100 per page |
| GET | reports?from=...&to=... | Event-based attribution, up to 366-day date range |
| GET | audit?cursor=... | Management audit; optional leadId, actorId, action filters |
| GET | notifications | Latest 100 current-user notifications and total unread count |
| POST | notifications/:id/claim | Atomic display/buzzer claim, returns `{claimed}` |
| POST | notifications/:id/acknowledge | Marks current-user item acknowledged |

User input: `{name,username,employeeId,role,memberships,accountStatus,password?}`. Global roles: SUPER_ADMIN, MANAGEMENT, STAFF. Membership: `{department,kind:"HEAD"|"AGENT",headId?}`. Agent memberships require an active matching Head. Super Admin changes require a Super Admin caller.

## Private files and imports

| Method | Path | Purpose |
|---|---|---|
| GET | leads/:id/files?after=... | Authorized metadata, 100 per page |
| POST | leads/:id/files | `{name,type,size,kind,description?}` -> presigned POST + fileId |
| POST | files/:id/complete | Validates uploaded immutable version; QUARANTINED |
| GET | files/:id/download?inline=1 | CLEAN version only; permission-checked signed URL |
| GET/POST | internal/scan | Scanner-secret bearer auth; bounded queue/results, not browser auth |
| GET/POST | imports | List/start; `{name,total,department:"CHASING"|"PV"}` |
| POST | imports/:id/rows | `{rows:[{row:1,data:{patient,doctor}}]}`; at most 25 |
| POST | imports/:id/finish | Validates processed total; sends grouped notification |
| GET | imports/:id/errors | Failed/duplicate source-row report |

S3 uploads use the returned form fields and a final `file` field. Do not upload bytes through the API JSON route. Files are not downloadable until scanned CLEAN. Direct PDF/recording history deletion is not implemented.

## Errors

Shape: `{error:{code,message,details?,errorId?}}`. Common responses: 400 invalid fields, 401 expired/revoked session, 403 forbidden or account-setup requirement, 404 inaccessible record, 409 version/idempotency/duplicate conflict, 413 oversized payload, 429 rate limit, 503 required integration not configured. The frontend treats failures as failures rather than fabricating successful saves.
