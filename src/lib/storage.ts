import { randomUUID } from "node:crypto";
import { S3Client, GetBucketVersioningCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { collections, transaction, type FileDoc } from "./db.ts";
import type { Actor } from "./domain/types.ts";
import { assert } from "./domain/errors.ts";
import { record, text, onlyKeys } from "./domain/validation.ts";
import { canEditDoctor } from "./domain/policy.ts";
import { getLead, idempotent } from "./leads.ts";
import { audit } from "./audit.ts";
import { sameSecret } from "./crypto.ts";
let instance: S3Client | undefined;
function store() {
    assert(process.env.S3_BUCKET, 503, "STORAGE_NOT_CONFIGURED", "Configure private S3 storage before uploading files.");
    if (!instance)
        instance = new S3Client({ region: process.env.AWS_REGION || "us-east-1", ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}) });
    return { s3: instance, bucket: process.env.S3_BUCKET };
}
export async function beginUpload(u: Actor, leadId: string, raw: unknown, key: string | null) {
    const r = record(raw);
    onlyKeys(r, ["name", "type", "size", "kind", "description"]);
    const name = text(r.name, "File name", 200, true).replace(/[^\w.() -]/g, "_"), type = text(r.type, "Content type", 100, true), size = Number(r.size), kind = r.kind;
    assert(kind === "PDF" || kind === "RECORDING", 400, "INVALID_FILE", "Choose a PDF or recording.");
    const valid = kind === "PDF" ? type === "application/pdf" : ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/ogg", "audio/webm"].includes(type);
    assert(valid && Number.isInteger(size) && size > 0 && size <= (kind === "PDF" ? 25 : 100) * 1024 * 1024, 400, "INVALID_FILE", "Unsupported file type or size (PDF 25 MB; audio 100 MB).");
    assert(process.env.FILE_SCAN_SECRET && process.env.FILE_SCAN_SECRET.length >= 32, 503, "SCANNER_NOT_CONFIGURED", "Configure the quarantine scanner before enabling uploads.");
    const { s3, bucket } = store(), versioning = await s3.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    assert(versioning.Status === "Enabled", 503, "VERSIONING_REQUIRED", "Private file storage must have versioning enabled.");
    const result = await idempotent(u, key, { leadId, raw }, async (s) => {
        const lead = await getLead(u, leadId, s);
        assert(canEditDoctor(u, lead), 403, "FORBIDDEN", "Files cannot be added in this state.");
        const file: FileDoc = { _id: randomUUID(), leadId, key: `leads/${leadId}/${randomUUID()}`, name, type, size, kind, description: text(r.description, "Description", 1000), status: "PENDING", uploadedBy: u.id, uploadedByName: u.name, department: lead.department, createdAt: new Date().toISOString() };
        await (await collections()).files.insertOne(file, { session: s });
        return { data: { id: file._id, key: file.key }, notify: [] };
    });
    assert(canEditDoctor(u, await getLead(u, leadId)), 403, "FORBIDDEN", "This record is no longer editable.");
    const post = await createPresignedPost(s3, { Bucket: bucket, Key: result.key, Expires: 300, Fields: { "Content-Type": type }, Conditions: [["content-length-range", size, size], ["eq", "$Content-Type", type]] });
    return { fileId: result.id, url: post.url, fields: post.fields };
}
export async function completeUpload(u: Actor, id: string) {
    const c = await collections(), file = await c.files.findOne({ _id: id });
    assert(file, 404, "NOT_FOUND", "File not found.");
    const lead = await getLead(u, file.leadId);
    assert(file.uploadedBy === u.id, 403, "FORBIDDEN", "Only the uploader may finalize this upload.");
    assert(canEditDoctor(u, lead), 403, "FORBIDDEN", "This lead is no longer editable.");
    if (file.status !== "PENDING")
        return { ok: true, status: file.status };
    const { s3, bucket } = store(), head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: file.key }));
    assert(head.ContentLength === file.size && head.ContentType === file.type && head.VersionId && head.VersionId !== "null", 400, "INVALID_UPLOAD", "Uploaded object failed size, type or immutable-version validation.");
    await transaction(async (s) => {
        const changed = await c.files.updateOne({ _id: id, status: "PENDING" }, { $set: { versionId: head.VersionId, status: "QUARANTINED" } }, { session: s });
        if (changed.modifiedCount)
            await audit(u, "FILE_UPLOADED", { fileId: id, name: file.name, kind: file.kind, status: "QUARANTINED" }, lead, s, u.id);
    });
    return { ok: true, status: "QUARANTINED" };
}
export async function listFiles(u: Actor, leadId: string, url: URL) {
    await getLead(u, leadId);
    const c = await collections(), filter: Record<string, unknown> = { leadId };
    if (url.searchParams.get("after"))
        filter._id = { $gt: url.searchParams.get("after") };
    const rows = await c.files.find(filter).sort({ _id: 1 }).limit(101).toArray(), items = rows.slice(0, 100);
    return { items: items.map(({ key, versionId, ...rest }) => rest), nextAfter: rows.length > 100 ? items.at(-1)!._id : null };
}
export async function downloadFile(u: Actor, id: string, inline = false) {
    const c = await collections(), file = await c.files.findOne({ _id: id });
    assert(file, 404, "NOT_FOUND", "File not found.");
    const lead = await getLead(u, file.leadId);
    assert(file.status === "CLEAN" && file.versionId, 409, "FILE_NOT_READY", "This file is still quarantined, incomplete, or has been rejected.");
    const { s3, bucket } = store();
    await audit(u, inline ? "FILE_PREVIEWED" : "FILE_DOWNLOADED", { fileId: id, versionId: file.versionId }, lead);
    return { url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: file.key, VersionId: file.versionId, ResponseContentType: file.type, ResponseContentDisposition: `${inline ? "inline" : "attachment"}; filename="${file.name.replace(/"/g, "")}"` }), { expiresIn: 300 }) };
}
export function scannerAuth(req: Request) {
    const secret = process.env.FILE_SCAN_SECRET, token = req.headers.get("authorization")?.replace(/^Bearer /, "");
    assert(secret && secret.length >= 32 && token && sameSecret(secret, token), 401, "UNAUTHENTICATED", "Invalid scanner authentication.");
}
export async function scanQueue() {
    const c = await collections(), files = await c.files.find({ status: "QUARANTINED" }).sort({ createdAt: 1 }).limit(5).toArray(), { s3, bucket } = store();
    return { items: await Promise.all(files.map(async (f) => ({ fileId: f._id, versionId: f.versionId, size: f.size, type: f.type, url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: f.key, VersionId: f.versionId }), { expiresIn: 300 }) }))) };
}
export async function scanResult(raw: unknown) {
    const r = record(raw);
    onlyKeys(r, ["fileId", "versionId", "clean"]);
    assert(typeof r.clean === "boolean", 400, "INVALID_INPUT", "A scanner result is required.");
    const c = await collections(), file = await c.files.findOne({ _id: text(r.fileId, "File ID", 100, true), versionId: text(r.versionId, "Version ID", 300, true) });
    assert(file, 404, "NOT_FOUND", "Immutable file version not found.");
    const system: Actor = { id: "system:scanner", name: "File scanner", username: "system:scanner", employeeId: "SYSTEM", role: "STAFF", memberships: [], accountStatus: "ACTIVE", mustChangePassword: false, mfaEnabled: true };
    await transaction(async (s) => {
        const changed = await c.files.updateOne({ _id: file._id, versionId: file.versionId, status: "QUARANTINED" }, { $set: { status: r.clean ? "CLEAN" : "REJECTED", scanAt: new Date().toISOString() } }, { session: s });
        if (changed.modifiedCount) {
            const lead = await c.leads.findOne({ _id: file.leadId }, { session: s });
            if (lead)
                await audit(system, "FILE_SCANNED", { fileId: file._id, clean: r.clean, versionId: file.versionId }, lead, s);
        }
    });
    return { ok: true };
}
