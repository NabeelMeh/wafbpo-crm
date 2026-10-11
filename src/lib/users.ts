import { randomUUID } from "node:crypto";
import { collections, actor, type UserDoc } from "./db.ts";
import type { Actor, Membership, GlobalRole, AccountStatus } from "./domain/types.ts";
import { ACCOUNT_STATUSES, DEPARTMENTS } from "./domain/types.ts";
import { assert } from "./domain/errors.ts";
import { record, text, onlyKeys, passwordPolicy } from "./domain/validation.ts";
import { isManagement, isHead, canSeeTeam, canAssignTo } from "./domain/policy.ts";
import { hashPassword, blind } from "./crypto.ts";
import { audit } from "./audit.ts";
import { idempotent } from "./leads.ts";
import { notifyTeamChange } from "./notifications.ts";
function parseMemberships(raw: unknown): Membership[] {
    assert(Array.isArray(raw) && raw.length <= 4, 400, "INVALID_MEMBERSHIPS", "Select up to four work departments.");
    const items = raw.map(value => {
        const r = record(value);
        onlyKeys(r, ["department", "kind", "headId"]);
        assert(DEPARTMENTS.includes(r.department as never) && r.department !== "MANAGEMENT", 400, "INVALID_MEMBERSHIP", "Invalid department.");
        assert(["HEAD", "AGENT"].includes(r.kind as string), 400, "INVALID_MEMBERSHIP", "Select Head or Agent.");
        return { department: r.department, kind: r.kind, ...(r.headId ? { headId: text(r.headId, "Head ID", 100) } : {}) } as Membership;
    });
    assert(new Set(items.map(x => x.department)).size === items.length, 400, "INVALID_MEMBERSHIPS", "Each department can be selected only once.");
    return items;
}
async function validateHeads(memberships: Membership[], selfId: string) {
    const c = await collections();
    for (const m of memberships)
        if (m.kind === "AGENT") {
            assert(m.headId && m.headId !== selfId, 400, "HEAD_REQUIRED", "Every agent membership needs a different department head.");
            const head = await c.users.findOne({ _id: m.headId, accountStatus: "ACTIVE", memberships: { $elemMatch: { department: m.department, kind: "HEAD" } } });
            assert(head, 400, "INVALID_HEAD", "The selected head must be active in that department.");
        }
}
export async function saveUser(u: Actor, id: string | null, raw: unknown, key: string | null) {
    assert(isManagement(u), 403, "FORBIDDEN", "Management access is required.");
    const r = record(raw);
    onlyKeys(r, ["name", "username", "employeeId", "role", "memberships", "accountStatus", "password"]);
    const role = text(r.role, "Role", 30, true) as GlobalRole;
    assert(["SUPER_ADMIN", "MANAGEMENT", "STAFF"].includes(role), 400, "INVALID_ROLE", "Invalid role.");
    assert(u.role === "SUPER_ADMIN" || role !== "SUPER_ADMIN", 403, "FORBIDDEN", "Only a Super Admin may create or grant Super Admin access.");
    const memberships = parseMemberships(r.memberships || []);
    assert(role !== "STAFF" || memberships.length, 400, "DEPARTMENT_REQUIRED", "Staff need a department membership.");
    const status = text(r.accountStatus || "ACTIVE", "Account status", 20) as AccountStatus;
    assert(ACCOUNT_STATUSES.includes(status), 400, "INVALID_STATUS", "Invalid account status.");
    const name = text(r.name, "Name", 100, true), username = text(r.username, "Username", 60, true).toLowerCase(), employeeId = text(r.employeeId, "Employee ID", 50, true);
    assert(/^[a-z0-9._-]{3,60}$/.test(username), 400, "INVALID_USERNAME", "Username must be 3-60 letters, digits, dots, underscores or hyphens.");
    let passwordHash: string | undefined;
    if (r.password !== undefined && r.password !== "") {
        assert(typeof r.password === "string", 400, "INVALID_PASSWORD", "Password must be text.");
        passwordPolicy(r.password);
        passwordHash = await hashPassword(r.password);
    }
    assert(id || passwordHash, 400, "PASSWORD_REQUIRED", "A temporary password is required.");
    const targetId = id || randomUUID();
    await validateHeads(memberships, targetId);
    // Use a stable keyed fingerprint, not a randomly salted password hash, for safe retries.
    return idempotent(u, key, { targetId: id, role, memberships, status, name, username, employeeId, passwordFingerprint: passwordHash ? blind(`password-request:${r.password}`) : undefined }, async (s) => {
        const c = await collections(), old = id ? await c.users.findOne({ _id: id }, { session: s }) : null;
        if (id)
            assert(old, 404, "NOT_FOUND", "User not found.");
        assert(u.role === "SUPER_ADMIN" || old?.role !== "SUPER_ADMIN", 403, "FORBIDDEN", "Only a Super Admin may edit a Super Admin account.");
        if (old?.role === "SUPER_ADMIN") {
            await c.duplicateGuards.updateOne({ _id: "administration:superadmin-lock" }, { $inc: { version: 1 } }, { upsert: true, session: s });
            if (role !== "SUPER_ADMIN" || status !== "ACTIVE")
                assert(await c.users.countDocuments({ role: "SUPER_ADMIN", accountStatus: "ACTIVE", _id: { $ne: targetId } }, { session: s }) > 0, 409, "LAST_ADMIN", "The last active Super Admin cannot be deactivated or demoted.");
        }
        assert(!(targetId === u.id && passwordHash), 400, "OWN_PASSWORD", "Change your own password in Security.");
        const conflict = await c.users.findOne({ _id: { $ne: targetId }, $or: [{ username }, { employeeId }] }, { session: s });
        assert(!conflict, 409, "USER_EXISTS", "Username or employee ID is already in use.");
        const now = new Date().toISOString();
        const next: UserDoc = { ...(old || {}), _id: targetId, name, username, employeeId, role, memberships, accountStatus: status, passwordHash: passwordHash || old!.passwordHash,
            mustChangePassword: passwordHash ? true : old?.mustChangePassword || false, mfaEnabled: old?.mfaEnabled || false, sessionVersion: (old?.sessionVersion || 0) + (old ? 1 : 0), createdAt: old?.createdAt || now, updatedAt: now };
        if (old)
            await c.users.replaceOne({ _id: targetId }, next, { session: s });
        else
            await c.users.insertOne(next, { session: s });
        await audit(u, old ? "USER_UPDATED" : "USER_CREATED", { userId: targetId, before: old ? actor(old) : null, after: actor(next), passwordReset: !!passwordHash }, undefined, s);
        const notify = await notifyTeamChange(next, u, s);
        return { data: actor(next), notify };
    });
}
export async function listUsers(u: Actor) {
    assert(isManagement(u), 403, "FORBIDDEN", "Management access is required.");
    const rows = await (await collections()).users.find({}).sort({ name: 1, _id: 1 }).limit(500).toArray();
    return { items: rows.map(actor), limit: 500 };
}
export async function assignees(u: Actor, department: string) {
    assert(DEPARTMENTS.includes(department as never) && department !== "MANAGEMENT", 400, "INVALID_DEPARTMENT", "Invalid work department.");
    assert(isManagement(u) || isHead(u, department as never), 403, "FORBIDDEN", "Only a department head or Management may assign work.");
    const rows = await (await collections()).users.find({ accountStatus: "ACTIVE", memberships: { $elemMatch: { department, kind: "AGENT" } } }).limit(500).toArray();
    return { items: rows.filter(v => canAssignTo(u, actor(v), department as never)).map(actor) };
}
export async function team(u: Actor, url: URL) {
    assert(canSeeTeam(u), 403, "FORBIDDEN", "Live team status is available to Heads and Management.");
    const c = await collections(), after = url.searchParams.get("after");
    const users = await c.users.find(after ? { _id: { $gt: after } } : {}).sort({ _id: 1 }).limit(101).toArray(), items = users.slice(0, 100), now = Date.now();
    return { items: items.map(v => ({ ...actor(v), lastLoginAt: v.lastLoginAt, lastActivityAt: v.lastActivityAt,
            presence: v.accountStatus !== "ACTIVE" ? "INACTIVE" : !v.lastSeenAt || now - Date.parse(v.lastSeenAt) > 90000 ? "OFFLINE" : v.visible === false || !v.lastActivityAt || now - Date.parse(v.lastActivityAt) > 300000 ? "AWAY" : "ONLINE" })), nextAfter: users.length > 100 ? items.at(-1)!._id : null };
}
