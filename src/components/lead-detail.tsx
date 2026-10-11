"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, ShieldCheck, Clock, Eye, Copy, RefreshCw, Upload, Download, FileText, Headphones, Plus } from "lucide-react";
import { useApp, useLoad } from "./app-provider";
import { PageTitle, Button, Badge, ErrorBox, Loading, Empty, Field, Modal } from "./ui";
import { LeadEditor } from "./lead-editor";
import { WorkflowDialog } from "./workflow-dialog";
import { ACTIONS, ACTION_LABELS, DEPARTMENT_NAMES, VERIFICATION_STATUSES } from "@/lib/domain/types";
import type { LeadView, Action, ActivityKind } from "@/lib/domain/types";
import { actionVisible, canReveal, canEditDoctor, isManagement } from "@/lib/domain/policy";
import { request, dateTime, pretty } from "@/lib/client";
type Activity = {
    _id: string;
    kind: ActivityKind;
    actorName: string;
    department: string;
    at: string;
    data: Record<string, string>;
};
type History = {
    _id: string;
    action: string;
    actorName: string;
    department: string;
    at: string;
    data: Record<string, unknown>;
};
type LeadFile = {
    _id: string;
    name: string;
    kind: "PDF" | "RECORDING";
    status: string;
    size: number;
    createdAt: string;
    uploadedByName: string;
    description: string;
};
export function LeadDetail({ id }: {
    id: string;
}) {
    const app = useApp(), router = useRouter(), params = useSearchParams(), [tab, setTab] = useState(params.get("tab") || "details"), [action, setAction] = useState<Action | null>(null), [dirty, setDirty] = useState(false), [revealed, setRevealed] = useState<{
        identifier: string;
        memberId: string;
    } | null>(null), [revealError, setRevealError] = useState<unknown>(null);
    const { data: lead, error, loading, refetch, setData } = useLoad<LeadView>(`leads/${id}`, true);
    useEffect(() => {
        if (!revealed)
            return;
        const timer = setTimeout(() => setRevealed(null), 30000);
        return () => clearTimeout(timer);
    }, [revealed]);
    useEffect(() => {
        if (params.get("tab") && !dirty)
            setTab(params.get("tab")!);
    }, [params.get("tab")]);
    if (!lead)
        return <><ErrorBox error={error}/>{loading && <Loading />}</>;
    const user = app.user!, actions = ACTIONS.filter(a => a !== "SUBMIT" && actionVisible(user, lead, a));
    async function reveal() {
        setRevealError(null);
        try {
            setRevealed(await request(`leads/${id}/reveal`, { body: {}, activity: true }));
        }
        catch (e) {
            setRevealError(e);
        }
    }
    return <><Link className="back-link" href={`/leads?department=${lead.department}`}><ArrowLeft size={16}/>Back to {DEPARTMENT_NAMES[lead.department].replace(" Department", "")}</Link><PageTitle eyebrow={lead.code} title={`${lead.patient.firstName || "Untitled draft"} ${lead.patient.lastName}`} description={`${DEPARTMENT_NAMES[lead.department]} - ${lead.completedSource ? `Completed source: ${DEPARTMENT_NAMES[lead.completedSource]}` : `Created ${dateTime(lead.createdAt)}`}`} actions={<><Badge value={lead.status}/>{actions.length > 0 && <select className="action-select" value="" aria-label="Choose workflow action" disabled={dirty} onChange={e => setAction(e.target.value as Action)}><option value="">Workflow action</option>{actions.map(a => <option value={a} key={a}>{ACTION_LABELS[a]}</option>)}</select>}<button className="icon-btn" title="Reload current record" aria-label="Reload current record" onClick={() => window.location.reload()}><RefreshCw size={18}/></button></>}/><ErrorBox error={error || revealError}/>{dirty && <div className="notice">Save your field changes before applying a workflow action. Leaving this screen without saving can discard changes.</div>}{lead.status === "REWORK_REQUIRED" && <div className="rework-banner"><span>REWORK REQUIRED</span>Review the latest return reason in the timeline, correct the information, add any new recording, then resubmit.</div>}<div className="record-summary"><span><Clock size={15}/>Updated {dateTime(lead.updatedAt)}</span><span>Version {lead.version}</span><span>Submission {lead.submissionVersion || "not yet submitted"}</span>{lead.followUpAt && <span>Follow-up: {dateTime(lead.followUpAt)}</span>}{canReveal(user, lead) && <button onClick={() => void reveal()}><Eye size={15}/>Reveal identifiers</button>}</div><section className="panel"><div className="tabs">{["details", "activity", "files", "timeline"].map(t => <button key={t} className={tab === t ? "tab-active" : ""} onClick={() => {
                if (dirty) {
                    app.toast("Save your changes first", "Save before switching tabs to avoid losing edits.");
                    return;
                }
                setTab(t);
            }}>{t === "details" ? "Lead details" : t === "files" ? "Files & recordings" : pretty(t)}</button>)}</div>{tab === "details" && <LeadEditor key={lead._id} initial={lead} onSaved={setData} onDirty={setDirty}/>} {tab === "activity" && <Activities lead={lead} onUpdated={refetch}/>} {tab === "files" && <Files lead={lead}/>} {tab === "timeline" && <Timeline id={id}/>}</section>{action && <WorkflowDialog leads={[lead]} action={action} onClose={() => setAction(null)} onDone={() => { app.refresh(); router.push(`/leads?department=${lead.department}`); }}/>} {revealed && <Modal title="Authorized identifier access" onClose={() => setRevealed(null)}><div className="notice">This reveal is audited and closes after 30 seconds. Do not share these identifiers outside authorized workflows.</div><Field label={lead.patient.identifierKind === "SSN" ? "Social Security Number" : "Medicare ID"}><input readOnly value={revealed.identifier}/></Field><Field label="Member ID"><input readOnly value={revealed.memberId}/></Field><Button variant="secondary" onClick={() => setRevealed(null)}>Hide identifiers</Button></Modal>}</>;
}
function Activities({ lead, onUpdated }: {
    lead: LeadView;
    onUpdated: () => void;
}) {
    const app = useApp(), [kind, setKind] = useState<ActivityKind>(["CHASING", "PV"].includes(lead.department) ? "CALL" : "COMMENT"), [fields, setFields] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [older, setOlder] = useState<Activity[]>([]), [next, setNext] = useState<string | null>(null);
    const { data, error: loadError, refetch } = useLoad<{
        items: Activity[];
        nextBefore: string | null;
    }>(`leads/${lead._id}/activities`, true);
    const editable = canEditDoctor(app.user!, lead), kinds: ActivityKind[] = ["COMMENT", ...(["CHASING", "PV"].includes(lead.department) ? ["CALL", "FAX"] as ActivityKind[] : []), ...(lead.department === "PV" ? ["VERIFICATION"] as ActivityKind[] : [])];
    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const payload = { ...fields };
            for (const key of ["followUpAt", "occurredAt", "faxDate", "sentAt", "receivedAt", "verifiedAt"])
                if (payload[key])
                    payload[key] = new Date(payload[key]).toISOString();
            await request(`leads/${lead._id}/activities`, { body: { kind, data: payload }, activity: true });
            setFields({});
            refetch();
            onUpdated();
            app.toast(`${pretty(kind)} saved`);
        }
        catch (e) {
            setError(e);
        }
        finally {
            setBusy(false);
        }
    }
    const input = (key: string, type = "text", required = false) => <input type={type} required={required} value={fields[key] || ""} onChange={e => setFields(v => ({ ...v, [key]: e.target.value }))}/>;
    async function more() {
        try {
            const result = await request<{
                items: Activity[];
                nextBefore: string | null;
            }>(`leads/${lead._id}/activities?before=${encodeURIComponent(next || data?.nextBefore || "")}`);
            setOlder(v => [...v, ...result.items]);
            setNext(result.nextBefore || "");
        }
        catch (e) {
            setError(e);
        }
    }
    const rows = [...(data?.items || []), ...older].filter((v, i, a) => a.findIndex(x => x._id === v._id) === i);
    return <div className="detail-section"><div className="split-detail"><div><h2>Log activity</h2><p className="muted">Calls, comments, fax attempts, and verification results are appended, never overwritten.</p><ErrorBox error={error || loadError}/>{editable ? <form onSubmit={submit}><Field label="Activity type"><select value={kind} onChange={e => { setKind(e.target.value as ActivityKind); setFields({}); }}>{kinds.map(k => <option key={k} value={k}>{pretty(k)}</option>)}</select></Field><div className="form-grid two-col">{kind === "CALL" && <><Field label="Number called" required>{input("number", "tel", true)}</Field><Field label="Outcome" required><select required value={fields.outcome || ""} onChange={e => setFields(v => ({ ...v, outcome: e.target.value }))}><option value="">Choose outcome</option>{["Connected", "No answer", "Voicemail", "Busy", "Wrong number", "Callback required"].map(x => <option key={x}>{x}</option>)}</select></Field><Field label="Call date / time">{input("occurredAt", "datetime-local")}</Field></>}{kind === "FAX" && <><Field label="Fax number" required>{input("faxNumber", "tel", true)}</Field><Field label="Fax status" required><select required value={fields.status || ""} onChange={e => setFields(v => ({ ...v, status: e.target.value }))}><option value="">Choose status</option>{["Pending", "Sent", "Received", "Failed", "Retry needed"].map(x => <option key={x}>{x}</option>)}</select></Field><Field label="Current fax date" required>{input("faxDate", "datetime-local", true)}</Field><Field label="Sent date">{input("sentAt", "datetime-local")}</Field><Field label="Received date">{input("receivedAt", "datetime-local")}</Field></>}{kind === "VERIFICATION" && <><Field label="Verification status" required><select required value={fields.status || ""} onChange={e => setFields(v => ({ ...v, status: e.target.value }))}><option value="">Choose status</option>{VERIFICATION_STATUSES.map(x => <option key={x} value={x}>{pretty(x)}</option>)}</select></Field><Field label="Verification result" required>{input("result", "text", true)}</Field><Field label="Reason" required={["NOT_VERIFIED", "REFUSED"].includes(fields.status)}>{input("reason", "text", ["NOT_VERIFIED", "REFUSED"].includes(fields.status))}</Field><Field label="Verification date">{input("verifiedAt", "datetime-local")}</Field></>}{kind !== "COMMENT" && <Field label="Follow-up date / time">{input("followUpAt", "datetime-local")}</Field>}</div><Field label={kind === "COMMENT" ? "Comment" : "Comments"} required={kind === "COMMENT"}><textarea required={kind === "COMMENT"} maxLength={4000} value={fields.comment || ""} onChange={e => setFields(v => ({ ...v, comment: e.target.value }))}/></Field><Button type="submit" busy={busy}><Plus size={16}/>Save {pretty(kind).toLowerCase()}</Button></form> : <Empty title="Record closed for changes" description="Management can reopen this record when more work is needed."/>}</div><div className="activity-list"><h2>Activity history</h2>{!rows.length ? <Empty title="No activity recorded"/> : rows.map(a => <article className="activity-card" key={a._id}><div><Badge value={a.kind}/><small>{dateTime(a.at)}</small></div><strong>{a.actorName} <span className="muted">/ {pretty(a.department)}</span></strong><dl>{Object.entries(a.data).filter(([, value]) => value).map(([key, value]) => <div key={key}><dt>{pretty(key.replace(/([A-Z])/g, " $1"))}</dt><dd>{key.endsWith("At") || key === "faxDate" ? dateTime(value) : value}</dd></div>)}</dl></article>)}{(next === null ? data?.nextBefore : next) && <Button variant="secondary" onClick={() => void more()}>Load earlier activity</Button>}</div></div></div>;
}
function Timeline({ id }: {
    id: string;
}) {
    const [older, setOlder] = useState<History[]>([]), [next, setNext] = useState<string | null>(null), [moreError, setMoreError] = useState<unknown>(null);
    const { data, error, loading } = useLoad<{
        items: History[];
        nextBefore: string | null;
    }>(`leads/${id}/history`, true);
    async function more() {
        try {
            const r = await request<{
                items: History[];
                nextBefore: string | null;
            }>(`leads/${id}/history?before=${encodeURIComponent(next || data?.nextBefore || "")}`);
            setOlder(v => [...v, ...r.items]);
            setNext(r.nextBefore || "");
        }
        catch (e) {
            setMoreError(e);
        }
    }
    return <div className="detail-section"><h2>Complete record timeline</h2><p className="muted">History is append-only through the application. Earlier entries remain available after reassignment and resubmission.</p><ErrorBox error={error || moreError}/>{loading && !data ? <Loading /> : <div className="timeline">{[...(data?.items || []), ...older].filter((v, i, a) => a.findIndex(x => x._id === v._id) === i).map(e => <article key={e._id}><span className="timeline-node"/><div className="timeline-heading"><strong>{pretty(e.action)}</strong><time>{dateTime(e.at)}</time></div><p>{e.actorName} <span className="muted">/ {pretty(e.department)}</span></p>{!!e.data.reason && <div className="timeline-reason">{String(e.data.reason)}</div>}{!!e.data.comment && <p>{String(e.data.comment)}</p>}<details><summary>View recorded changes</summary><pre>{JSON.stringify(e.data, null, 2)}</pre></details></article>)}</div>}{(next === null ? data?.nextBefore : next) && <Button variant="secondary" onClick={() => void more()}>Load earlier history</Button>}</div>;
}
function Files({ lead }: {
    lead: LeadView;
}) {
    const app = useApp(), [file, setFile] = useState<File | null>(null), [description, setDescription] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [media, setMedia] = useState<{
        name: string;
        url: string;
    } | null>(null), [extra, setExtra] = useState<LeadFile[]>([]), [next, setNext] = useState<string | null>(null);
    const { data, error: loadError, refetch } = useLoad<{
        items: LeadFile[];
        nextAfter: string | null;
    }>(`leads/${lead._id}/files`, true);
    useEffect(() => {
        if (data && window.location.hash)
            document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "center" });
    }, [data]);
    async function upload(e: React.FormEvent) {
        e.preventDefault();
        if (!file)
            return;
        setBusy(true);
        setError(null);
        try {
            const kind = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") ? "PDF" : "RECORDING";
            const type = file.type || (kind === "PDF" ? "application/pdf" : file.name.endsWith(".mp3") ? "audio/mpeg" : "audio/wav");
            const signed = await request<{
                fileId: string;
                url: string;
                fields: Record<string, string>;
            }>(`leads/${lead._id}/files`, { body: { name: file.name, type, size: file.size, kind, description }, activity: true });
            const form = new FormData();
            for (const [k, v] of Object.entries(signed.fields))
                form.append(k, v);
            form.append("file", file);
            const response = await fetch(signed.url, { method: "POST", body: form, credentials: "omit" });
            if (!response.ok)
                throw new Error("Private storage upload failed. Check bucket CORS and permissions.");
            await request(`files/${signed.fileId}/complete`, { body: {}, activity: true });
            setFile(null);
            setDescription("");
            refetch();
            app.toast("Upload received", "The file is quarantined until the scanner approves this exact version.");
        }
        catch (e) {
            setError(e);
        }
        finally {
            setBusy(false);
        }
    }
    async function open(f: LeadFile, inline: boolean) {
        setError(null);
        const tab = f.kind === "PDF" || !inline ? window.open("about:blank", "_blank") : null;
        if (tab)
            tab.opener = null;
        try {
            const result = await request<{
                url: string;
            }>(`files/${f._id}/download?inline=${inline ? 1 : 0}`, { activity: true });
            if (inline && f.kind === "RECORDING")
                setMedia({ name: f.name, url: result.url });
            else if (tab)
                tab.location.href = result.url;
            else
                app.toast("Popup blocked", "Allow popups for this site and try again.");
        }
        catch (e) {
            tab?.close();
            setError(e);
        }
    }
    async function copy(f: LeadFile) {
        try {
            await navigator.clipboard.writeText(`${window.location.origin}/leads/${lead._id}?tab=files#file-${f._id}`);
            app.toast("Secure reference copied", "The recipient must sign in and have access to this lead.");
        }
        catch (e) {
            setError(e);
        }
    }
    async function more() {
        try {
            const r = await request<{
                items: LeadFile[];
                nextAfter: string | null;
            }>(`leads/${lead._id}/files?after=${encodeURIComponent(next || data?.nextAfter || "")}`);
            setExtra(v => [...v, ...r.items]);
            setNext(r.nextAfter || "");
        }
        catch (e) {
            setError(e);
        }
    }
    const rows = [...(data?.items || []), ...extra].filter((v, i, a) => a.findIndex(x => x._id === v._id) === i);
    return <div className="detail-section"><h2>Files &amp; recordings</h2><p className="muted">Version-pinned private files. Earlier PDFs and recordings are retained; there is no permanent-delete action.</p><ErrorBox error={error || loadError}/>{canEditDoctor(app.user!, lead) && <form className="upload-panel" onSubmit={upload}><Upload size={25}/><Field label="Choose PDF or audio" hint="PDF up to 25 MB. Audio up to 100 MB."><input type="file" accept="application/pdf,audio/*" onChange={e => setFile(e.target.files?.[0] || null)}/></Field><Field label="Description"><input value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} placeholder="Optional context"/></Field><Button type="submit" busy={busy} disabled={!file}>Upload privately</Button></form>}{media && <div className="audio-panel"><Headphones size={20}/><strong>{media.name}</strong><audio controls autoPlay src={media.url}/><Button variant="ghost" onClick={() => setMedia(null)}>Close</Button></div>}{!rows.length ? <Empty title="No files attached yet" description="Uploads become accessible after the scanner marks their immutable version clean."/> : <div className="table-scroll"><table><thead><tr><th>FILE</th><th>UPLOADED BY</th><th>DATE</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{rows.map(f => <tr key={f._id} id={`file-${f._id}`}><td><span className="file-name">{f.kind === "PDF" ? <FileText size={18}/> : <Headphones size={18}/>}<strong>{f.name}</strong></span><small className="table-sub">{(f.size / 1024 / 1024).toFixed(2)} MB {f.description && `- ${f.description}`}</small></td><td>{f.uploadedByName}</td><td>{dateTime(f.createdAt)}</td><td><Badge value={f.status}/></td><td><div className="row-actions"><button className="icon-btn" title="Preview / play" disabled={f.status !== "CLEAN"} onClick={() => void open(f, true)}><Eye size={17}/></button><button className="icon-btn" title="Download" disabled={f.status !== "CLEAN"} onClick={() => void open(f, false)}><Download size={17}/></button><button className="icon-btn" title="Copy secure reference" onClick={() => void copy(f)}><Copy size={17}/></button></div></td></tr>)}</tbody></table></div>}{(next === null ? data?.nextAfter : next) && <Button variant="secondary" onClick={() => void more()}>Load more files</Button>}</div>;
}
