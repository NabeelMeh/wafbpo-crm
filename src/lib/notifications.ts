import { randomUUID, createHmac, randomBytes } from "node:crypto";
import type { ClientSession } from "mongodb";
import { collections, actor, type UserDoc, type NotificationDoc } from "./db.ts";
import type { LeadCore, Actor } from "./domain/types.ts";
import { isManagement, isHead } from "./domain/policy.ts";
import { assert } from "./domain/errors.ts";
export async function recipientIds(lead: LeadCore, session?: ClientSession): Promise<string[]> {
    const c = await collections();
    const users = await c.users.find({ accountStatus: "ACTIVE", ...(lead.department === "MANAGEMENT" ? { role: { $in: ["SUPER_ADMIN", "MANAGEMENT"] } } : { $or: [{ _id: lead.assignedTo ?? "" }, { memberships: { $elemMatch: { department: lead.department, kind: "HEAD" } } }] }) }, { session }).toArray();
    return users.filter(u => lead.department === "MANAGEMENT" ? isManagement(actor(u)) : (u._id === lead.assignedTo || isHead(actor(u), lead.department))).map(u => u._id);
}
export async function insertNotifications(ids: string[], eventId: string, title: string, body: string, lead?: LeadCore, count = 1, session?: ClientSession) {
    const c = await collections();
    const docs = [...new Set(ids)].map(userId => ({ _id: randomUUID(), userId, eventId, title, body, leadId: lead?._id, code: lead?.code, count, createdAt: new Date().toISOString() }));
    if (docs.length)
        await c.notifications.insertMany(docs, { session });
    return ids;
}
// Pub/sub only carries an invalidation hint. Patient names, phone numbers and identifiers never leave the application here.
export async function publishHint(userIds: string[]) {
    const key = process.env.ABLY_API_KEY;
    if (!key)
        return;
    await Promise.allSettled([...new Set(userIds)].map(async (id) => {
        const response = await fetch(`https://rest.ably.io/channels/${encodeURIComponent(`waf:user:${id}`)}/messages`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(key).toString("base64")}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "invalidate", data: { at: Date.now() } }), signal: AbortSignal.timeout(2500) });
        if (!response.ok)
            throw new Error("Realtime publish failed");
    }));
    // A failed hint is harmless: durable notifications are read by authenticated 10-second polling.
}
export function ablyTokenRequest(u: Actor) {
    const key = process.env.ABLY_API_KEY;
    assert(key, 503, "REALTIME_NOT_CONFIGURED", "Managed realtime is not configured. Polling remains available.");
    const separator = key.indexOf(":"), keyName = key.slice(0, separator), keySecret = key.slice(separator + 1);
    assert(separator > 0 && keySecret, 503, "REALTIME_NOT_CONFIGURED", "Invalid realtime key.");
    const ttl = 5 * 60000, capability = JSON.stringify({ [`waf:user:${u.id}`]: ["subscribe"] }), timestamp = Date.now(), nonce = randomBytes(16).toString("hex"), clientId = u.id;
    const content = `${keyName}\n${ttl}\n${capability}\n${clientId}\n${timestamp}\n${nonce}\n`;
    const mac = createHmac("sha256", keySecret).update(content).digest("base64");
    return { keyName, ttl, capability, clientId, timestamp, nonce, mac };
}
export async function listNotifications(u: Actor) {
    const c = await collections(), items = await c.notifications.find({ userId: u.id }).sort({ createdAt: -1, _id: -1 }).limit(100).toArray();
    const unread = await c.notifications.countDocuments({ userId: u.id, acknowledgedAt: { $exists: false } });
    return { items: items.map(({ userId, eventId, ...rest }) => rest), unread };
}
export async function claimNotification(u: Actor, id: string) {
    const c = await collections();
    const n = await c.notifications.findOneAndUpdate({ _id: id, userId: u.id, deliveredAt: { $exists: false } }, { $set: { deliveredAt: new Date().toISOString() } }, { returnDocument: "after" });
    // Atomic server-side claim prevents duplicate sounds across browser tabs, reloads and reconnects.
    return { claimed: !!n };
}
export async function acknowledgeNotification(u: Actor, id: string) {
    const c = await collections(), result = await c.notifications.updateOne({ _id: id, userId: u.id }, { $set: { acknowledgedAt: new Date().toISOString(), deliveredAt: new Date().toISOString() } });
    assert(result.matchedCount, 404, "NOT_FOUND", "Notification not found.");
    return { ok: true };
}
export async function notifyTeamChange(changed: UserDoc, by: Actor, session?: ClientSession) {
    const c = await collections(), users = await c.users.find({ accountStatus: "ACTIVE", $or: [{ role: { $in: ["SUPER_ADMIN", "MANAGEMENT"] } }, { "memberships.kind": "HEAD" }] }, { session }).toArray();
    return insertNotifications(users.map(u => u._id), randomUUID(), "Team account updated", `${changed.name}: ${changed.accountStatus.toLowerCase()}. Updated by ${by.name}.`, undefined, 1, session);
}
