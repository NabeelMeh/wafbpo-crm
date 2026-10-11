import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import type { Actor, LeadCore } from "./domain/types.ts";
import { collections } from "./db.ts";
import { seal, unseal } from "./crypto.ts";
import type { EventDoc } from "./db.ts";
export async function audit(actor: Actor, action: string, data: unknown, lead?: LeadCore, session?: ClientSession, agentId?: string | null, sourceDepartment?: string): Promise<string> {
    const c = await collections(), id = randomUUID();
    const detail = (data && typeof data === "object" ? data : {}) as {before?:{department?:string};after?:{department?:string}};
    const fromDepartment=detail.before?.department, toDepartment=detail.after?.department;
    const arrivalDepartment=action==="CREATED" ? lead?.department : (fromDepartment && toDepartment && fromDepartment!==toDepartment ? toDepartment : undefined);
    await c.events.insertOne({ _id: id, leadId: lead?._id, code: lead?.code, actorId: actor.id, actorName: actor.name,
        actorUsername: actor.username, actorSpecialId: actor.employeeId, actorDesignation: actor.designation || (actor.role === "STAFF" ? (actor.memberships.some(m=>m.kind==="HEAD") ? "Department Head" : "Agent") : actor.role), fromDepartment, toDepartment, arrivalDepartment, actorRole: actor.role, department: sourceDepartment || lead?.department || "MANAGEMENT", agentId: agentId === undefined ? lead?.assignedTo : agentId, generationAgentId: lead?.createdBy,
        action, at: new Date().toISOString(), dataSealed: seal(data, `event:${id}`), submissionVersion: lead?.submissionVersion }, { session });
    return id;
}
export function eventView(e: EventDoc, includeData: boolean) {
    const { dataSealed, ...rest } = e;
    return { ...rest, ...(includeData ? { data: unseal(dataSealed, `event:${e._id}`) } : {}) };
}
