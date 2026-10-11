import { AppError, assert } from "./errors.ts";
import { EMPTY_PATIENT, EMPTY_DOCTOR, DEPARTMENTS, ACTIONS, VERIFICATION_STATUSES } from "./types.ts";
import type { Patient, Doctor, WorkflowInput, ActivityKind, WorkDepartment } from "./types.ts";
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function record(v: unknown): Record<string, unknown> { assert(isRecord(v), 400, "INVALID_INPUT", "Expected a JSON object."); return v; }
export function text(v: unknown, name: string, max = 2000, required = false): string {
    assert(v === undefined || typeof v === "string", 400, "INVALID_INPUT", `${name} must be text.`);
    const s = (v as string | undefined ?? "").trim();
    assert(s.length <= max, 400, "INVALID_INPUT", `${name} is too long (maximum ${max}).`);
    if (required)
        assert(s.length > 0, 400, "INVALID_INPUT", `${name} is required.`);
    return s;
}
export function onlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
    const extra = Object.keys(value).filter(k => !keys.includes(k));
    assert(!extra.length, 400, "UNKNOWN_FIELD", `Unknown or protected fields: ${extra.join(", ")}`);
}
function parsePart<T extends Record<string, string>>(raw: unknown, defaults: T): T {
    const r = record(raw);
    onlyKeys(r, Object.keys(defaults));
    const out = { ...defaults };
    for (const k of Object.keys(defaults))
        if (r[k] !== undefined)
            out[k as keyof T] = text(r[k], k, 500) as T[keyof T];
    return out;
}
export function parsePatient(raw: unknown): Patient {
    const p = parsePart(raw, { ...EMPTY_PATIENT });
    assert(["MEDICARE", "SSN"].includes(p.identifierKind), 400, "INVALID_IDENTIFIER_TYPE", "Select Medicare or SSN.");
    return p;
}
export function parseDoctor(raw: unknown): Doctor { return parsePart(raw, { ...EMPTY_DOCTOR }); }
export function partialPatient(raw: unknown): Partial<Patient> {
    const r = record(raw);
    onlyKeys(r, Object.keys(EMPTY_PATIENT));
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r))
        out[k] = text(v, k, 500);
    if (out.identifierKind)
        assert(["MEDICARE", "SSN"].includes(out.identifierKind), 400, "INVALID_INPUT", "Invalid identifier type.");
    return out as Partial<Patient>;
}
export function partialDoctor(raw: unknown): Partial<Doctor> { const r = record(raw); onlyKeys(r, Object.keys(EMPTY_DOCTOR)); return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, text(v, k, 500)])); }
export function validationIssues(p: Patient, d: Doctor, full: boolean): Record<string, string> {
    const errors: Record<string, string> = {};
    const requireKeys = (obj: object, keys: string[], prefix: string) => {
        for (const k of keys)
            if (!String((obj as Record<string, unknown>)[k] ?? "").trim())
                errors[`${prefix}.${k}`] = "Required";
    };
    if (full) {
        requireKeys(p, ["firstName", "lastName", "dob", "address", "city", "state", "zip", "phone", "identifier", "height", "weight", "brace"], "patient");
        requireKeys(d, Object.keys(EMPTY_DOCTOR), "doctor");
    }
    for (const [field, value] of [["patient.phone", p.phone], ["doctor.phone", d.phone], ["doctor.fax", d.fax]])
        if (value && !/^\+?[\d\s().-]{7,25}$/.test(value))
            errors[field] = "Enter a valid phone number";
    if (p.dob) {
        const date = new Date(p.dob);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(p.dob) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== p.dob || date > new Date() || date.getUTCFullYear() < 1900)
            errors["patient.dob"] = "Enter a valid date of birth";
    }
    if (p.identifier && p.identifierKind === "SSN" && !/^\d{9}$/.test(p.identifier.replace(/[-\s]/g, "")))
        errors["patient.identifier"] = "SSN must contain 9 digits";
    if (p.identifier && p.identifierKind === "MEDICARE" && !/^[A-Za-z0-9]{11}$/.test(p.identifier.replace(/[-\s]/g, "")))
        errors["patient.identifier"] = "Medicare identifier must contain 11 letters or digits";
    if (d.npi && !/^\d{10}$/.test(d.npi))
        errors["doctor.npi"] = "NPI must contain 10 digits";
    if (p.weight && !/\d/.test(p.weight))
        errors["patient.weight"] = "Include a numeric weight and units";
    if (p.height && !/\d/.test(p.height))
        errors["patient.height"] = "Include a numeric height and units";
    return errors;
}
export function validateLead(p: Patient, d: Doctor, full: boolean) {
    const e = validationIssues(p, d, full);
    if (Object.keys(e).length)
        throw new AppError(400, "VALIDATION_FAILED", "Correct the highlighted lead fields.", e);
}
export function parseWorkflow(raw: unknown): WorkflowInput {
    const r = record(raw);
    onlyKeys(r, ["action", "version", "reason", "comment", "followUpAt", "destination", "assigneeId"]);
    assert(ACTIONS.includes(r.action as never), 400, "INVALID_ACTION", "Unknown workflow action.");
    assert(Number.isInteger(r.version) && Number(r.version) > 0, 400, "INVALID_VERSION", "A valid record version is required.");
    const x: WorkflowInput = { action: r.action as WorkflowInput["action"], version: Number(r.version) };
    for (const k of ["reason", "comment", "followUpAt", "assigneeId"] as const)
        if (r[k] !== undefined)
            x[k] = text(r[k], k, 2000);
    if (r.destination !== undefined) {
        assert(DEPARTMENTS.includes(r.destination as never) && r.destination !== "MANAGEMENT", 400, "INVALID_DEPARTMENT", "Invalid destination.");
        x.destination = r.destination as WorkDepartment;
    }
    return x;
}
export function parseActivity(raw: unknown) {
    const r = record(raw);
    onlyKeys(r, ["kind", "data"]);
    assert(["COMMENT", "CALL", "FAX", "VERIFICATION"].includes(r.kind as string), 400, "INVALID_ACTIVITY", "Invalid activity type.");
    const kind = r.kind as ActivityKind, data = record(r.data), out: Record<string, string> = {};
    const allowed = { COMMENT: ["comment"], CALL: ["number", "outcome", "comment", "followUpAt", "occurredAt"], FAX: ["faxNumber", "status", "faxDate", "sentAt", "receivedAt", "followUpAt", "comment"], VERIFICATION: ["status", "result", "reason", "comment", "followUpAt", "verifiedAt"] };
    onlyKeys(data, allowed[kind]);
    for (const [k, v] of Object.entries(data))
        out[k] = text(v, k, 4000);
    const required = { COMMENT: ["comment"], CALL: ["number", "outcome"], FAX: ["faxNumber", "status", "faxDate"], VERIFICATION: ["status", "result"] };
    for (const key of required[kind])
        assert(out[key], 400, "INVALID_ACTIVITY", `${key} is required.`);
    if (kind === "VERIFICATION")
        assert(VERIFICATION_STATUSES.includes(out.status as never), 400, "INVALID_ACTIVITY", "Invalid verification status.");
    if (kind === "VERIFICATION" && ["NOT_VERIFIED", "REFUSED"].includes(out.status))
        assert(out.reason, 400, "REASON_REQUIRED", "A verification reason is required.");
    for (const key of ["followUpAt", "occurredAt", "faxDate", "sentAt", "receivedAt", "verifiedAt"])
        if (out[key])
            assert(Number.isFinite(Date.parse(out[key])), 400, "INVALID_DATE", `Invalid ${key}.`);
    return { kind, data: out };
}
export function passwordPolicy(password: string) { assert(password.length >= 14 && password.length <= 128, 400, "WEAK_PASSWORD", "Use a password or passphrase between 14 and 128 characters."); }
