export const DEPARTMENTS = ["GENERATION", "QA", "CHASING", "PV", "MANAGEMENT"] as const;
export type Department = typeof DEPARTMENTS[number];
export type WorkDepartment = Exclude<Department, "MANAGEMENT">;
export const DEPARTMENT_NAMES: Record<Department, string> = {
    GENERATION: "Generation Department", QA: "Q/A Department", CHASING: "Chasing Department",
    PV: "Patient Verification Department", MANAGEMENT: "Management Department"
};
export const ACCOUNT_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED", "LOCKED", "DEACTIVATED"] as const;
export type AccountStatus = typeof ACCOUNT_STATUSES[number];
export type GlobalRole = "SUPER_ADMIN" | "MANAGEMENT" | "STAFF";
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
    role: GlobalRole;
    memberships: Membership[];
    accountStatus: AccountStatus;
    mustChangePassword: boolean;
    mfaEnabled: boolean;
}
export const STATUSES = ["DRAFT", "GENERATION_REVIEW", "QA_REVIEW", "REWORK_REQUIRED", "CHASING_ACTIVE", "PV_ACTIVE", "INCOMPLETE", "DENIED", "MANAGEMENT_REVIEW", "FINALIZED", "ARCHIVED"] as const;
export type LeadStatus = typeof STATUSES[number];
export const ACTIONS = ["SUBMIT", "APPROVE_GENERATION", "RETURN_GENERATION", "QA_GOOD", "QA_BAD", "RESUBMIT", "ASSIGN", "PULL_BACK", "DENY", "INCOMPLETE", "COMPLETE", "FINALIZE", "REOPEN", "ARCHIVE", "ROUTE_PV"] as const;
export type Action = typeof ACTIONS[number];
export const ACTION_LABELS: Record<Action, string> = {
    SUBMIT: "Submit to Generation Head", APPROVE_GENERATION: "Send to Q/A", RETURN_GENERATION: "Return to agent",
    QA_GOOD: "GOOD - send to Chasing", QA_BAD: "BAD - rework required", RESUBMIT: "Resubmit corrected lead",
    ASSIGN: "Assign / reassign", PULL_BACK: "Pull back to head", DENY: "Deny", INCOMPLETE: "Mark incomplete",
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
    reworkFrom?: "GENERATION" | "QA";
    completedSource?: "CHASING" | "PV";
    completedAgentId?: string | null;
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
