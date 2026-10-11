# Cloud Nest BPO CRM v0.2

This is an in-place upgrade of the WAFBPO CRM foundation. Existing lead IDs remain unchanged.

Implemented in this package: Cloud Nest branding, automatic Generation->QA, QA->Chasing, Chasing Complete->Management, Chasing Denied->PV, PV Complete->Management routing; backend enrollment blocking; Management/Admin-only full-field exports; login/logout audit metadata; 10-character minimum password policy; monthly statistics endpoint/UI; QA visibility for unassigned QA work.

Still requires live infrastructure configuration/acceptance: new-device email verification, logo upload storage, ClamAV/S3 scanner deployment, and browser-level concurrency testing. Do not claim production certification until those integrations pass.
