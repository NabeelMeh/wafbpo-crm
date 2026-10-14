# API summary - 0.3.0-rc.1

Base path: /api. The catch-all route dispatches to server-side services. Read src/lib/api.ts for the definitive method/path contract. All paths except explicitly public authentication/branding/liveness endpoints require an active enrolled session. JSON writes require an allowed request origin; idempotent mutations require an Idempotency-Key header. Wrong role/record IDs are rejected server-side.

| Method/path | Behavior |
|---|---|
| GET health | Liveness only, not infrastructure readiness |
| GET branding; GET branding/logo | Display-only brand information / currently selected clean public logo |
| POST auth/login | Password/MFA check, then session or new-device challenge; never returns security email |
| POST auth/verify-device | Bound challenge/code consume, trusted device, session |
| POST auth/logout | Revoke current session and record server logout |
| GET auth/me | Current actor/config flags, not credentials |
| POST auth/password; auth/mfa/begin; auth/mfa/confirm; auth/mfa/disable | Existing password and authenticator flows |
| GET/POST leads; GET/PATCH leads/:id | Authorized list/create/read/edit |
| POST leads/:id/workflow; POST leads/bulk | Status/claim/assignment operations; versions required; no arbitrary transfer |
| DELETE leads/:id | Authorized deletion; JSON confirmation=exact permanent code, reason, version |
| GET leads/export?format=csv\|xlsx | Mg/Admin only; full authorized details; X-Next-Cursor/X-Export-Has-More headers |
| GET leads?q=...&searchMode=medicare\|member\|username\|specialId | Advanced search for permitted Heads/Mg/Admin, intersected with record scope |
| GET leads/:id/history; GET/POST leads/:id/activities | Authorized immutable history/activity paths |
| GET/POST leads/:id/files | Authorized file listing / signed upload initialization |
| POST files/:id/complete | Verify uploaded metadata/version and quarantine |
| GET files/:id/download | Return authenticated content endpoint after authorization |
| GET files/:id/content?inline=1 | Reauthorize and stream exact clean private version |
| DELETE files/:id | Confirmation=exact filename and reason; permission required |
| GET/PATCH settings/organization | Mg/Admin only; private security recipient and branding settings |
| POST settings/logo; GET settings/logo/uploads | Mg/Admin-only logo intake/list |
| GET security/activity | Mg/Admin-only login/logout/security activity with cursor |
| GET security/devices?userId=...; DELETE security/devices/:id | Mg/Admin trusted-device administration |
| GET reports; GET reports/monthly; GET audit | Reporting; monthly/security-wide audit require Mg/Admin |
| GET/POST users; PATCH users/:id | Authorized user management |
| GET/POST imports and imports/:id subpaths | Existing raw-data import flow; direct PV intake rejected |
| GET/POST internal/scan | Separate scanner-secret authentication; leased immutable-version verdicts |

This is an index, not a generated OpenAPI guarantee. Use the exact property names in validation/types/services. Export pagination is explicit; a single response is not guaranteed to represent every matching record. Public browser headers/JavaScript do not override backend authorization.
