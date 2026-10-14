import { MongoClient, type Db, type ClientSession } from "mongodb";
import type { Actor, LeadDoc, Membership, AccountStatus, GlobalRole, NotificationView, ActivityKind } from "./domain/types.ts";
export interface UserDoc {
    _id: string;
    name: string;
    username: string;
    employeeId: string;
    employeeIdNormalized?: string;
    designation?: string;
    deletionGranted?: boolean;
    searchTokens?: string[];
    role: GlobalRole;
    memberships: Membership[];
    accountStatus: AccountStatus;
    enrollmentStatus?: "ENROLLED" | "NOT_ENROLLED";
    passwordHash: string;
    sessionVersion: number;
    mustChangePassword: boolean;
    mfaEnabled: boolean;
    mfaSecretSealed?: string;
    mfaPendingSealed?: string;
    mfaPendingExpiresAt?: Date;
    mfaLastStep?: number;
    recoveryHashes?: string[];
    createdAt: string;
    updatedAt: string;
    lastLoginAt?: string;
    lastActivityAt?: string;
    lastSeenAt?: string;
    visible?: boolean;
}
export interface SessionDoc {
    _id: string;
    userId: string;
    mfaVerified?: boolean;
    deviceHash?: string;
    userAgent?: string;
    ip?: string;
    version: number;
    expiresAt: Date;
    idleExpiresAt: Date;
    lastInputAt: Date;
    createdAt: Date;
}
export interface EventDoc {
    _id: string;
    leadId?: string;
    code?: string;
    actorId: string;
    actorName: string;
    actorUsername: string;
    actorSpecialId?: string;
    actorDesignation?: string;
    fromDepartment?: string;
    toDepartment?: string;
    arrivalDepartment?: string;
    actorRole: string;
    department: string;
    agentId?: string | null;
    action: string;
    at: string;
    dataSealed: string;
    submissionVersion?: number;
    generationAgentId?: string;
}
export interface NotificationDoc extends NotificationView {
    userId: string;
    eventId: string;
}
export interface ActivityDoc {
    _id: string;
    leadId: string;
    kind: ActivityKind;
    actorId: string;
    actorName: string;
    department: string;
    at: string;
    dataSealed: string;
}
export interface FileDoc {
    _id: string;
    leadId: string;
    key: string;
    versionId?: string;
    name: string;
    type: string;
    size: number;
    kind: "PDF" | "RECORDING" | "DOCUMENT" | "IMAGE" | "LOGO";
    status: "PENDING" | "QUARANTINED" | "CLEAN" | "REJECTED" | "DELETED" | "PURGED";
    deletedAt?: string;
    deletedBy?: string;
    purgeAfter?: string;
    scanLeaseToken?: string;
    scanLeaseUntil?: Date;
    nextScanAt?: Date;
    uploadedBy: string;
    uploadedByName: string;
    department: string;
    description: string;
    createdAt: string;
    scanAt?: string;
}
export interface ImportDoc {
    _id: string;
    name: string;
    department: "CHASING" | "PV";
    createdBy: string;
    createdAt: string;
    total: number;
    status: "OPEN" | "COMPLETE";
}
export interface ImportRowDoc {
    _id: string;
    importId: string;
    row: number;
    sourceHash: string;
    status: "IMPORTED" | "DUPLICATE" | "FAILED" | "SKIPPED";
    leadId?: string;
    error?: string;
}
export interface SettingDoc { _id: string; value: unknown; updatedAt: string; updatedBy: string; }
export interface TrustedDeviceDoc {
    _id: string; userId: string; deviceHash: string; sessionVersion: number;
    createdAt: string; lastUsedAt: string; expiresAt: Date; userAgent: string; revokedAt?: string;
}
export interface DeviceChallengeDoc {
    _id: string; userId: string; deviceHash: string; codeHash: string; attempts: number;
    sessionVersion: number; mfaVerified: boolean; expiresAt: Date; createdAt: string;
}
interface CounterDoc {
    _id: string;
    seq: number;
}
interface RateDoc {
    _id: string;
    count: number;
    expiresAt: Date;
}
interface GuardDoc {
    _id: string;
    version: number;
}
interface IdempotencyDoc {
    _id: string;
    actorId: string;
    requestHash: string;
    responseSealed: string;
    createdAt: string;
}
declare global {
    var wafMongoPromise: Promise<MongoClient> | undefined;
}
export async function client(): Promise<MongoClient> {
    if (!globalThis.wafMongoPromise) {
        const uri = process.env.MONGODB_URI;
        if (!uri)
            throw new Error("MONGODB_URI is not configured.");
        const c = new MongoClient(uri, { maxPoolSize: 10, minPoolSize: 0, maxIdleTimeMS: 60000, waitQueueTimeoutMS: 5000, serverSelectionTimeoutMS: 8000 });
        globalThis.wafMongoPromise = c.connect().catch(e => { globalThis.wafMongoPromise = undefined; throw e; });
    }
    return globalThis.wafMongoPromise;
}
export async function database(): Promise<Db> { return (await client()).db(process.env.MONGODB_DB || "cloud_nest_bpo_crm"); }
export async function collections() {
    const db = await database();
    return {
        db, users: db.collection<UserDoc>("users"), sessions: db.collection<SessionDoc>("sessions"), leads: db.collection<LeadDoc>("leads"),
        events: db.collection<EventDoc>("events"), notifications: db.collection<NotificationDoc>("notifications"), activities: db.collection<ActivityDoc>("activities"),
        files: db.collection<FileDoc>("files"), counters: db.collection<CounterDoc>("counters"), rateLimits: db.collection<RateDoc>("rateLimits"),
        duplicateGuards: db.collection<GuardDoc>("duplicateGuards"), idempotency: db.collection<IdempotencyDoc>("idempotency"),
        imports: db.collection<ImportDoc>("imports"), importRows: db.collection<ImportRowDoc>("importRows"), settings: db.collection<SettingDoc>("settings"),
        trustedDevices: db.collection<TrustedDeviceDoc>("trustedDevices"), deviceChallenges: db.collection<DeviceChallengeDoc>("deviceChallenges")
    };
}
export async function transaction<T>(fn: (s: ClientSession) => Promise<T>): Promise<T> {
    const s = (await client()).startSession();
    try {
        return await s.withTransaction(() => fn(s), { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary" }) as T;
    }
    finally {
        await s.endSession();
    }
}
export function actor(u: UserDoc): Actor { return { id: u._id, name: u.name, username: u.username, employeeId: u.employeeId, designation: u.designation || (u.role === "STAFF" ? (u.memberships.some(m => m.kind === "HEAD") ? "Department Head" : "Agent") : u.role), deletionGranted: u.deletionGranted === true, role: u.role, memberships: u.memberships, accountStatus: u.accountStatus, enrollmentStatus: u.enrollmentStatus || "ENROLLED", mustChangePassword: u.mustChangePassword, mfaEnabled: u.mfaEnabled }; }
export async function ensureIndexes() {
    const c = await collections();
    await Promise.all([
        c.users.createIndex({employeeIdNormalized:1},{unique:true,sparse:true}), c.users.createIndex({searchTokens:1}),
        c.leads.createIndex({identifierSearchKeys:1}), c.leads.createIndex({department:1,"claim.expiresAt":1}),
        c.events.createIndex({action:1,at:-1,_id:-1}), c.events.createIndex({arrivalDepartment:1,at:1,leadId:1}),
        c.trustedDevices.createIndex({userId:1,deviceHash:1},{unique:true}), c.trustedDevices.createIndex({expiresAt:1},{expireAfterSeconds:0}),
        c.deviceChallenges.createIndex({expiresAt:1},{expireAfterSeconds:0}), c.deviceChallenges.createIndex({userId:1,deviceHash:1}),
        c.files.createIndex({status:1,purgeAfter:1}),
        c.users.createIndex({ username: 1 }, { unique: true }), c.users.createIndex({ employeeId: 1 }, { unique: true }), c.users.createIndex({ accountStatus: 1, "memberships.department": 1 }),
        c.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }), c.sessions.createIndex({ userId: 1 }), c.rateLimits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        c.leads.createIndex({ code: 1 }, { unique: true }), c.leads.createIndex({ department: 1, status: 1, createdAt: -1, _id: -1 }),
        c.leads.createIndex({ department: 1, assignedTo: 1, createdAt: -1, _id: -1 }), c.leads.createIndex({ department: 1, createdBy: 1, status: 1, createdAt: -1, _id: -1 }),
        c.leads.createIndex({ createdAt: -1, _id: -1 }), c.leads.createIndex({ updatedAt: -1, _id: -1 }), c.leads.createIndex({ department: 1, updatedAt: -1, _id: -1 }),
        c.leads.createIndex({ duplicateKeys: 1 }), c.leads.createIndex({ searchTokens: 1, createdAt: -1, _id: -1 }), c.leads.createIndex({ batch: 1, department: 1, createdAt: -1, _id: -1 }),
        c.leads.createIndex({ department: 1, followUpAt: 1 }), c.events.createIndex({ leadId: 1, at: -1, _id: -1 }), c.events.createIndex({ department: 1, at: -1 }),
        c.events.createIndex({ actorId: 1, at: -1 }), c.events.createIndex({ agentId: 1, action: 1, at: -1 }),
        c.notifications.createIndex({ userId: 1, createdAt: -1, _id: -1 }), c.notifications.createIndex({ userId: 1, deliveredAt: 1 }),
        c.notifications.createIndex({ userId: 1, eventId: 1 }, { unique: true }), c.activities.createIndex({ leadId: 1, at: -1, _id: -1 }),
        c.files.createIndex({ leadId: 1, createdAt: -1 }), c.files.createIndex({ status: 1, createdAt: 1 }),
        c.importRows.createIndex({ importId: 1, row: 1 }, { unique: true }), c.imports.createIndex({ createdAt: -1 })
    ]);
}
