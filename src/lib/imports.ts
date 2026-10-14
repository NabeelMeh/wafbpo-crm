import { randomUUID } from "node:crypto";
import type { Actor } from "./domain/types.ts";
import { collections } from "./db.ts";
import { AppError, assert } from "./domain/errors.ts";
import { record, text, onlyKeys } from "./domain/validation.ts";
import { isManagement } from "./domain/policy.ts";
import { idempotent, createLeadCore } from "./leads.ts";
import { audit } from "./audit.ts";
import { blind } from "./crypto.ts";
import { recipientIds, insertNotifications } from "./notifications.ts";
export async function createImport(u: Actor, raw: unknown, key: string | null) {
    assert(isManagement(u), 403, "FORBIDDEN", "Only Management can import datasets.");
    const r = record(raw);
    onlyKeys(r, ["name", "total", "department"]);
    assert(r.department === "CHASING" || r.department === "PV", 400, "INVALID_DEPARTMENT", "Raw dataset intake is limited to Chasing and Patient Verification.");
    assert(Number.isInteger(r.total) && Number(r.total) > 0 && Number(r.total) <= 5000, 400, "IMPORT_LIMIT", "Interactive imports support 1-5,000 rows per file.");
    return idempotent(u, key, raw, async (s) => {
        const c = await collections(), job = { _id: randomUUID(), name: text(r.name, "Import name", 100, true), department: r.department as "CHASING" | "PV", total: Number(r.total), createdBy: u.id, createdAt: new Date().toISOString(), status: "OPEN" as const };
        await c.imports.insertOne(job, { session: s });
        await audit(u, "IMPORT_STARTED", { importId: job._id, name: job.name, total: job.total, department: job.department }, undefined, s);
        return { data: job, notify: [] };
    });
}
export async function importChunk(u: Actor, id: string, raw: unknown, key: string | null) {
    assert(isManagement(u), 403, "FORBIDDEN", "Only Management can import datasets.");
    const r = record(raw);
    onlyKeys(r, ["rows"]);
    assert(Array.isArray(r.rows) && r.rows.length > 0 && r.rows.length <= 25, 400, "INVALID_BATCH", "Send 1-25 mapped rows per chunk.");
    const rows = r.rows;
    return idempotent(u, key, { id, raw }, async (s) => {
        const c = await collections(), job = await c.imports.findOne({ _id: id }, { session: s });
        assert(job && job.status === "OPEN", 409, "IMPORT_CLOSED", "Import not found or already complete.");
        const results = [];
        for (const value of rows) {
            const row = record(value);
            onlyKeys(row, ["row", "data"]);
            const number = Number(row.row);
            assert(Number.isInteger(number) && number >= 1 && number <= job.total, 400, "INVALID_ROW", "Invalid source row number.");
            const sourceHash = blind(`import:${JSON.stringify(row.data)}`), rowId = `${id}:${number}`, prior = await c.importRows.findOne({ _id: rowId }, { session: s });
            if (prior) {
                assert(prior.sourceHash === sourceHash, 409, "SOURCE_CHANGED", "The uploaded file changed. Resume with the original source file.");
                results.push(prior);
                continue;
            }
            let result: {
                _id: string;
                importId: string;
                row: number;
                sourceHash: string;
                status: "IMPORTED" | "DUPLICATE" | "FAILED" | "SKIPPED";
                leadId?: string;
                error?: string;
            } = { _id: rowId, importId: id, row: number, sourceHash, status: "FAILED" };
            try {
                const data = record(row.data);
                const created = await createLeadCore(u, { ...data, department: job.department, batch: job.name }, s, true);
                result = { ...result, status: "IMPORTED", leadId: created.lead._id };
            }
            catch (e) {
                if (!(e instanceof AppError))
                    throw e;
                result = { ...result, status: e.code === "POSSIBLE_DUPLICATE" ? "DUPLICATE" : "FAILED", error: e.message };
            }
            await c.importRows.insertOne(result, { session: s });
            results.push(result);
        }
        return { data: { items: results.map(({ sourceHash, ...rest }) => rest) }, notify: [] };
    });
}
export async function finishImport(u: Actor, id: string, key: string | null) {
    assert(isManagement(u), 403, "FORBIDDEN", "Management access required.");
    return idempotent(u, key, { id, action: "finish-import" }, async (s) => {
        const c = await collections(), job = await c.imports.findOne({ _id: id }, { session: s });
        assert(job, 404, "NOT_FOUND", "Import not found.");
        const count = await c.importRows.countDocuments({ importId: id }, { session: s });
        assert(count === job.total, 409, "IMPORT_INCOMPLETE", `Only ${count} of ${job.total} source rows have been processed. Resume the original file.`);
        const imported = await c.importRows.countDocuments({ importId: id, status: "IMPORTED" }, { session: s });
        let notify: string[] = [];
        if (job.status !== "COMPLETE") {
            await c.imports.updateOne({ _id: id }, { $set: { status: "COMPLETE" } }, { session: s });
            const first = await c.importRows.findOne({ importId: id, status: "IMPORTED" }, { session: s });
            if (first?.leadId) {
                const lead = await c.leads.findOne({ _id: first.leadId }, { session: s });
                if (lead) {
                    notify = await recipientIds(lead, s);
                    await insertNotifications(notify, `import:${id}`, `${imported} new leads received`, `Dataset ${job.name} is ready for assignment.`, undefined, imported, s);
                }
            }
            await audit(u, "IMPORT_COMPLETED", { importId: id, total: job.total, imported }, undefined, s);
        }
        return { data: { ok: true, imported }, notify };
    });
}
export async function listImports(u: Actor) {
    assert(isManagement(u), 403, "FORBIDDEN", "Management access required.");
    const c = await collections(), jobs = await c.imports.find({}).sort({ createdAt: -1 }).limit(30).toArray();
    return { items: await Promise.all(jobs.map(async (job) => ({ ...job, counts: await c.importRows.aggregate<{
                _id: string;
                count: number;
            }>([{ $match: { importId: job._id } }, { $group: { _id: "$status", count: { $sum: 1 } } }]).toArray() }))) };
}
export async function importErrors(u: Actor, id: string) {
    assert(isManagement(u), 403, "FORBIDDEN", "Management access required.");
    const rows = await (await collections()).importRows.find({ importId: id, status: { $ne: "IMPORTED" } }).sort({ row: 1 }).limit(5000).toArray();
    return { items: rows.map(({ sourceHash, ...rest }) => rest) };
}
