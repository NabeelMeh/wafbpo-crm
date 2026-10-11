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

export async function monthlyLeadStatistics(u:Actor,url:URL){
 assert(isManagement(u),403,"FORBIDDEN","Management/Admin access is required.");
 const year=Number(url.searchParams.get("year")||new Date().getUTCFullYear()),timezone=process.env.REPORT_TIMEZONE||"Asia/Karachi";
 assert(Number.isInteger(year)&&year>=2020&&year<=2100,400,"INVALID_YEAR","Invalid reporting year.");
 try{new Intl.DateTimeFormat("en",{timeZone:timezone}).format();}catch{assert(false,503,"INVALID_TIMEZONE","Configure a valid reporting timezone.");}
 const c=await collections(),from=new Date(Date.UTC(year,0,1)-172800000).toISOString(),to=new Date(Date.UTC(year+1,0,1)+172800000).toISOString();
 const date={$dateFromString:{dateString:"$at"}},departments=["GENERATION","QA","CHASING","PV","MANAGEMENT"];
 const rows=await c.events.aggregate<{_id:{month:number;department:string};count:number;movements:number}>([
 {$match:{at:{$gte:from,$lt:to},arrivalDepartment:{$in:departments},leadId:{$exists:true}}},
 {$addFields:{reportYear:{$year:{date,timezone}},reportMonth:{$month:{date,timezone}}}},{$match:{reportYear:year}},
 {$group:{_id:{month:"$reportMonth",department:"$arrivalDepartment",leadId:"$leadId"},movements:{$sum:1}}},
 {$group:{_id:{month:"$_id.month",department:"$_id.department"},count:{$sum:1},movements:{$sum:"$movements"}}}
 ],{maxTimeMS:15000}).toArray();
 return {year,timezone,definition:"Unique leads received per department per month. Total is department receipts, not distinct leads across the whole organization. Repeated receipts are shown separately as movement counts.",items:Array.from({length:12},(_,i)=>{const counts=Object.fromEntries(departments.map(d=>[d,rows.find(x=>x._id.month===i+1&&x._id.department===d)?.count||0]));return {month:i+1,...counts,total:Object.values(counts).reduce((a,b)=>a+b,0),movementCount:rows.filter(x=>x._id.month===i+1).reduce((a,b)=>a+b.movements,0)};})};
}
