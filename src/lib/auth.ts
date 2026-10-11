import { randomBytes } from "node:crypto";
import { actor, collections, type UserDoc, type SessionDoc } from "./db.ts";
import { AppError, assert } from "./domain/errors.ts";
import { record, text, onlyKeys, passwordPolicy } from "./domain/validation.ts";
import { blind, digest, hashPassword, verifyPassword } from "./crypto.ts";
import { audit } from "./audit.ts";
export const cookieName = () => process.env.NODE_ENV === "production" ? "__Host-waf_session" : "waf_session";
const maxAge = 8 * 60 * 60, idleMs = 30 * 60 * 1000;
export function sessionCookie(token: string, clear = false): string {
    return `${cookieName()}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
function cookie(req: Request): string | null {
    const part = req.headers.get("cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith(`${cookieName()}=`));
    return part ? part.slice(cookieName().length + 1) : null;
}
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
    const now = Date.now(), window = Math.floor(now / (windowSeconds * 1000)), c = await collections();
    const id = blind(`rate:${key}:${window}`);
    let row;
    try {
        row = await c.rateLimits.findOneAndUpdate({ _id: id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * windowSeconds * 1000) } }, { upsert: true, returnDocument: "after" });
    }
    catch (e) {
        if ((e as {
            code?: number;
        }).code !== 11000)
            throw e;
        row = await c.rateLimits.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, { returnDocument: "after" });
    }
    assert(row && row.count <= limit, 429, "RATE_LIMITED", "Too many requests. Try again after the rate-limit window.");
}
function rawPassword(v: unknown, name = "password"): string { assert(typeof v === "string" && v.length <= 128, 400, "INVALID_INPUT", `Invalid ${name}.`); return v; }
export async function login(req: Request, raw: unknown) {
    const r = record(raw);
    onlyKeys(r, ["username", "password"]);
    const username = text(r.username, "Username", 60, true).toLowerCase(), password = rawPassword(r.password);
    const ip = process.env.VERCEL ? (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown") : "local";
    await rateLimit(`login-ip:${ip}`, 30, 900);
    await rateLimit(`login-user:${username}`, 10, 900);
    const c = await collections(), user = await c.users.findOne({ username });
    const valid = user ? await verifyPassword(password, user.passwordHash) : !!(await hashPassword(password)) && false;
    assert(valid && user && user.accountStatus === "ACTIVE", 401, "INVALID_CREDENTIALS", "Invalid username, password, or inactive account.");
    const token = randomBytes(32).toString("base64url"), now = new Date();
    await c.sessions.insertOne({ _id: digest(token), userId: user._id, mfaVerified: true, version: user.sessionVersion, expiresAt: new Date(now.getTime() + maxAge * 1000), idleExpiresAt: new Date(now.getTime() + idleMs), lastInputAt: now, createdAt: now });
    await c.users.updateOne({ _id: user._id }, { $set: { lastLoginAt: now.toISOString(), lastSeenAt: now.toISOString(), lastActivityAt: now.toISOString() } });
    await audit(actor(user), "LOGIN", {});
    return { user: actor(user), cookie: sessionCookie(token) };
}
export async function authenticate(req: Request, allowSetup = false): Promise<{
    user: UserDoc;
    session: SessionDoc;
}> {
    const token = cookie(req);
    assert(token && token.length <= 200, 401, "UNAUTHENTICATED", "Sign in to continue.");
    const c = await collections(), now = new Date();
    const session = await c.sessions.findOne({ _id: digest(token), expiresAt: { $gt: now }, idleExpiresAt: { $gt: now } });
    assert(session, 401, "SESSION_EXPIRED", "Your session expired. Sign in again.");
    const user = await c.users.findOne({ _id: session.userId });
    assert(user && user.accountStatus === "ACTIVE" && user.sessionVersion === session.version, 401, "SESSION_REVOKED", "Your access has changed. Sign in again or contact Management.");
    if (!allowSetup) {
        assert(!user.mustChangePassword, 403, "PASSWORD_CHANGE_REQUIRED", "Change your temporary password in Security before using the CRM.");
    }
    if (req.headers.get("x-user-activity") === "1") {
        await c.sessions.updateOne({ _id: session._id }, { $set: { lastInputAt: now, idleExpiresAt: new Date(now.getTime() + idleMs) } });
        await c.users.updateOne({ _id: user._id }, { $max: { lastActivityAt: now.toISOString() } });
    }
    return { user, session };
}
export async function logout(req: Request) {
    const token = cookie(req);
    if (token)
        await (await collections()).sessions.deleteOne({ _id: digest(token) });
    return sessionCookie("", true);
}
export async function heartbeat(req: Request, raw: unknown) {
    const { user, session } = await authenticate(req, true), r = record(raw), c = await collections(), now = new Date();
    const ms = Number(r.lastInputAt);
    assert(Number.isFinite(ms) && ms <= now.getTime() + 5000, 400, "INVALID_INPUT", "Invalid activity time.");
    const at = new Date(Math.min(ms, now.getTime()));
    await c.users.updateOne({ _id: user._id }, { $set: { lastSeenAt: now.toISOString(), visible: r.visible === true }, $max: { lastActivityAt: at.toISOString() } });
    if (at > session.lastInputAt && now.getTime() - at.getTime() < idleMs)
        await c.sessions.updateOne({ _id: session._id }, { $max: { lastInputAt: at, idleExpiresAt: new Date(at.getTime() + idleMs) } });
    return { ok: true };
}
export async function changePassword(user: UserDoc, raw: unknown) {
    const r = record(raw), old = rawPassword(r.currentPassword), pw = rawPassword(r.newPassword);
    passwordPolicy(pw);
    assert(await verifyPassword(old, user.passwordHash), 400, "INVALID_PASSWORD", "The current password is incorrect.");
    assert(old !== pw, 400, "UNCHANGED_PASSWORD", "Choose a different password.");
    const c = await collections();
    await c.users.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(pw), mustChangePassword: false, updatedAt: new Date().toISOString() }, $inc: { sessionVersion: 1 } });
    await audit(actor(user), "PASSWORD_CHANGED", {});
    return { ok: true, cookie: sessionCookie("", true) };
}
