"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Save, Send, Copy, ShieldCheck, Headphones } from "lucide-react";
import { useApp } from "./app-provider";
import { Field, Button, ErrorBox } from "./ui";
import { EMPTY_PATIENT, EMPTY_DOCTOR } from "@/lib/domain/types";
import type { Patient, Doctor, LeadView } from "@/lib/domain/types";
import { canEditPatient, canEditDoctor, isManagement, actionVisible } from "@/lib/domain/policy";
import { validationIssues } from "@/lib/domain/validation";
import { request, dateTime } from "@/lib/client";
const patientFields: [
    keyof Patient,
    string,
    boolean,
    string?
][] = [
    ["firstName", "First name", true], ["lastName", "Last name", true], ["dob", "Date of birth", true, "date"], ["address", "Address", true], ["city", "City", true], ["state", "State", true], ["zip", "ZIP code", true], ["phone", "Phone number", true, "tel"], ["height", "Height (include units)", true], ["weight", "Weight (include units)", true], ["shoeSize", "Shoe size", false], ["brace", "Brace", true]
];
const doctorFields: [
    keyof Doctor,
    string,
    string?
][] = [["name", "Doctor name"], ["npi", "NPI"], ["address", "Address"], ["city", "City"], ["state", "State"], ["zip", "ZIP code"], ["phone", "Phone number", "tel"], ["fax", "Fax number", "tel"]];
export function LeadEditor({ initial, onSaved, onDirty }: {
    initial?: LeadView;
    onSaved?: (lead: LeadView) => void;
    onDirty?: (dirty: boolean) => void;
}) {
    const app = useApp(), router = useRouter(), [lead, setLead] = useState(initial), [patient, setPatient] = useState<Patient>(initial?.patient || { ...EMPTY_PATIENT }), [doctor, setDoctor] = useState<Doctor>(initial?.doctor || { ...EMPTY_DOCTOR }), [base, setBase] = useState({ patient: initial?.patient || { ...EMPTY_PATIENT }, doctor: initial?.doctor || { ...EMPTY_DOCTOR } });
    const [saving, setSaving] = useState(false), [submitting, setSubmitting] = useState(false), [error, setError] = useState<unknown>(null), [savedAt, setSavedAt] = useState(""), [override, setOverride] = useState("");
    const lock = useRef(false), lastFailed = useRef("");
    const snapshot = JSON.stringify({ patient, doctor }), dirty = snapshot !== JSON.stringify(base), user = app.user!;
    const patientEditable = !lead || canEditPatient(user, lead), doctorEditable = !lead || canEditDoctor(user, lead);
    const issues = validationIssues(patient, doctor, true);
    if (lead?.identifiersMasked && patient.identifier === base.patient.identifier && patient.identifier.startsWith("****"))
        delete issues["patient.identifier"];
    const valid = Object.keys(issues).length === 0;
    useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
    useEffect(() => {
        if (initial && lead && initial.version > lead.version && !dirty && !lock.current) {
            setLead(initial);
            setPatient(initial.patient);
            setDoctor(initial.doctor);
            setBase({ patient: initial.patient, doctor: initial.doctor });
        }
    }, [initial?.version, lead?.version, dirty]);
    useEffect(() => {
        const before = (e: BeforeUnloadEvent) => {
            if (dirty) {
                e.preventDefault();
                e.returnValue = "";
            }
        };
        window.addEventListener("beforeunload", before);
        return () => window.removeEventListener("beforeunload", before);
    }, [dirty]);
    async function save(automatic = false): Promise<LeadView | null> {
        if (lock.current)
            return null;
        if (lead && !dirty)
            return lead;
        lock.current = true;
        setSaving(true);
        setError(null);
        const data = { patient: { ...patient }, doctor: { ...doctor } };
        try {
            let result: LeadView;
            if (!lead)
                result = await request<LeadView>("leads", { body: { ...data, department: "GENERATION", ...(override ? { duplicateOverrideReason: override } : {}) }, activity: true });
            else {
                const pp = Object.fromEntries(Object.entries(patient).filter(([k, v]) => v !== base.patient[k as keyof Patient])), dd = Object.fromEntries(Object.entries(doctor).filter(([k, v]) => v !== base.doctor[k as keyof Doctor]));
                result = await request<LeadView>(`leads/${lead._id}`, { method: "PATCH", body: { version: lead.version, ...(Object.keys(pp).length ? { patient: pp } : {}), ...(Object.keys(dd).length ? { doctor: dd } : {}), ...(override ? { duplicateOverrideReason: override } : {}) }, activity: true });
            }
            setLead(result);
            setBase({ patient: result.patient, doctor: result.doctor });
            setPatient(current => JSON.stringify(current) === JSON.stringify(data.patient) ? result.patient : current);
            setDoctor(current => JSON.stringify(current) === JSON.stringify(data.doctor) ? result.doctor : current);
            setSavedAt(new Date().toISOString());
            lastFailed.current = "";
            onSaved?.(result);
            if (!automatic)
                app.toast(result.status === "DRAFT" ? "Draft saved" : "Changes saved", result.code);
            return result;
        }
        catch (e) {
            setError(e);
            lastFailed.current = snapshot;
            return null;
        }
        finally {
            lock.current = false;
            setSaving(false);
        }
    }
    useEffect(() => {
        if (!dirty || saving || submitting || (!patient.firstName && !lead) || (lead && lead.status !== "DRAFT") || lastFailed.current === snapshot)
            return;
        const timer = setTimeout(() => void save(true), 1600);
        return () => clearTimeout(timer);
    }, [snapshot, saving, submitting, lead?.status, dirty]);
    async function submit() {
        setSubmitting(true);
        try {
            const current = await save();
            if (!current)
                return;
            const result = await request<LeadView>(`leads/${current._id}/workflow`, { body: { action: "SUBMIT", version: current.version }, activity: true });
            setLead(result);
            app.toast("Lead submitted", "The Generation Head has been notified.");
            app.refresh();
            router.push(`/leads/${result._id}`);
            onSaved?.(result);
        }
        catch (e) {
            setError(e);
        }
        finally {
            setSubmitting(false);
        }
    }
    async function copy(value: string) {
        try {
            await navigator.clipboard.writeText(value);
            app.toast("Copied to clipboard");
        }
        catch {
            app.toast("Clipboard unavailable", "Use your browser's copy command.");
        }
    }
    return <form onSubmit={e => { e.preventDefault(); void save(); }} className="lead-editor"><ErrorBox error={error}/><div className="editor-meta"><div><span className="label-mini">AGENT</span><strong>{initial ? "Original agent retained in history" : user.name}</strong></div><div><span className="label-mini">RECORD</span><strong className="mono">{lead?.code || "New draft"}</strong></div><div className="autosave-status">{saving ? "Saving..." : dirty ? "Unsaved changes" : savedAt ? `Saved ${dateTime(savedAt)}` : lead ? "Saved to MongoDB" : "Autosave begins when you enter a first name"}</div></div><section className="form-section"><div className="section-title"><span>01</span><div><h2>Patient details</h2><p>{patientEditable ? "Complete the required information before submission." : "Read-only in this department. Patient identifiers remain masked."}</p></div></div><div className="form-grid">{patientFields.map(([key, label, required, type]) => <Field key={key} label={label} required={required} error={patient[key] ? issues[`patient.${key}`] : undefined}><input autoComplete="off" readOnly={!patientEditable} type={type || "text"} maxLength={500} value={patient[key]} onChange={e => setPatient(v => ({ ...v, [key]: e.target.value }))}/></Field>)}<Field label="Identifier type" required><select disabled={!patientEditable} value={patient.identifierKind} onChange={e => setPatient(v => ({ ...v, identifierKind: e.target.value as Patient["identifierKind"], identifier: "" }))}><option value="MEDICARE">Medicare ID</option><option value="SSN">Social Security Number</option></select></Field><Field label={patient.identifierKind === "SSN" ? "Social Security Number" : "Medicare ID"} required error={patient.identifier ? issues["patient.identifier"] : undefined} hint={patient.identifier.startsWith("****") ? "Stored value is masked. Enter a new value only to replace it." : undefined}><input autoComplete="off" readOnly={!patientEditable} maxLength={30} value={patient.identifier} onChange={e => setPatient(v => ({ ...v, identifier: e.target.value }))}/></Field></div></section><section className="form-section"><div className="section-title"><span>02</span><div><h2>Doctor details</h2><p>Accurate contact details keep the next step moving.</p></div></div><div className="form-grid">{doctorFields.map(([key, label, type]) => <Field key={key} label={label} required error={doctor[key] ? issues[`doctor.${key}`] : undefined}><div className="input-with-button"><input autoComplete="off" readOnly={!doctorEditable} type={type || "text"} maxLength={500} value={doctor[key]} onChange={e => setDoctor(v => ({ ...v, [key]: e.target.value }))}/><button type="button" className="icon-btn" aria-label={`Copy doctor ${label}`} disabled={!doctor[key]} onClick={() => void copy(doctor[key])}><Copy size={15}/></button></div></Field>)}</div></section><section className="form-section"><div className="section-title"><span>03</span><div><h2>Insurance &amp; supporting information</h2><p>Q/A may complete insurance information during review.</p></div></div><div className="form-grid"><Field label="Insurance name"><input autoComplete="off" readOnly={!patientEditable} value={patient.insuranceName} onChange={e => setPatient(v => ({ ...v, insuranceName: e.target.value }))}/></Field><Field label="Member ID"><input autoComplete="off" readOnly={!patientEditable} value={patient.memberId} onChange={e => setPatient(v => ({ ...v, memberId: e.target.value }))}/></Field><div className="attachment-hint"><Headphones size={23}/><span>Recordings are optional.<br />{lead ? <Link href={`/leads/${lead._id}?tab=files`}>Open recordings &amp; files</Link> : <small>Save a draft to attach recordings.</small>}</span></div></div>{isManagement(user) && <details className="advanced"><summary>Duplicate override (Management only)</summary><Field label="Documented override reason" hint="Used only if matching patient records are detected."><textarea value={override} onChange={e => { setOverride(e.target.value); lastFailed.current = ""; }} maxLength={2000}/></Field></details>}</section><div className="editor-footer"><span><ShieldCheck size={16}/>{valid ? "Required fields are complete" : `${Object.keys(issues).length} required or invalid fields remain`}</span><div>{doctorEditable && <Button type="submit" variant="secondary" busy={saving} disabled={submitting || (!dirty && !!lead)}><Save size={16}/>{lead?.status === "DRAFT" || !lead ? "Save draft" : "Save changes"}</Button>}{(!lead || actionVisible(user, lead, "SUBMIT")) && <Button type="button" busy={submitting} disabled={!valid || saving} onClick={() => void submit()}><Send size={16}/>Submit to Generation Head</Button>}</div></div></form>;
}
