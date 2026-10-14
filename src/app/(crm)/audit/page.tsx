"use client";
import { useState } from "react";
import { ScrollText, Search } from "lucide-react";
import { useApp, useLoad } from "@/components/app-provider";
import { PageTitle, ErrorBox, Loading, Button, Empty, Modal } from "@/components/ui";
import { isManagement } from "@/lib/domain/policy";
import { dateTime, pretty } from "@/lib/client";
type Event = {
    _id: string;
    code?: string;
    actorName: string;
    actorUsername: string;
    actorRole: string;
    department: string;
    action: string;
    at: string;
    data: unknown;
};
export default function Audit() {
    const app = useApp(), [action, setAction] = useState(""), [filter, setFilter] = useState(""), [cursors, setCursors] = useState<string[]>([""]), [selected, setSelected] = useState<Event | null>(null);
    const params = new URLSearchParams({ cursor: cursors.at(-1) || "", ...(filter ? { action: filter } : {}) });
    const { data, error, loading } = useLoad<{
        items: Event[];
        nextCursor: string | null;
    }>(app.user && isManagement(app.user) ? `audit?${params}` : null);
    if (!app.user)
        return null;
    if (!isManagement(app.user))
        return <ErrorBox error="Audit access is restricted to Management."/>;
    return <><PageTitle eyebrow="APPEND-ONLY HISTORY" title="Audit trail" description="Important actions capture the actor, role, department, timestamp and recorded changes. There are no audit-edit or delete endpoints."/><section className="panel"><form className="table-toolbar" onSubmit={e => { e.preventDefault(); setFilter(action.trim().toUpperCase()); setCursors([""]); }}><div className="filter-search"><Search size={17}/><input aria-label="Filter audit action" placeholder="Exact action, e.g. QA_GOOD or USER_UPDATED" value={action} onChange={e => setAction(e.target.value)}/></div><Button type="submit" variant="secondary">Filter action</Button></form><ErrorBox error={error}/>{loading && !data ? <Loading /> : !data?.items.length ? <Empty title="No matching audit entries"/> : <div className="table-scroll"><table><thead><tr><th>WHEN</th><th>ACTION</th><th>ACTOR</th><th>DEPARTMENT</th><th>LEAD</th><th /></tr></thead><tbody>{data.items.map(e => <tr key={e._id}><td>{dateTime(e.at)}</td><td><strong>{pretty(e.action)}</strong></td><td>{e.actorName}<small className="table-sub">{e.actorUsername} / {pretty(e.actorRole)}</small></td><td>{pretty(e.department)}</td><td className="mono">{e.code || "Account / system"}</td><td><Button variant="ghost" onClick={() => setSelected(e)}>View changes</Button></td></tr>)}</tbody></table></div>}<div className="table-pagination"><span>Page {cursors.length} &middot; 100 entries per page</span><div><Button variant="secondary" disabled={cursors.length === 1} onClick={() => setCursors(v => v.slice(0, -1))}>Previous</Button><Button variant="secondary" disabled={!data?.nextCursor} onClick={() => setCursors(v => [...v, data!.nextCursor!])}>Next</Button></div></div></section>{selected && <Modal title={pretty(selected.action)} onClose={() => setSelected(null)}><p className="muted">{selected.actorName} / {dateTime(selected.at)}</p><pre className="audit-json">{JSON.stringify(selected.data, null, 2)}</pre></Modal>}</>;
}
