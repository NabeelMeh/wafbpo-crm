"use client";
import { useState } from "react";
import { useApp, useLoad } from "./app-provider";
import { Modal, Field, Button, ErrorBox } from "./ui";
import type { Action, Actor, LeadView, WorkDepartment } from "@/lib/domain/types";
import { DEPARTMENTS, DEPARTMENT_NAMES, ACTION_LABELS } from "@/lib/domain/types";
import { reopenDestination } from "@/lib/domain/policy";
import { request } from "@/lib/client";
export function WorkflowDialog({ leads, action, onClose, onDone }: {
    leads: LeadView[];
    action: Action;
    onClose: () => void;
    onDone: () => void;
}) {
    const app = useApp(), [reason, setReason] = useState(""), [comment, setComment] = useState(""), [assigneeId, setAssignee] = useState(""), [destination, setDestination] = useState<WorkDepartment>("CHASING"), [followUpAt, setFollowUp] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
    const { data: agents, error: agentsError } = useLoad<{
        items: Actor[];
    }>(action === "ASSIGN" ? `users/assignees?department=${leads[0].department}` : null);
    const reasonNeeded = ["QA_BAD", "RETURN_GENERATION", "DENY", "INCOMPLETE", "REOPEN", "ARCHIVE", "ROUTE_PV", "RELEASE"].includes(action), commentNeeded = ["QA_BAD", "REOPEN"].includes(action);
    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const common = { action, ...(reason ? { reason } : {}), ...(comment ? { comment } : {}), ...(assigneeId ? { assigneeId } : {}), ...(followUpAt ? { followUpAt: new Date(followUpAt).toISOString() } : {}) };
            if (leads.length === 1)
                await request(`leads/${leads[0]._id}/workflow`, { body: { ...common, version: leads[0].version }, activity: true });
            else
                await request("leads/bulk", { body: { ...common, items: leads.map(l => ({ id: l._id, version: l.version })) }, activity: true });
            app.toast("Workflow updated", `${leads.length} record${leads.length > 1 ? "s" : ""} updated successfully.`);
            app.refresh();
            onDone();
            onClose();
        }
        catch (e) {
            setError(e);
        }
        finally {
            setBusy(false);
        }
    }
    return <Modal title={ACTION_LABELS[action]} onClose={onClose}><form onSubmit={submit}><p className="muted">{leads.length === 1 ? leads[0].code : `${leads.length} selected records`}. This action is recorded in the audit trail.</p>{leads.length > 1 && <div className="notice">The batch is all-or-nothing. A stale record or permission conflict cancels the entire batch.</div>}<ErrorBox error={error || agentsError}/>{action === "ASSIGN" && <Field label="Assign to agent" required><select required value={assigneeId} onChange={e => setAssignee(e.target.value)}><option value="">Select an active agent</option>{agents?.items.map(a => <option key={a.id} value={a.id}>{a.name} - {a.employeeId}</option>)}</select></Field>}{action === "REOPEN" && <div className="notice">Routing is automatic: {leads.map(l=>`${l.code}: ${DEPARTMENT_NAMES[reopenDestination(l)]}`).join("; ")}</div>}{reasonNeeded && <Field label="Reason" required><textarea required minLength={3} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} placeholder="Explain why this action is needed."/></Field>}{action === "INCOMPLETE" && <Field label="Follow-up date and time" required><input required type="datetime-local" value={followUpAt} onChange={e => setFollowUp(e.target.value)}/></Field>}<Field label="Comment" required={commentNeeded}><textarea required={commentNeeded} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} placeholder="Add context for the next person."/></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" variant={["QA_BAD", "DENY", "ARCHIVE"].includes(action) ? "danger" : "primary"} busy={busy}>Confirm action</Button></div></form></Modal>;
}
