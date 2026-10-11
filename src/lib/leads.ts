import { randomUUID } from "node:crypto";
import type { ClientSession, Filter } from "mongodb";
import { collections, transaction, actor as toActor } from "./db.ts";
import type { Actor, LeadDoc, LeadCore, LeadView, Patient, WorkflowInput, WorkDepartment } from "./domain/types.ts";
import { DEPARTMENTS, STATUSES, EMPTY_DOCTOR } from "./domain/types.ts";
import { assert, AppError } from "./domain/errors.ts";
import { assertRead, assertCreate, assertEdit, isManagement, isHead, canReveal, leadScope, canAssignTo, canEditDoctor, canReadLead } from "./domain/policy.ts";
import { record, text, onlyKeys, parsePatient, parseDoctor, partialPatient, partialDoctor, validateLead, parseWorkflow, parseActivity } from "./domain/validation.ts";
import { transition } from "./domain/workflow.ts";
import { seal, unseal, blind } from "./crypto.ts";
import { duplicateKeys, searchTokens, queryToken, mask } from "./search.ts";
import { audit, eventView } from "./audit.ts";
import { recipientIds, insertNotifications, publishHint } from "./notifications.ts";
import { encodeCursor, decodeCursor, pageLimit } from "./http.ts";
export const patientOf = (lead: LeadDoc) => unseal<Patient>(lead.patientSealed, `patient:${lead._id}`);
export function leadView(lead: LeadDoc): LeadView {
    const { patientSealed, searchTokens: tokens, duplicateKeys: dups, ...rest } = lead;
    const p = patientOf(lead);
    return { ...rest, patient: { ...p, identifier: mask(p.identifier), memberId: mask(p.memberId) }, identifiersMasked: true };
}
export async function idempotent<T>(u: Actor, key: string | null, input: unknown, fn: (s: ClientSession) => Promise<{
    data: T;
    notify: string[];
}>): Promise<T> {
    assert(key && /^[a-zA-Z0-9_-]{8,100}$/.test(key), 400, "IDEMPOTENCY_KEY_REQUIRED", "A unique Idempotency-Key header is required for this action.");
    const c = await collections(), id = `${u.id}:${key}`, requestHash = blind(`request:${JSON.stringify(input)}`);
    let out: {
        data: T;
        notify: string[];
    } | undefined;
    for (let attempt = 0; attempt < 3; attempt++)
        try {
            out = await transaction(async (s) => {
                const old = await c.idempotency.findOne({ _id: id }, { session: s });
                if (old) {
                    assert(old.requestHash === requestHash, 409, "IDEMPOTENCY_CONFLICT", "This request key was already used for different data.");
                    const cached = unseal<{
                        data: T;
                        notify: string[];
                    }>(old.responseSealed, `idempotency:${id}`);
                    // Replays must not expose cached patient data after a record leaves the actor's queue.
                    const data = cached.data as unknown as Record<string, unknown>;
                    const candidates = data && typeof data === "object" ? (Array.isArray(data.items) ? data.items : [data]) : [];
                    for (const candidate of candidates) {
                        if (candidate && typeof candidate === "object" && "patient" in candidate && "department" in candidate && typeof candidate._id === "string") {
                            const current = await c.leads.findOne({ _id: candidate._id }, { session: s });
                            assert(current && canReadLead(u, current), 409, "ALREADY_APPLIED_ACCESS_CHANGED", "The request was already applied; this record is now outside your authorized queue.");
                        }
                    }
                    return cached;
                }
                const result = await fn(s);
                await c.idempotency.insertOne({ _id: id, actorId: u.id, requestHash, responseSealed: seal(result, `idempotency:${id}`), createdAt: new Date().toISOString() }, { session: s });
                return result;
            });
            break;
        }
        catch (e) {
            if ((e as {
                code?: number;
            }).code !== 11000 || attempt === 2)
                throw e;
        }
    assert(out, 500, "TRANSACTION_FAILED", "Transaction did not complete.");
    await publishHint(out.notify);
    return out.data;
}
async function checkDuplicates(u: Actor, p: Patient, exclude: string, reason: string, session: ClientSession) {
    const c = await collections(), keys = duplicateKeys(p);
    // Serialization guards close the "both checked, neither inserted" race across concurrent requests.
    for (const key of [...keys].sort())
        await c.duplicateGuards.updateOne({ _id: key }, { $inc: { version: 1 } }, { upsert: true, session });
    const hits = keys.length ? await c.leads.find({ _id: { $ne: exclude }, duplicateKeys: { $in: keys } }, { session, projection: { _id: 1, code: 1 } }).limit(10).toArray() : [];
    if (hits.length) {
        if (!(isManagement(u) && reason.trim().length >= 3))
            throw new AppError(409, "POSSIBLE_DUPLICATE", "Possible duplicate. Management may override with a documented reason.", { count: hits.length, ...(isManagement(u) ? { records: hits } : {}) });
    }
    return { keys, overridden: hits.length > 0 };
}
export async function createLeadCore(u: Actor, raw: unknown, s: ClientSession, quiet = false): Promise<{
    lead: LeadDoc;
    notify: string[];
}> {
    const r = record(raw);
    onlyKeys(r, ["patient", "doctor", "department", "campaign", "batch", "duplicateOverrideReason"]);
    const d = (r.department || "GENERATION") as WorkDepartment;
    assert(DEPARTMENTS.includes(d), 400, "INVALID_DEPARTMENT", "Invalid department.");
    assertCreate(u, d);
    const p = parsePatient(r.patient || {}), doctor = parseDoctor(r.doctor || {});
    if (d !== "GENERATION") {
        validateLead(p, doctor, false);
        assert(p.firstName && p.lastName && p.phone, 400, "VALIDATION_FAILED", "Datasets require first name, last name, and phone.");
    }
    const id = randomUUID(), c = await collections(), now = new Date(), campaign = text(r.campaign, "Campaign", 100), batch = text(r.batch, "Batch", 100);
    const override = text(r.duplicateOverrideReason, "Duplicate override reason", 2000), dup = await checkDuplicates(u, p, id, override, s);
    const counter = await c.counters.findOneAndUpdate({ _id: `lead:${now.getUTCFullYear()}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after", session: s });
    assert(counter, 500, "SEQUENCE_FAILED", "Unable to allocate lead ID.");
    const code = `WAF-${now.getUTCFullYear()}-${String(counter.seq).padStart(6, "0")}`;
    const lead: LeadDoc = { _id: id, code, department: d, status: d === "GENERATION" ? "DRAFT" : d === "PV" ? "PV_ACTIVE" : "CHASING_ACTIVE", createdBy: u.id, assignedTo: d === "GENERATION" ? u.id : null, origin: d,
        version: 1, submissionVersion: 0, campaign, batch, createdAt: now.toISOString(), updatedAt: now.toISOString(), patientSealed: seal(p, `patient:${id}`), doctor,
        duplicateKeys: dup.keys, searchTokens: searchTokens(p, doctor, code, campaign, batch), ...(d === "PV" ? { verificationStatus: "NOT_CONTACTED" as const } : {}) };
    await c.leads.insertOne(lead, { session: s });
    const eventId = await audit(u, "CREATED", { department: d, status: lead.status, duplicateOverrideReason: dup.overridden ? override : undefined }, lead, s, u.id);
    const notify = d === "GENERATION" ? [] : await recipientIds(lead, s);
    if (notify.length && !quiet)
        await insertNotifications(notify, eventId, "New lead received", `${code} is ready in your department.`, lead, 1, s);
    return { lead, notify };
}
export async function createLead(u: Actor, raw: unknown, key: string | null) {
    return idempotent(u, key, raw, async (s) => { const { lead, notify } = await createLeadCore(u, raw, s); return { data: leadView(lead), notify }; });
}
export async function getLead(u: Actor, id: string, session?: ClientSession): Promise<LeadDoc> {
    const l = await (await collections()).leads.findOne({ _id: id }, { session });
    assertRead(u, l);
    return l as LeadDoc;
}
export async function editLead(u: Actor, id: string, raw: unknown, key: string | null) {
    const r = record(raw);
    onlyKeys(r, ["version", "patient", "doctor", "campaign", "batch", "duplicateOverrideReason"]);
    assert(Number.isInteger(r.version), 400, "INVALID_VERSION", "Record version is required.");
    const patch = { ...(r.patient !== undefined ? { patient: partialPatient(r.patient) } : {}), ...(r.doctor !== undefined ? { doctor: partialDoctor(r.doctor) } : {}) };
    return idempotent(u, key, { id, raw }, async (s) => {
        const c = await collections(), lead = await getLead(u, id, s);
        assertEdit(u, lead, patch);
        assert(lead.version === r.version, 409, "VERSION_CONFLICT", "This record changed. Reload before saving.");
        if (r.campaign !== undefined || r.batch !== undefined)
            assert(isManagement(u), 403, "FORBIDDEN", "Management controls campaign and batch fields.");
        const previous = patientOf(lead), p = { ...previous, ...patch.patient }, doctor = { ...lead.doctor, ...patch.doctor };
        // Incomplete drafts may be saved. Mandatory and format validation runs before submission.
        if (lead.status !== "DRAFT")
            validateLead(p, doctor, lead.origin === "GENERATION");
        const override = text(r.duplicateOverrideReason, "Duplicate override reason", 2000), dup = await checkDuplicates(u, p, id, override, s);
        const next: LeadDoc = { ...lead, patientSealed: seal(p, `patient:${id}`), doctor, campaign: r.campaign !== undefined ? text(r.campaign, "Campaign", 100) : lead.campaign, batch: r.batch !== undefined ? text(r.batch, "Batch", 100) : lead.batch, duplicateKeys: dup.keys, version: lead.version + 1, updatedAt: new Date().toISOString() };
        next.searchTokens = searchTokens(p, doctor, next.code, next.campaign, next.batch);
        const result = await c.leads.replaceOne({ _id: id, version: lead.version }, next, { session: s });
        assert(result.modifiedCount, 409, "VERSION_CONFLICT", "This record changed. Reload before saving.");
        await audit(u, "EDITED", { before: { patient: patch.patient ? previous : undefined, doctor: patch.doctor ? lead.doctor : undefined }, after: { patient: patch.patient ? p : undefined, doctor: patch.doctor ? doctor : undefined }, fields: Object.keys(patch), duplicateOverrideReason: dup.overridden ? override : undefined }, next, s);
        return { data: leadView(next), notify: await recipientIds(next, s) };
    });
}
export async function workflowCore(u: Actor, id: string, input: WorkflowInput, s: ClientSession, quiet = false): Promise<{
    lead: LeadDoc;
    notify: string[];
}> {
    const c = await collections(), lead = await getLead(u, id, s);
    if (["SUBMIT", "RESUBMIT", "APPROVE_GENERATION", "QA_GOOD"].includes(input.action))
        validateLead(patientOf(lead), lead.doctor, true);
    if (input.action === "ASSIGN") {
        const target = await c.users.findOne({ _id: input.assigneeId }, { session: s });
        assert(target && canAssignTo(u, toActor(target), lead.department), 400, "INVALID_ASSIGNEE", "Select an active agent under this head in the same department.");
    }
    const next: LeadDoc = { ...lead, ...transition(u, lead, input) };
    const result = await c.leads.replaceOne({ _id: id, version: input.version }, next, { session: s });
    assert(result.modifiedCount, 409, "VERSION_CONFLICT", "This record changed. Refresh and retry.");
    const eventId = await audit(u, input.action, { before: { department: lead.department, status: lead.status, assignedTo: lead.assignedTo }, after: { department: next.department, status: next.status, assignedTo: next.assignedTo }, reason: input.reason, comment: input.comment, followUpAt: input.followUpAt }, next, s, input.action === "ASSIGN" ? next.assignedTo : lead.assignedTo, lead.department);
    const notify = await recipientIds(next, s);
    if (!quiet)
        await insertNotifications(notify, eventId, input.action === "RESUBMIT" ? "Resubmitted lead received" : input.action === "QA_BAD" ? "Rework required" : "Lead queue updated", `${next.code}: ${input.action.replaceAll("_", " ").toLowerCase()}.`, next, 1, s);
    return { lead: next, notify };
}
export async function applyWorkflow(u: Actor, id: string, raw: unknown, key: string | null) {
    const input = parseWorkflow(raw);
    return idempotent(u, key, { id, input }, async (s) => { const { lead, notify } = await workflowCore(u, id, input, s); return { data: leadView(lead), notify }; });
}
export async function bulkWorkflow(u: Actor, raw: unknown, key: string | null) {
    const r = record(raw);
    onlyKeys(r, ["items", "action", "assigneeId", "reason", "comment", "followUpAt", "destination"]);
    assert(Array.isArray(r.items) && r.items.length > 0 && r.items.length <= 50, 400, "INVALID_BATCH", "Select between 1 and 50 records.");
    const items = r.items.map(v => { const item = record(v); return { id: text(item.id, "Record ID", 100, true), version: Number(item.version) }; });
    assert(new Set(items.map(i => i.id)).size === items.length, 400, "DUPLICATE_ITEMS", "A record was selected more than once.");
    return idempotent(u, key, raw, async (s) => {
        const groups = new Map<string, number>(), leads: LeadView[] = [];
        for (const item of items) {
            const input = parseWorkflow({ action: r.action, version: item.version, assigneeId: r.assigneeId, reason: r.reason, comment: r.comment, followUpAt: r.followUpAt, destination: r.destination });
            const result = await workflowCore(u, item.id, input, s, true);
            leads.push(leadView(result.lead));
            for (const uid of result.notify)
                groups.set(uid, (groups.get(uid) || 0) + 1);
        }
        const eventId = randomUUID();
        for (const [uid, count] of groups)
            await insertNotifications([uid], eventId, `${count} leads updated`, "A grouped batch has reached your queue. Open your department to review it.", undefined, count, s);
        return { data: { items: leads, count: leads.length }, notify: [...groups.keys()] };
    });
}
export async function addActivity(u: Actor, id: string, raw: unknown, key: string | null) {
    const parsed = parseActivity(raw);
    return idempotent(u, key, { id, parsed }, async (s) => {
        const c = await collections(), lead = await getLead(u, id, s);
        assert(canEditDoctor(u, lead), 403, "FORBIDDEN", "This record is not open for activity.");
        if (parsed.kind === "CALL" || parsed.kind === "FAX")
            assert(isManagement(u) || ["CHASING", "PV"].includes(lead.department), 403, "FORBIDDEN", "Calls and fax updates belong to Chasing and Patient Verification.");
        if (parsed.kind === "VERIFICATION")
            assert(lead.department === "PV", 403, "FORBIDDEN", "Verification belongs to Patient Verification only.");
        const activityId = randomUUID(), at = new Date().toISOString(), data = { ...parsed.data, occurredAt: parsed.data.occurredAt || at };
        await c.activities.insertOne({ _id: activityId, leadId: id, kind: parsed.kind, actorId: u.id, actorName: u.name, department: lead.department, at, dataSealed: seal(data, `activity:${activityId}`) }, { session: s });
        const set: Record<string, unknown> = { updatedAt: at };
        if (parsed.kind === "FAX")
            set.lastFaxDate = parsed.data.faxDate;
        if (parsed.kind === "VERIFICATION")
            set.verificationStatus = parsed.data.status;
        if (parsed.data.followUpAt)
            set.followUpAt = new Date(parsed.data.followUpAt).toISOString();
        await c.leads.updateOne({ _id: id, version: lead.version }, { $set: set, $inc: { version: 1 } }, { session: s });
        await audit(u, parsed.kind === "VERIFICATION" ? `VERIFICATION_${parsed.data.status}` : parsed.kind, { activityId }, lead, s, u.id);
        return { data: { ok: true }, notify: await recipientIds(lead, s) };
    });
}
export async function revealIdentifiers(u: Actor, id: string) {
    const lead = await getLead(u, id);
    assert(canReveal(u, lead), 403, "FORBIDDEN", "This role cannot reveal patient identifiers.");
    await audit(u, "IDENTIFIERS_REVEALED", { fields: ["identifier", "memberId"] }, lead);
    const p = patientOf(lead);
    return { identifier: p.identifier, memberId: p.memberId };
}
export async function buildLeadFilter(u: Actor, url: URL): Promise<Filter<LeadDoc>> {
    const parts: Record<string, unknown>[] = [leadScope(u)], department = url.searchParams.get("department"), status = url.searchParams.get("status"), q = url.searchParams.get("q")?.trim();
    if (department) {
        assert(DEPARTMENTS.includes(department as never), 400, "INVALID_FILTER", "Invalid department.");
        parts.push({ department });
    }
    if (status) {
        assert(STATUSES.includes(status as never), 400, "INVALID_FILTER", "Invalid status.");
        parts.push({ status });
    }
    else
        parts.push({ status: { $ne: "ARCHIVED" } });
    for (const key of ["assignedTo", "campaign", "batch"] as const) {
        const value = url.searchParams.get(key);
        if (value)
            parts.push({ [key]: text(value, key, 100) });
    }
    const head = url.searchParams.get("headId");
    if (head) {
        const users = await (await collections()).users.find({ "memberships.headId": head }, { projection: { _id: 1 } }).limit(2000).toArray();
        parts.push({ assignedTo: { $in: users.map(x => x._id) } });
    }
    if (q) {
        assert(q.length <= 100, 400, "INVALID_SEARCH", "Search is too long.");
        const token = queryToken(q);
        assert(token, 400, "INVALID_SEARCH", "Enter at least two letters or digits.");
        parts.push({ searchTokens: token });
    }
    const dates: Record<string, string> = {};
    for (const [query, operator] of [["from", "$gte"], ["to", "$lte"]]) {
        const v = url.searchParams.get(query);
        if (v) {
            assert(Number.isFinite(Date.parse(v)), 400, "INVALID_DATE", "Invalid filter date.");
            dates[operator] = new Date(v).toISOString();
        }
    }
    if (Object.keys(dates).length)
        parts.push({ createdAt: dates });
    return { $and: parts } as Filter<LeadDoc>;
}
export async function listLeads(u: Actor, url: URL, max = 100) {
    const c = await collections(), filter = await buildLeadFilter(u, url), limit = pageLimit(url, max), cursor = decodeCursor(url.searchParams.get("cursor"));
    const sortBy = url.searchParams.get("sort") || "createdAt";
    assert(["createdAt", "updatedAt", "code"].includes(sortBy), 400, "INVALID_SORT", "Invalid sort field.");
    const dir = url.searchParams.get("order") === "asc" ? 1 : -1;
    if (cursor) {
        assert(cursor.sort === sortBy && cursor.order === String(dir) && cursor.id && cursor.value, 400, "INVALID_CURSOR", "Cursor does not match this sort.");
        const op = dir === 1 ? "$gt" : "$lt";
        (filter.$and as Record<string, unknown>[]).push({ $or: [{ [sortBy]: { [op]: cursor.value } }, { [sortBy]: cursor.value, _id: { [op]: cursor.id } }] });
    }
    const rows = await c.leads.find(filter).sort({ [sortBy]: dir, _id: dir }).limit(limit + 1).maxTimeMS(10000).toArray();
    const hasMore = rows.length > limit, items = rows.slice(0, limit), last = items.at(-1);
    return { items: items.map(leadView), nextCursor: hasMore && last ? encodeCursor({ sort: sortBy, order: String(dir), value: last[sortBy as keyof LeadDoc], id: last._id }) : null };
}
function redactHistory(value: unknown): unknown {
    if (Array.isArray(value))
        return value.map(redactHistory);
    if (value && typeof value === "object")
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, ["identifier", "memberId"].includes(k) && typeof v === "string" ? mask(v) : redactHistory(v)]));
    return value;
}
function historyFilter(id: string, before: string | null): Record<string, unknown> {
    const filter: Record<string, unknown> = { leadId: id }, cursor = decodeCursor(before);
    if (cursor) {
        assert(typeof cursor.at === "string" && typeof cursor.id === "string", 400, "INVALID_CURSOR", "Invalid history cursor.");
        filter.$or = [{ at: { $lt: cursor.at } }, { at: cursor.at, _id: { $lt: cursor.id } }];
    }
    return filter;
}
export async function leadHistory(u: Actor, id: string, url: URL) {
    const lead = await getLead(u, id), c = await collections();
    const rows = await c.events.find(historyFilter(id, url.searchParams.get("before"))).sort({ at: -1, _id: -1 }).limit(101).toArray(), items = rows.slice(0, 100), last = items.at(-1);
    return { items: items.map(e => redactHistory(eventView(e, true))), nextBefore: rows.length > 100 && last ? encodeCursor({ at: last.at, id: last._id }) : null };
}
export async function leadActivities(u: Actor, id: string, url: URL) {
    await getLead(u, id);
    const c = await collections();
    const rows = await c.activities.find(historyFilter(id, url.searchParams.get("before"))).sort({ at: -1, _id: -1 }).limit(101).toArray(), items = rows.slice(0, 100), last = items.at(-1);
    return { items: items.map(({ dataSealed, ...rest }) => ({ ...rest, data: unseal(dataSealed, `activity:${rest._id}`) })), nextBefore: rows.length > 100 && last ? encodeCursor({ at: last.at, id: last._id }) : null };
}
export async function dashboard(u: Actor) {
    const c = await collections(), scope = leadScope(u);
    const counts = await c.leads.aggregate<{
        department: string;
        status: string;
        count: number;
    }>([{ $match: scope }, { $group: { _id: { department: "$department", status: "$status" }, count: { $sum: 1 } } }, { $project: { _id: 0, department: "$_id.department", status: "$_id.status", count: 1 } }], { maxTimeMS: 10000 }).toArray();
    const due = await c.leads.countDocuments({ $and: [scope, { followUpAt: { $lte: new Date().toISOString(), $ne: null }, status: { $nin: ["ARCHIVED", "FINALIZED", "DENIED"] } }] } as Filter<LeadDoc>, { maxTimeMS: 10000 });
    const activeStatuses = ["CHASING_ACTIVE", "PV_ACTIVE", "QA_REVIEW", "GENERATION_REVIEW", "REWORK_REQUIRED", "INCOMPLETE", "DRAFT"];
    const recent = await c.leads.find(scope as Filter<LeadDoc>).sort({ updatedAt: -1, _id: -1 }).limit(8).toArray();
    return { counts, metrics: { active: counts.filter(x => activeStatuses.includes(x.status)).reduce((s, x) => s + x.count, 0), review: counts.filter(x => x.status === "MANAGEMENT_REVIEW").reduce((s, x) => s + x.count, 0), rework: counts.filter(x => x.status === "REWORK_REQUIRED").reduce((s, x) => s + x.count, 0), due }, recent: recent.map(leadView) };
}
