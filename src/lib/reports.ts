import type { Actor } from "./domain/types.ts";
import { collections } from "./db.ts";
import { assert } from "./domain/errors.ts";
import { isManagement, isHead } from "./domain/policy.ts";
import { eventView } from "./audit.ts";
import { decodeCursor, encodeCursor } from "./http.ts";
export async function reports(u: Actor, url: URL) {
    const from = url.searchParams.get("from") || new Date(Date.now() - 30 * 86400000).toISOString(), to = url.searchParams.get("to") || new Date().toISOString();
    assert(Number.isFinite(Date.parse(from)) && Number.isFinite(Date.parse(to)) && Date.parse(to) >= Date.parse(from), 400, "INVALID_DATE", "Select a valid report date range.");
    assert(Date.parse(to) - Date.parse(from) <= 366 * 86400000, 400, "RANGE_TOO_LARGE", "Choose a report range of no more than 366 days.");
    let scope: Record<string, unknown> = {};
    if (!isManagement(u))
        scope = isHead(u) ? { department: { $in: u.memberships.filter(m => m.kind === "HEAD").map(m => m.department) } } : { $or: [{ actorId: u.id }, { agentId: u.id }, { generationAgentId: u.id }] };
    const c = await collections();
    const grouped = await c.events.aggregate<{
        _id: {
            actorId: string;
            agentId?: string;
            generationAgentId?: string;
            action: string;
            department: string;
        };
        count: number;
    }>([
        { $match: { $and: [scope, { at: { $gte: new Date(from).toISOString(), $lte: new Date(to).toISOString() } }] } },
        { $group: { _id: { actorId: "$actorId", agentId: "$agentId", generationAgentId: "$generationAgentId", action: "$action", department: "$department" }, count: { $sum: 1 } } }
    ], { maxTimeMS: 15000 }).toArray();
    const result = new Map<string, {
        userId: string;
        department: string;
        metrics: Record<string, number>;
    }>();
    function add(id: string | undefined, department: string, metric: string, n: number) {
        const uid = id || "unassigned";
        if (!isManagement(u) && !isHead(u) && uid !== u.id)
            return;
        const k = `${uid}:${department}`, row = result.get(k) || { userId: uid, department, metrics: {} };
        row.metrics[metric] = (row.metrics[metric] || 0) + n;
        result.set(k, row);
    }
    for (const { _id: g, count } of grouped) {
        const a = g.action;
        if (["CREATED", "SUBMIT", "QA_GOOD", "QA_BAD", "RESUBMIT", "RETURN_GENERATION"].includes(a) && g.generationAgentId && (["QA_GOOD", "QA_BAD"].includes(a) || g.department === "GENERATION"))
            add(g.generationAgentId, "GENERATION", ({ CREATED: "Created", SUBMIT: "Submitted", QA_GOOD: "QA good", QA_BAD: "QA bad / rework", RESUBMIT: "Resubmitted", RETURN_GENERATION: "Returned by head" } as Record<string, string>)[a], count);
        if (a === "QA_GOOD" || a === "QA_BAD")
            add(g.actorId, "QA", a === "QA_GOOD" ? "Good" : "Bad", count);
        if (["CHASING", "PV"].includes(g.department)) {
            const metrics: Record<string, string> = { ASSIGN: "Assigned", CALL: "Calls", FAX: "Fax updates", FILE_UPLOADED: "Files", INCOMPLETE: "Incomplete", DENY: "Denied", COMPLETE: "Completed", VERIFICATION_VERIFIED: "Verified", VERIFICATION_NOT_VERIFIED: "Not verified", EDITED: "Edits", COMMENT: "Comments" };
            if (metrics[a])
                add(["ASSIGN", "INCOMPLETE", "DENY", "COMPLETE"].includes(a) ? g.agentId : g.actorId, g.department, metrics[a], count);
        }
    }
    const ids = [...new Set([...result.values()].map(x => x.userId))], users = await c.users.find({ _id: { $in: ids } }, { projection: { name: 1, employeeId: 1 } }).toArray();
    return { from, to, items: [...result.values()].map(x => ({ ...x, name: users.find(v => v._id === x.userId)?.name || "Unassigned", employeeId: users.find(v => v._id === x.userId)?.employeeId || "" })) };
}
export async function auditLog(u: Actor, url: URL) {
    assert(isManagement(u), 403, "FORBIDDEN", "Management access is required.");
    const c = await collections(), filter: Record<string, unknown> = {};
    for (const key of ["leadId", "actorId", "action"]) {
        const value = url.searchParams.get(key);
        if (value)
            filter[key] = value.slice(0, 100);
    }
    const cursor = decodeCursor(url.searchParams.get("cursor"));
    if (cursor)
        filter.$or = [{ at: { $lt: cursor.at } }, { at: cursor.at, _id: { $lt: cursor.id } }];
    const rows = await c.events.find(filter).sort({ at: -1, _id: -1 }).limit(101).toArray(), items = rows.slice(0, 100), last = items.at(-1);
    return { items: items.map(e => eventView(e, true)), nextCursor: rows.length > 100 && last ? encodeCursor({ at: last.at, id: last._id }) : null };
}
