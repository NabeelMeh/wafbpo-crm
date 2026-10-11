"use client";
import { useState } from "react";
import { Users, Radio, Search } from "lucide-react";
import { useApp, useLoad } from "@/components/app-provider";
import { PageTitle, Badge, ErrorBox, Loading, Button, Empty } from "@/components/ui";
import type { TeamView } from "@/lib/domain/types";
import { DEPARTMENT_NAMES } from "@/lib/domain/types";
import { canSeeTeam } from "@/lib/domain/policy";
import { pretty, dateTime } from "@/lib/client";
export default function Team() {
    const app = useApp(), [cursors, setCursors] = useState<string[]>([""]), [q, setQ] = useState("");
    const { data, error, loading } = useLoad<{
        items: TeamView[];
        nextAfter: string | null;
    }>(app.user && canSeeTeam(app.user) ? `team?after=${cursors.at(-1)}` : null, true);
    if (!app.user)
        return null;
    if (!canSeeTeam(app.user))
        return <ErrorBox error="Live team status is available to department Heads and Management."/>;
    const rows = data?.items.filter(u => `${u.name} ${u.employeeId} ${u.username}`.toLowerCase().includes(q.toLowerCase())) || [];
    return <><PageTitle eyebrow="PEOPLE & PRESENCE" title="Live team status" description="All Heads and Management can see basic account and presence status. This does not grant access to other departments' private leads." actions={<span className="live-chip"><Radio size={16}/>Refreshing automatically</span>}/><section className="panel"><div className="table-toolbar"><div className="filter-search"><Search size={17}/><input aria-label="Filter visible users" placeholder="Filter this page by name or employee ID" value={q} onChange={e => setQ(e.target.value)}/></div><span className="muted">This page: {data?.items.filter(u => u.presence === "ONLINE").length || 0} online / {data?.items.length || 0} accounts</span></div><ErrorBox error={error}/>{loading && !data ? <Loading /> : !rows.length ? <Empty title="No matching team members"/> : <div className="table-scroll"><table><thead><tr><th>TEAM MEMBER</th><th>DEPARTMENT / ROLE</th><th>ACCOUNT</th><th>PRESENCE</th><th>LAST LOGIN</th><th>LAST ACTIVITY</th></tr></thead><tbody>{rows.map(u => <tr key={u.id}><td><div className="person-cell"><span className="avatar">{u.name.slice(0, 1)}</span><span><strong>{u.name}</strong><small className="table-sub">{u.employeeId} - {u.username}</small></span></div></td><td>{u.role === "STAFF" ? u.memberships.map(m => <small className="block" key={m.department}>{DEPARTMENT_NAMES[m.department].replace(" Department", "")} / {pretty(m.kind)}</small>) : pretty(u.role)}</td><td><Badge value={u.accountStatus}/></td><td><span className={`presence presence-${u.presence.toLowerCase()}`}><i />{pretty(u.presence)}</span></td><td>{dateTime(u.lastLoginAt)}</td><td>{dateTime(u.lastActivityAt)}</td></tr>)}</tbody></table></div>}<div className="table-pagination"><span>Page {cursors.length}. Presence becomes offline after 90 seconds without a heartbeat.</span><div><Button variant="secondary" disabled={cursors.length === 1} onClick={() => setCursors(v => v.slice(0, -1))}>Previous</Button><Button variant="secondary" disabled={!data?.nextAfter} onClick={() => setCursors(v => [...v, data!.nextAfter!])}>Next</Button></div></div></section></>;
}
