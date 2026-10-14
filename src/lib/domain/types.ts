export const DEPARTMENTS = ["GENERATION", "QA", "CHASING", "PV", "MANAGEMENT"] as const;
export type Department = typeof DEPARTMENTS[number];
export type WorkDepartment = Exclude<Department, "MANAGEMENT">;
export const DEPARTMENT_NAMES: Record<Department, string> = {
    GENERATION: "Generation Department", QA: "Q/A Department", CHASING: "Chasing Department",
    PV: "Patient Verification Department", MANAGEMENT: "Management Department"
};
export const OUTSOURCE_TARGETS = ["CHASING", "PV", "BOTH"] as const;
export type OutsourceTarget = typeof OUTSOURCE_TARGETS[number];
export const OUTSOURCE_LABELS: Record<OutsourceTarget, string> = { CHASING: "Chasing only", PV: "PV only", BOTH: "Chasing + PV" };
export const ACCOUNT_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED", "LOCKED", "DEACTIVATED"] as const;
export type AccountStatus = typeof ACCOUNT_STATUSES[number];
export type GlobalRole = "SUPER_ADMIN" | "ADMIN" | "MANAGEMENT" | "STAFF";
export interface Membership {
    department: WorkDepartment;
    kind: "HEAD" | "AGENT";
    headId?: string;
}
export interface Actor {
    id: string;
    name: string;
    username: string;
    employeeId: string;
    designation?: string;
    deletionGranted?: boolean;
    role: GlobalRole;
    memberships: Membership[];
    accountStatus: AccountStatus;
    mustChangePassword: boolean;
    mfaEnabled: boolean;
    enrollmentStatus: "ENROLLED" | "NOT_ENROLLED";
}
export const STATUSES = ["DRAFT", "GENERATION_REVIEW", "QA_REVIEW", "REWORK_REQUIRED", "CHASING_ACTIVE", "PV_ACTIVE", "INCOMPLETE", "DENIED", "MANAGEMENT_REVIEW", "FINALIZED", "ARCHIVED", "MIGRATION_REVIEW"] as const;
export type LeadStatus = typeof STATUSES[number];
export const ACTIONS = ["SUBMIT", "APPROVE_GENERATION", "RETURN_GENERATION", "QA_GOOD", "QA_BAD", "RESUBMIT", "CLAIM", "RELEASE", "ASSIGN", "PULL_BACK", "DENY", "INCOMPLETE", "COMPLETE", "FINALIZE", "REOPEN", "ARCHIVE", "ROUTE_PV"] as const;
export type Action = typeof ACTIONS[number];
export const ACTION_LABELS: Record<Action, string> = {
    SUBMIT: "Submit to Q/A", APPROVE_GENERATION: "Send to Q/A", RETURN_GENERATION: "Return to agent",
    QA_GOOD: "GOOD - send to Chasing", QA_BAD: "BAD - rework required", RESUBMIT: "Resubmit corrected lead",
    CLAIM: "Claim this Q/A lead", RELEASE: "Release Q/A claim", ASSIGN: "Assign / reassign", PULL_BACK: "Pull back to head", DENY: "Deny", INCOMPLETE: "Mark incomplete",
    COMPLETE: "Complete - send to Management", FINALIZE: "Finalize", REOPEN: "Reopen", ARCHIVE: "Archive", ROUTE_PV: "Route to Patient Verification"
};
export interface Patient {
    firstName: string;
    lastName: string;
    dob: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
    identifierKind: "MEDICARE" | "SSN";
    identifier: string;
    height: string;
    weight: string;
    shoeSize: string;
    brace: string;
    insuranceName: string;
    memberId: string;
}
export interface Doctor {
    name: string;
    npi: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
    fax: string;
}
export interface LeadCore {
    _id: string;
    code: string;
    department: Department;
    status: LeadStatus;
    createdBy: string;
    assignedTo: string | null;
    version: number;
    submissionVersion: number;
    origin: WorkDepartment;
    claim?: { userId: string; name: string; specialId: string; claimedAt: string; expiresAt: string } | null;
    chasingDeniedAt?: string;
    chasingDeniedBy?: string;
    legacyRoutingReview?: boolean;
    deletedAt?: string;
    reworkFrom?: "GENERATION" | "QA";
    completedSource?: "CHASING" | "PV";
    completedAgentId?: string | null;
    outsource?: OutsourceTarget | null;
    outsourcedAt?: string;
    outsourcedBy?: string;
    outsourceChasingDoneAt?: string;
    outsourceChasingAgentId?: string | null;
    outsourceHistory?: { from: OutsourceTarget | null; to: OutsourceTarget | null; fromDepartment: string; toDepartment: string; fromStatus: string; toStatus: string; previousAssignee: string | null; by: string; at: string }[];
    followUpAt?: string | null;
    campaign: string;
    batch: string;
    createdAt: string;
    updatedAt: string;
}
export interface LeadDoc extends LeadCore {
    patientSealed: string;
    doctor: Doctor;
    searchTokens: string[];
    duplicateKeys: string[];
    identifierSearchKeys?: string[];
    lastFaxDate?: string;
    verificationStatus?: VerificationStatus;
}
export interface LeadView extends LeadCore {
    patient: Patient;
    doctor: Doctor;
    identifiersMasked: boolean;
    lastFaxDate?: string;
    verificationStatus?: VerificationStatus;
}
export interface WorkflowInput {
    action: Action;
    version: number;
    reason?: string;
    comment?: string;
    followUpAt?: string;
    destination?: WorkDepartment;
    assigneeId?: string;
}
export const VERIFICATION_STATUSES = ["NOT_CONTACTED", "ATTEMPTED", "CONTACTED", "VERIFIED", "NOT_VERIFIED", "CALLBACK_REQUIRED", "UNABLE_TO_REACH", "REFUSED"] as const;
export type VerificationStatus = typeof VERIFICATION_STATUSES[number];
export const EMPTY_PATIENT: Patient = {
    firstName: "", lastName: "", dob: "", address: "", city: "", state: "", zip: "", phone: "", identifierKind: "MEDICARE", identifier: "", height: "", weight: "", shoeSize: "", brace: "", insuranceName: "", memberId: ""
};
export const EMPTY_DOCTOR: Doctor = { name: "", npi: "", address: "", city: "", state: "", zip: "", phone: "", fax: "" };
export type ActivityKind = "COMMENT" | "CALL" | "FAX" | "VERIFICATION";
export interface NotificationView {
    _id: string;
    title: string;
    body: string;
    leadId?: string;
    code?: string;
    createdAt: string;
    acknowledgedAt?: string;
    deliveredAt?: string;
    count: number;
}
export interface TeamView extends Actor {
    lastLoginAt?: string;
    lastActivityAt?: string;
    presence: "ONLINE" | "AWAY" | "OFFLINE" | "INACTIVE";
}
