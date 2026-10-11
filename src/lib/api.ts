import { body, csrf, json, failure } from "./http.ts";
import { AppError } from "./domain/errors.ts";
import { actor } from "./db.ts";
import { authenticate, login, logout, heartbeat, changePassword, rateLimit } from "./auth.ts";
import { createLead, getLead, leadView, editLead, applyWorkflow, bulkWorkflow, addActivity, revealIdentifiers, listLeads, leadHistory, leadActivities, dashboard } from "./leads.ts";
import { listNotifications, claimNotification, acknowledgeNotification, ablyTokenRequest } from "./notifications.ts";
import { saveUser, listUsers, assignees, team } from "./users.ts";
import { reports, auditLog } from "./reports.ts";
import { beginUpload, completeUpload, listFiles, downloadFile, scannerAuth, scanQueue, scanResult } from "./storage.ts";
import { createImport, importChunk, finishImport, listImports, importErrors } from "./imports.ts";
import { exportLeads } from "./export.ts";
export async function handle(req: Request): Promise<Response> {
    try {
        const url = new URL(req.url), path = url.pathname.replace(/^\/api\//, "").replace(/\/$/, ""), segments = path.split("/"), method = req.method, key = req.headers.get("idempotency-key");
        if (path === "health" && method === "GET")
            return json({ status: "ok", service: "WAFBPO SOLUTIONS CRM", version: "0.1.0" });
        if (path.startsWith("internal/scan")) {
            scannerAuth(req);
            if (path === "internal/scan" && method === "GET")
                return json(await scanQueue());
            if (path === "internal/scan" && method === "POST")
                return json(await scanResult(await body(req)));
            throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
        }
        csrf(req);
        if (path === "auth/login" && method === "POST") {
            const result = await login(req, await body(req, 8192));
            return json({ user: result.user }, 200, { "Set-Cookie": result.cookie });
        }
        if (path === "auth/logout" && method === "POST")
            return json({ ok: true }, 200, { "Set-Cookie": await logout(req) });
        const allowSetup = path.startsWith("auth/") || path === "presence";
        const { user } = await authenticate(req, allowSetup), u = actor(user);
        await rateLimit(`api:${u.id}`, 600, 60);
        if (path === "auth/me" && method === "GET")
            return json({ user: u, realtimeEnabled: !!process.env.ABLY_API_KEY, storageEnabled: !!process.env.S3_BUCKET });
        if (path === "auth/password" && method === "POST") {
            const result = await changePassword(user, await body(req, 8192));
            return json({ ok: true }, 200, { "Set-Cookie": result.cookie });
        }
        if (path === "presence" && method === "POST")
            return json(await heartbeat(req, await body(req, 8192)));
        if (path === "realtime/token" && method === "GET")
            return json(ablyTokenRequest(u));
        if (path === "dashboard" && method === "GET")
            return json(await dashboard(u));
        if (path === "leads/export" && method === "GET")
            return exportLeads(u, url);
        if (path === "leads/bulk" && method === "POST")
            return json(await bulkWorkflow(u, await body(req), key));
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
        if (path === "reports" && method === "GET")
            return json(await reports(u, url));
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
