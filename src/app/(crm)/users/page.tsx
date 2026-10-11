"use client";
import { useState } from "react";
import { Plus, Pencil, Search, ShieldCheck } from "lucide-react";
import { useApp, useLoad } from "@/components/app-provider";
import { PageTitle, Button, Badge, ErrorBox, Loading, Modal, Field, Empty } from "@/components/ui";
import { DEPARTMENTS, DEPARTMENT_NAMES, ACCOUNT_STATUSES } from "@/lib/domain/types";
import type { Actor, Membership, GlobalRole, AccountStatus, WorkDepartment } from "@/lib/domain/types";
import { isManagement } from "@/lib/domain/policy";
import { request, pretty } from "@/lib/client";
export default function Users() {
    const app = useApp(), [editor, setEditor] = useState<Actor | "new" | null>(null), [q, setQ] = useState("");
    const { data, error, loading, refetch } = useLoad<{
        items: Actor[];
    }>(app.user && isManagement(app.user) ? "users" : null);
    if (!app.user)
        return null;
    if (!isManagement(app.user))
        return <ErrorBox error="User management is restricted to Management."/>;
    const rows = data?.items.filter(u => `${u.name} ${u.username} ${u.employeeId}`.toLowerCase().includes(q.toLowerCase())) || [];
    return <><PageTitle eyebrow="ACCESS & ORGANIZATION" title="User management" description="Create accounts, assign departments and heads, or change access. Passwords are never returned by the API." actions={<Button onClick={() => setEditor("new")}><Plus size={17}/>Create user</Button>}/><section className="panel"><div className="table-toolbar"><div className="filter-search"><Search size={17}/><input aria-label="Find user" placeholder="Search name, username or employee ID" value={q} onChange={e => setQ(e.target.value)}/></div><span className="muted">{data?.items.length || 0} accounts &middot; Editing access revokes existing sessions</span></div><ErrorBox error={error}/>{loading && !data ? <Loading /> : !rows.length ? <Empty title="No matching users"/> : <div className="table-scroll"><table><thead><tr><th>NAME / EMPLOYEE ID</th><th>USERNAME</th><th>ACCESS</th><th>DEPARTMENTS</th><th>ACCOUNT</th><th>MFA</th><th /></tr></thead><tbody>{rows.map(u => <tr key={u.id}><td><strong>{u.name}</strong><small className="table-sub">{u.employeeId}</small></td><td>{u.username}</td><td>{pretty(u.role)}</td><td>{u.memberships.length ? u.memberships.map(m => <small className="block" key={m.department}>{DEPARTMENT_NAMES[m.department].replace(" Department", "")} - {pretty(m.kind)}</small>) : "Management access"}</td><td><Badge value={u.accountStatus}/></td><td>{u.mfaEnabled ? <ShieldCheck size={18} className="text-teal"/> : "Not enrolled"}</td><td><button className="icon-btn" aria-label={`Edit ${u.name}`} disabled={u.role === "SUPER_ADMIN" && app.user?.role !== "SUPER_ADMIN"} onClick={() => setEditor(u)}><Pencil size={17}/></button></td></tr>)}</tbody></table></div>}</section>{editor && <UserEditor original={editor === "new" ? null : editor} users={data?.items || []} onClose={() => setEditor(null)} onDone={refetch}/>}</>;
}
function UserEditor({ original, users, onClose, onDone }: {
    original: Actor | null;
    users: Actor[];
    onClose: () => void;
    onDone: () => void;
}) {
    const app = useApp(), [name, setName] = useState(original?.name || ""), [username, setUsername] = useState(original?.username || ""), [employeeId, setEmployeeId] = useState(original?.employeeId || ""), [role, setRole] = useState<GlobalRole>(original?.role || "STAFF"), [status, setStatus] = useState<AccountStatus>(original?.accountStatus || "ACTIVE"), [memberships, setMemberships] = useState<Membership[]>(original?.memberships || []), [password, setPassword] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
    function membership(d: WorkDepartment, patch: Partial<Membership> | null) { setMemberships(v => patch === null ? v.filter(m => m.department !== d) : v.some(m => m.department === d) ? v.map(m => m.department === d ? { ...m, ...patch } : m) : [...v, { department: d, kind: "HEAD", ...patch }]); }
    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await request(original ? `users/${original.id}` : "users", { method: original ? "PATCH" : "POST", body: { name, username, employeeId, role, accountStatus: status, memberships, ...(password ? { password } : {}) }, activity: true });
            app.toast(original ? "User updated" : "User created", "Account changes are visible to all Heads and Management.");
            onDone();
            onClose();
            app.refresh();
        }
        catch (e) {
            setError(e);
        }
        finally {
            setBusy(false);
        }
    }
    return <Modal title={original ? `Edit ${original.name}` : "Create a user"} onClose={onClose}><form onSubmit={submit}><ErrorBox error={error}/><div className="form-grid two-col"><Field label="Full name" required><input required value={name} onChange={e => setName(e.target.value)} maxLength={100}/></Field><Field label="Employee ID" required><input required value={employeeId} onChange={e => setEmployeeId(e.target.value)} maxLength={50}/></Field><Field label="Username" required><input required pattern="[a-zA-Z0-9._-]{3,60}" autoComplete="off" value={username} onChange={e => setUsername(e.target.value)}/></Field><Field label="Access level" required><select value={role} onChange={e => setRole(e.target.value as GlobalRole)}><option value="STAFF">Department Head / Agent</option><option value="MANAGEMENT">Management User</option>{app.user?.role === "SUPER_ADMIN" && <option value="SUPER_ADMIN">Super Admin</option>}</select></Field><Field label="Account status"><select value={status} onChange={e => setStatus(e.target.value as AccountStatus)}>{ACCOUNT_STATUSES.map(s => <option key={s} value={s}>{pretty(s)}</option>)}</select></Field>{original?.id !== app.user?.id && <Field label={original ? "Reset password (optional)" : "Temporary password"} required={!original} hint="14-128 characters. The user must change it after signing in."><input type="password" autoComplete="new-password" required={!original} minLength={14} maxLength={128} value={password} onChange={e => setPassword(e.target.value)}/></Field>}</div><h3 className="form-subheading">Department memberships</h3><p className="muted">Create Heads first, then assign Agents under them. A staff member may belong to multiple departments.</p><div className="membership-list">{DEPARTMENTS.filter(d => d !== "MANAGEMENT").map(d => { const m = memberships.find(x => x.department === d); return <div key={d}><label className="checkbox-label"><input type="checkbox" checked={!!m} onChange={e => membership(d, e.target.checked ? { kind: "HEAD" } : null)}/>{DEPARTMENT_NAMES[d]}</label>{m && <><select aria-label={`${d} role`} value={m.kind} onChange={e => membership(d, { kind: e.target.value as "HEAD" | "AGENT", headId: undefined })}><option value="HEAD">Head</option><option value="AGENT">Agent</option></select>{m.kind === "AGENT" && <select aria-label={`${d} head`} required value={m.headId || ""} onChange={e => membership(d, { headId: e.target.value })}><option value="">Assign under a Head</option>{users.filter(u => u.id !== original?.id && u.accountStatus === "ACTIVE" && u.memberships.some(x => x.department === d && x.kind === "HEAD")).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}</>}</div>; })}</div><div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" busy={busy}>{original ? "Save user" : "Create user"}</Button></div></form></Modal>;
}
