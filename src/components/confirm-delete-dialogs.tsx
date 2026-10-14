"use client";
import { useState } from "react";
import { Modal, Field, ErrorBox, Button } from "./ui";
import { request } from "@/lib/client";
import type { LeadView } from "@/lib/domain/types";

export function BulkDeleteDialog({ leads, onClose, onDone }: { leads: LeadView[]; onClose: () => void; onDone: () => void }) {
    const phrase = `DELETE ${leads.length}`;
    const [reason, setReason] = useState(""), [confirmation, setConfirmation] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await request("leads/bulk-delete", { method: "POST", body: { items: leads.map(l => ({ id: l._id, version: l.version })), reason, confirmation }, activity: true });
            onDone();
            onClose();
        }
        catch (err) { setError(err); }
        finally { setBusy(false); }
    }
    return <Modal title={`Permanently delete ${leads.length} lead${leads.length === 1 ? "" : "s"}?`} onClose={onClose}><form onSubmit={submit}><ErrorBox error={error}/><p className="muted">{`This removes ${leads.length} record${leads.length === 1 ? "" : "s"} from every queue, report and view, along with their activities, notifications and attachments. The audit history is kept. This cannot be undone.`}</p><Field label="Reason" required><textarea required minLength={3} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}/></Field><Field label={`Type ${phrase} to confirm`} required><input required autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)}/></Field><div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" busy={busy} disabled={confirmation !== phrase || reason.trim().length < 3}>{`Delete ${leads.length}`}</Button></div></form></Modal>;
}

export function DeleteUserDialog({ user, onClose, onDone }: { user: { id: string; name: string; username: string }; onClose: () => void; onDone: () => void }) {
    const [confirmation, setConfirmation] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await request(`users/${user.id}`, { method: "DELETE", body: { confirmation }, activity: true });
            onDone();
            onClose();
        }
        catch (err) { setError(err); }
        finally { setBusy(false); }
    }
    return <Modal title={`Delete ${user.name}?`} onClose={onClose}><form onSubmit={submit}><ErrorBox error={error}/><p className="muted">Deleting signs this user out everywhere and removes their trusted devices. Users linked to lead records or leading a team cannot be deleted; block (suspend) them instead.</p><Field label={`Type ${user.username} to confirm`} required><input required autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)}/></Field><div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" busy={busy} disabled={confirmation !== user.username}>Delete user</Button></div></form></Modal>;
}
