import type { Actor, Department, LeadCore, Patient, Doctor, WorkDepartment, Action } from "./types.ts";
import { assert } from "./errors.ts";
export const isManagement = (u: Actor) => u.role === "MANAGEMENT" || u.role === "SUPER_ADMIN";
export const isHead = (u: Actor, d?: Department) => u.memberships.some(m => m.kind === "HEAD" && (!d || m.department === d));
export const inDepartment = (u: Actor, d: Department) => isManagement(u) || u.memberships.some(m => m.department === d);
export const canSeeTeam = (u: Actor) => isManagement(u) || isHead(u);
export function canReadLead(u: Actor, l: LeadCore): boolean {
    if (u.accountStatus !== "ACTIVE")
        return false;
    if (isManagement(u))
        return true;
    if (!inDepartment(u, l.department))
        return false;
    if (l.status === "ARCHIVED" || l.status === "FINALIZED")
        return false;
    if (l.status === "DRAFT")
        return l.createdBy === u.id;
    if (isHead(u, l.department))
        return true;
    return l.assignedTo === u.id || (l.department === "GENERATION" && l.createdBy === u.id && l.status === "REWORK_REQUIRED");
}
export function assertRead(u: Actor, l: LeadCore | null): asserts l is LeadCore {
    assert(l && canReadLead(u, l), 404, "NOT_FOUND", "Record not found or no longer in your authorized queue.");
}
export function canReveal(u: Actor, l: LeadCore) {
    return canReadLead(u, l) && (isManagement(u) || l.department === "QA" || l.department === "GENERATION");
}
export function canEditPatient(u: Actor, l: LeadCore) {
    if (!canReadLead(u, l) || ["ARCHIVED", "FINALIZED", "DENIED"].includes(l.status))
        return false;
    return isManagement(u) || l.department === "QA" || (l.department === "GENERATION" && ["DRAFT", "REWORK_REQUIRED", "GENERATION_REVIEW"].includes(l.status) && (l.createdBy === u.id || isHead(u, "GENERATION")));
}
export function canEditDoctor(u: Actor, l: LeadCore) {
    return canReadLead(u, l) && !["ARCHIVED", "FINALIZED", "DENIED"].includes(l.status) && (isManagement(u) || inDepartment(u, l.department));
}
export function assertEdit(u: Actor, l: LeadCore, patch: {
    patient?: Partial<Patient>;
    doctor?: Partial<Doctor>;
}) {
    assertRead(u, l);
    if (patch.patient)
        assert(canEditPatient(u, l), 403, "FORBIDDEN", "Patient, insurance and brace fields cannot be edited in this role.");
    if (patch.doctor)
        assert(canEditDoctor(u, l), 403, "FORBIDDEN", "Doctor fields are not editable in this state.");
}
export function assertCreate(u: Actor, d: WorkDepartment) {
    assert(u.accountStatus === "ACTIVE", 403, "FORBIDDEN", "Account is not active.");
    assert(isManagement(u) || (d === "GENERATION" && inDepartment(u, "GENERATION")), 403, "FORBIDDEN", "Only Generation can create Generation leads; Management controls datasets.");
    assert(["GENERATION", "CHASING", "PV"].includes(d), 400, "INVALID_DEPARTMENT", "New records must start in Generation, Chasing or Patient Verification.");
}
// This predicate is used in database reads, counts, exports and report scope. It is NOT a UI-only check.
export function leadScope(u: Actor): Record<string, unknown> {
    if (u.accountStatus !== "ACTIVE")
        return { _id: "__no_access__" };
    if (isManagement(u))
        return {};
    const scopes: Record<string, unknown>[] = [];
    for (const m of u.memberships) {
        if (m.kind === "HEAD")
            scopes.push({ department: m.department, status: { $nin: ["DRAFT", "FINALIZED", "ARCHIVED"] } });
        scopes.push({ department: m.department, assignedTo: u.id, status: { $nin: ["DRAFT", "FINALIZED", "ARCHIVED"] } });
        if (m.department === "GENERATION")
            scopes.push({ department: "GENERATION", createdBy: u.id, status: { $in: ["DRAFT", "REWORK_REQUIRED"] } });
    }
    return scopes.length ? { $or: scopes } : { _id: "__no_access__" };
}
export function canAssignTo(actor: Actor, target: Actor, department: Department): boolean {
    if (target.accountStatus !== "ACTIVE" || department === "MANAGEMENT")
        return false;
    return target.memberships.some(m => m.department === department && m.kind === "AGENT" && (isManagement(actor) || m.headId === actor.id));
}
export function actionVisible(u: Actor, l: LeadCore, action: Action): boolean {
    if (!canReadLead(u, l))
        return false;
    const mg = isManagement(u), head = isHead(u, l.department) || mg;
    switch (action) {
        case "SUBMIT": return l.status === "DRAFT" && (l.createdBy === u.id || mg);
        case "APPROVE_GENERATION":
        case "RETURN_GENERATION": return l.status === "GENERATION_REVIEW" && head;
        case "QA_GOOD":
        case "QA_BAD": return l.status === "QA_REVIEW" && (mg || inDepartment(u, "QA"));
        case "RESUBMIT": return l.status === "REWORK_REQUIRED" && (l.createdBy === u.id || head);
        case "ASSIGN": return head && l.department !== "MANAGEMENT" && !["DRAFT", "ARCHIVED", "FINALIZED", "DENIED"].includes(l.status);
        case "PULL_BACK": return head && !!l.assignedTo && l.department !== "MANAGEMENT" && !["DRAFT", "ARCHIVED", "FINALIZED", "DENIED"].includes(l.status);
        case "DENY":
        case "INCOMPLETE":
        case "COMPLETE": return head && ["CHASING", "PV"].includes(l.department) && ["CHASING_ACTIVE", "PV_ACTIVE", "INCOMPLETE"].includes(l.status);
        case "FINALIZE": return mg && l.status === "MANAGEMENT_REVIEW";
        case "REOPEN": return mg && ["DENIED", "INCOMPLETE", "MANAGEMENT_REVIEW", "FINALIZED", "ARCHIVED"].includes(l.status);
        case "ARCHIVE": return mg && l.status !== "ARCHIVED" && l.status !== "DRAFT";
        case "ROUTE_PV": return mg && ["CHASING_ACTIVE", "MANAGEMENT_REVIEW", "FINALIZED", "DENIED"].includes(l.status);
    }
}
