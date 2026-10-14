import { body, csrf, json, failure } from "./http.ts";
import { AppError } from "./domain/errors.ts";
import { actor } from "./db.ts";
import { authenticate, login, verifyDevice, logout, heartbeat, changePassword, mfaBegin, mfaConfirm, mfaDisable, rateLimit } from "./auth.ts";
import { createLead, getLead, leadView, editLead, applyWorkflow, bulkWorkflow, addActivity, revealIdentifiers, listLeads, leadHistory, leadActivities, dashboard } from "./leads.ts";
import { listNotifications, claimNotification, acknowledgeNotification, ablyTokenRequest } from "./notifications.ts";
import { saveUser, deleteUser, listUsers, assignees, team } from "./users.ts";
import { reports, auditLog, monthlyLeadStatistics } from "./reports.ts";
import { beginUpload, completeUpload, listFiles, downloadFile, fileContent, publicLogo, deleteFile } from "./storage.ts";
import { createImport, importChunk, finishImport, listImports, importErrors } from "./imports.ts";
import { publicBranding, getSettings, saveSettings, listDevices, revokeDevice } from "./settings.ts";
import { securityActivity } from "./security-events.ts";
import { deleteLead, bulkDeleteLeads } from "./deletion.ts";
import { outsourceLeads } from "./outsourcing.ts";
import { exportLeads } from "./export.ts";
export async function handle(req: Request): Promise<Response> {
    try {
        const url = new URL(req.url), path = url.pathname.replace(/^\/api\//, "").replace(/\/$/, ""), segments = path.split("/"), method = req.method, key = req.headers.get("idempotency-key");
        if (path === "health" && method === "GET")
            return json({ status: "ok", service: "CLOUD NEST BPO CRM", version: "0.3.0-rc.1" });
        if (path === "branding" && method === "GET") return json(await publicBranding());
        if (path === "branding/logo" && method === "GET") return publicLogo(req);
        csrf(req);
        if (process.env.MAINTENANCE_MODE === "true" && !["GET","HEAD"].includes(method)) throw new AppError(503,"MAINTENANCE","Maintenance is in progress. Retry after Management finishes the upgrade.");
        if ((path === "auth/login" || path === "auth/verify-device") && method === "POST") {
            const result = path === "auth/login" ? await login(req, await body(req,8192)) : await verifyDevice(req,await body(req,8192));
            const headers=new Headers();for(const value of result.cookies)headers.append("Set-Cookie",value);
            return json({user:result.user,requiresOtp:result.requiresOtp,requiresDeviceVerification:result.requiresDeviceVerification,challengeId:result.challengeId},200,headers);
        }
        if (path === "auth/logout" && method === "POST")
            return json({ ok: true }, 200, { "Set-Cookie": await logout(req) });
        const allowSetup = path.startsWith("auth/") || path === "presence";
        const { user } = await authenticate(req, allowSetup), u = actor(user);
        await rateLimit(`api:${u.id}`, 600, 60);
        if (path === "auth/me" && method === "GET")
            return json({ user: u, realtimeEnabled: !!process.env.ABLY_API_KEY, storageEnabled: !!process.env.S3_BUCKET, privilegedMfaRequired: false });
        if (path === "auth/password" && method === "POST") {
            const result = await changePassword(user, await body(req, 8192));
            return json({ ok: true }, 200, { "Set-Cookie": result.cookie });
        }
        if (path === "auth/mfa/begin" && method === "POST")
            return json(await mfaBegin(user, await body(req, 8192)));
        if (path === "auth/mfa/confirm" && method === "POST")
            return json(await mfaConfirm(user, await body(req, 8192)));
        if (path === "auth/mfa/disable" && method === "POST")
            return json(await mfaDisable(user, await body(req, 8192)));
        if (path === "presence" && method === "POST")
            return json(await heartbeat(req, await body(req, 8192)));
        if (path === "realtime/token" && method === "GET")
            return json(ablyTokenRequest(u));
        if(path === "settings/organization" && method === "GET") return json(await getSettings(u));
        if(path === "settings/organization" && method === "PATCH") return json(await saveSettings(u,await body(req,8192),key));
        if(path === "settings/logo" && method === "POST") return json(await beginUpload(u,"__branding__",await body(req,8192),key));
        if(path === "settings/logo/uploads" && method === "GET") return json(await listFiles(u,"__branding__",url));
        if(path === "security/activity" && method === "GET") return json(await securityActivity(u,url));
        if(path === "security/devices" && method === "GET") return json(await listDevices(u,url.searchParams.get("userId")||u.id));
        if(segments[0]==="security"&&segments[1]==="devices"&&segments[2]&&method==="DELETE") return json(await revokeDevice(u,segments[2]));
        if (path === "dashboard" && method === "GET")
            return json(await dashboard(u));
        if (path === "leads/export" && method === "GET")
            return exportLeads(u, url);
        if (path === "leads/bulk" && method === "POST")
            return json(await bulkWorkflow(u, await body(req), key));
        if (path === "leads/bulk-delete" && method === "POST")
            return json(await bulkDeleteLeads(u, await body(req), key));
        if (path === "leads/outsource" && method === "POST")
            return json(await outsourceLeads(u, await body(req), key));
        if (path === "leads") {
            if (method === "GET")
                return json(await listLeads(u, url));
            if (method === "POST")
                return json(await createLead(u, await body(req), key), 201);
        }
        if (segments[0] === "leads" && segments[1]) {
            const id = segments[1], sub = segments[2];
            if (!sub && method === "GET")
                return json(leadView(await getLead(u, id)));
            if (!sub && method === "DELETE") return json(await deleteLead(u,id,await body(req,8192),key));
            if (!sub && method === "PATCH")
                return json(await editLead(u, id, await body(req), key));
            if (sub === "workflow" && method === "POST")
                return json(await applyWorkflow(u, id, await body(req), key));
            if (sub === "reveal" && method === "POST")
                return json(await revealIdentifiers(u, id));
            if (sub === "history" && method === "GET")
                return json(await leadHistory(u, id, url));
            if (sub === "activities" && method === "GET")
                return json(await leadActivities(u, id, url));
            if (sub === "activities" && method === "POST")
                return json(await addActivity(u, id, await body(req), key), 201);
            if (sub === "files" && method === "GET")
                return json(await listFiles(u, id, url));
            if (sub === "files" && method === "POST")
                return json(await beginUpload(u, id, await body(req), key));
        }
        if (segments[0] === "files" && segments[1]) {
            if(segments.length===2 && method==="DELETE") return json(await deleteFile(u,segments[1],await body(req,8192),key));
            if(segments[2]==="content" && method==="GET") return fileContent(u,segments[1],req,url.searchParams.get("inline")==="1");
            if (segments[2] === "complete" && method === "POST")
                return json(await completeUpload(u, segments[1]));
            if (segments[2] === "download" && method === "GET")
                return json(await downloadFile(u, segments[1], url.searchParams.get("inline") === "1"));
        }
        if (path === "notifications" && method === "GET")
            return json(await listNotifications(u));
        if (segments[0] === "notifications" && method === "POST") {
            if (segments[2] === "claim")
                return json(await claimNotification(u, segments[1]));
            if (segments[2] === "acknowledge")
                return json(await acknowledgeNotification(u, segments[1]));
        }
        if (path === "team" && method === "GET")
            return json(await team(u, url));
        if (path === "users/assignees" && method === "GET")
            return json(await assignees(u, url.searchParams.get("department") || ""));
        if (path === "users" && method === "GET")
            return json(await listUsers(u));
        if (path === "users" && method === "POST")
            return json(await saveUser(u, null, await body(req, 32768), key), 201);
        if (segments[0] === "users" && segments.length === 2 && method === "PATCH")
            return json(await saveUser(u, segments[1], await body(req, 32768), key));
        if (segments[0] === "users" && segments.length === 2 && method === "DELETE")
            return json(await deleteUser(u, segments[1], await body(req, 8192), key));
        if (path === "reports" && method === "GET")
            return json(await reports(u, url));
        if (path === "reports/monthly" && method === "GET")
            return json(await monthlyLeadStatistics(u, url));
        if (path === "audit" && method === "GET")
            return json(await auditLog(u, url));
        if (path === "imports" && method === "GET")
            return json(await listImports(u));
        if (path === "imports" && method === "POST")
            return json(await createImport(u, await body(req), key), 201);
        if (segments[0] === "imports" && segments[1]) {
            if (segments[2] === "rows" && method === "POST")
                return json(await importChunk(u, segments[1], await body(req), key));
            if (segments[2] === "finish" && method === "POST")
                return json(await finishImport(u, segments[1], key));
            if (segments[2] === "errors" && method === "GET")
                return json(await importErrors(u, segments[1]));
        }
        throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
    }
    catch (error) {
        return failure(error);
    }
}
