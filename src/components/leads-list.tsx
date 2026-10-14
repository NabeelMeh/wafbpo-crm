"use client";
import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Plus, Search, Download, RefreshCw, ArrowUpRight, ChevronRight, ChevronLeft, Trash2 } from "lucide-react";
import { BulkDeleteDialog } from "./confirm-delete-dialogs";
import { OUTSOURCE_TARGETS, OUTSOURCE_LABELS } from "@/lib/domain/types";
import { request } from "@/lib/client";
import { useApp, useLoad } from "./app-provider";
import { PageTitle, Button, Badge, Empty, ErrorBox, Loading } from "./ui";
import { WorkflowDialog } from "./workflow-dialog";
import { ACTIONS, ACTION_LABELS, DEPARTMENT_NAMES, STATUSES } from "@/lib/domain/types";
import type { Action, Department, LeadView } from "@/lib/domain/types";
import { actionVisible, inDepartment, isHead, isManagement } from "@/lib/domain/policy";
import { dateTime, pretty, downloadBlob } from "@/lib/client";
export function LeadsList() {
    const params = useSearchParams(), department = params.get("department") as Department | null, app = useApp(), [search, setSearch] = useState(params.get("q") || ""), [q, setQ] = useState(params.get("q") || ""), [searchMode,setSearchMode]=useState("all"), [exportCursor,setExportCursor]=useState<string|null>(null), [lastFormat,setLastFormat]=useState<"csv"|"xlsx">("csv"), [status, setStatus] = useState(""), [sort, setSort] = useState("createdAt"), [mine, setMine] = useState(false), [cursors, setCursors] = useState<(string | null)[]>([null]), [selected, setSelected] = useState<string[]>([]), [action, setAction] = useState<Action | null>(null), [exporting, setExporting] = useState(false), [exportError, setExportError] = useState<unknown>(null), [queue, setQueue] = useState("");
    useEffect(() => { setCursors([null]); setSelected([]); setSearch(params.get("q") || ""); setQ(params.get("q") || ""); setStatus(""); setQueue(""); }, [department, params.get("q")]);
    useEffect(() => { setCursors([null]); setSelected([]); setExportCursor(null); }, [department, q, status, sort, mine, searchMode, queue]);
    const queueTabs: [string, string][] = department === "CHASING" ? [["", "All"], ["direct", "Assigned by Management"], ["handoff", "Received from Q/A"], ["incomplete", "Incomplete"]]
        : department === "PV" ? [["", "All"], ["direct", "Assigned by Management"], ["handoff", "Denied by Chasing"], ["incomplete", "Incomplete"]]
        : department === "MANAGEMENT" ? [["", "All"], ["complete", "Complete leads"]] : [];
    const query = new URLSearchParams({ limit: "50", sort, order: "desc" });
    query.set("searchMode",searchMode);
    if (department)
        query.set("department", department);
    if (q)
        query.set("q", q);
    if (status)
        query.set("status", status);
    if (queue)
        query.set("queue", queue);
    if (mine && app.user)
        query.set("assignedTo", app.user.id);
    if (cursors.at(-1))
        query.set("cursor", cursors.at(-1)!);
    const { data, error, loading, refetch } = useLoad<{
        items: LeadView[];
        nextCursor: string | null;
    }>(`leads?${query.toString()}`, true);
    const selectedLeads = data?.items.filter(l => selected.includes(l._id)) || [];
    const permitted = app.user && selectedLeads.length ? ACTIONS.filter(a => selectedLeads.every(l => actionVisible(app.user!, l, a))) : [];
    async function exportFile(format: "csv" | "xlsx", continuation=false, selectedOnly=false) {
        if (selectedOnly && !selected.length) { setExportError(new Error("Select at least one record to export.")); return; }
        setExporting(true);
        setExportError(null);
        try {
            const p = new URLSearchParams(query);
            p.delete("cursor");if(continuation&&exportCursor)p.set("cursor",exportCursor);setLastFormat(format);
            if (selectedOnly) p.set("ids", selected.join(","));
            p.set("format", format);
            p.set("limit", "1000");
            const response = await fetch(`/api/leads/export?${p}`, { headers: { "X-User-Activity": "1" } });
            if (!response.ok) {
                const e = await response.json();
                throw new Error(e.error?.message || "Export failed");
            }
            setExportCursor(response.headers.get("X-Next-Cursor"));
            downloadBlob(await response.blob(), `cloud-nest-bpo-leads.${format}`);
            app.toast("Export ready", `${response.headers.get("X-Exported-Rows")} authorized records exported.${response.headers.get("X-Next-Cursor") ? " More records remain. Use Download next export part below." : ""}`);
        }
        catch (e) {
            setExportError(e);
        }
        finally {
            setExporting(false);
        }
    }
    const [confirmDelete, setConfirmDelete] = useState(false), [outsourcing, setOutsourcing] = useState(false);
    async function outsource(target: string) {
        if (!target || !selectedLeads.length) return;
        setOutsourcing(true);
        setExportError(null);
        try {
            await request("leads/outsource", { method: "POST", body: { target, items: selectedLeads.map(l => ({ id: l._id, version: l.version })) }, activity: true });
            app.toast("Outsourcing updated", `${selectedLeads.length} record${selectedLeads.length === 1 ? "" : "s"} updated.`);
            setSelected([]);
            refetch();
        }
        catch (e) { setExportError(e); }
        finally { setOutsourcing(false); }
    }
    const canBulk = app.user && (isManagement(app.user) || isHead(app.user));
    return <><PageTitle eyebrow="LEAD OPERATIONS" title={department ? DEPARTMENT_NAMES[department] || "Leads" : "All authorized leads"} description="Search and work from database-backed queues. Records leave your active queue when they move to the next department." actions={app.user && inDepartment(app.user, "GENERATION") ? <Link className="btn btn-primary" href="/leads/new"><Plus size={17}/>New lead</Link> : null}/>{queueTabs.length > 0 && <div className="queue-tabs" role="tablist" aria-label="Queue">{queueTabs.map(([value, label]) => <button key={value || "all"} type="button" role="tab" aria-selected={queue === value} className={`queue-tab ${queue === value ? "active" : ""}`} onClick={() => setQueue(value)}>{label}</button>)}</div>}<section className="panel"><div className="table-toolbar"><form className="filter-search" onSubmit={e => { e.preventDefault(); setQ(search.trim()); }}><Search size={17}/><input aria-label="Search this queue" value={search} onChange={e => setSearch(e.target.value)} placeholder="Lead ID, patient, identifier, username or special ID"/><button type="submit">Search</button></form>{app.user&&(isManagement(app.user)||isHead(app.user))&&<select aria-label="Search field" value={searchMode} onChange={e=>setSearchMode(e.target.value)}><option value="all">All permitted fields</option><option value="medicare">Exact Medicare / SSN</option><option value="member">Exact Member ID</option><option value="username">Username</option><option value="specialId">Special ID</option></select>}<select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}><option value="">All active statuses</option>{STATUSES.map(s => <option key={s} value={s}>{pretty(s)}</option>)}</select><select aria-label="Sort records" value={sort} onChange={e => setSort(e.target.value)}><option value="createdAt">Newest created</option><option value="updatedAt">Recently updated</option><option value="code">Lead ID</option></select><label className="checkbox-label"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)}/>My assignments</label><button className="icon-btn" aria-label="Refresh queue" onClick={refetch}><RefreshCw size={17}/></button></div><div className="table-meta"><span>{loading ? "Refreshing..." : `${data?.items.length || 0} records on this page`}<span className="meta-separator">/</span>Indexed prefix search<span className="meta-separator">/</span>Identifiers masked</span>{app.user&&isManagement(app.user)&&<div><Button variant="ghost" onClick={() => void exportFile("csv", false, true)} disabled={exporting || !selected.length}><Download size={15}/>Selected CSV</Button><Button variant="ghost" onClick={() => void exportFile("xlsx", false, true)} disabled={exporting || !selected.length}>Selected Excel</Button><Button variant="ghost" onClick={() => void exportFile("csv")} busy={exporting}><Download size={15}/>All CSV</Button><Button variant="ghost" onClick={() => void exportFile("xlsx")} disabled={exporting}>All Excel</Button>{exportCursor&&<Button variant="secondary" busy={exporting} onClick={()=>void exportFile(lastFormat,true)}>Download next export part</Button>}</div>}</div><ErrorBox error={error || exportError}/>{selectedLeads.length > 0 && <div className="bulk-toolbar"><strong>{selectedLeads.length} selected</strong>{app.user && isManagement(app.user) && <><select aria-label="Outsource selected records" value="" disabled={outsourcing} onChange={e => void outsource(e.target.value)}><option value="">Outsource to...</option>{OUTSOURCE_TARGETS.map(t => <option key={t} value={t}>{OUTSOURCE_LABELS[t]}</option>)}<option value="NONE">Remove outsourcing</option></select><Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}><Trash2 size={15}/>Delete selected</Button></>}<select aria-label="Apply action to selected records" value="" onChange={e => setAction(e.target.value as Action)}><option value="">Choose a bulk action</option>{permitted.map(a => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}</select><button onClick={() => setSelected([])}>Clear selection</button></div>}{loading && !data ? <Loading /> : !data?.items.length ? <Empty title="No leads in this view" description="Change the search or filters, create a Generation lead, or wait for a head to assign work."/> : <div className="table-scroll"><table className="lead-table"><thead><tr>{canBulk && <th className="check-cell"><input type="checkbox" aria-label="Select all records on this page" checked={!!data.items.length && data.items.every(l => selected.includes(l._id))} onChange={e => setSelected(e.target.checked ? data.items.map(l => l._id) : [])}/></th>}<th>LEAD / PATIENT</th><th>PHONE</th><th>DOCTOR / NPI</th><th>DEPARTMENT</th><th>STATUS</th><th>UPDATED</th><th /></tr></thead><tbody>{data.items.map(l => <tr key={l._id} className={selected.includes(l._id) ? "row-selected" : ""}>{canBulk && <td><input type="checkbox" aria-label={`Select ${l.code}`} checked={selected.includes(l._id)} onChange={e => setSelected(v => e.target.checked ? [...v, l._id] : v.filter(id => id !== l._id))}/></td>}<td><Link className="table-title" href={`/leads/${l._id}`}>{l.patient.firstName || "Untitled draft"} {l.patient.lastName}</Link><small className="table-sub mono">{l.code}</small>{l.outsource && <small className="table-sub">{`Outsourced: ${OUTSOURCE_LABELS[l.outsource]}`}</small>}</td><td>{l.patient.phone || "-"}</td><td><span className="cell-ellipsis">{l.doctor.name || "Not entered"}</span><small className="table-sub">{l.doctor.npi || "NPI pending"}</small></td><td><span className={`department-dot dot-${l.department.toLowerCase()}`}/>{DEPARTMENT_NAMES[l.department].replace(" Department", "")}</td><td><Badge value={l.status}/>{l.claim&&Date.parse(l.claim.expiresAt)>Date.now()&&<small className="table-sub">In progress: {l.claim.name}</small>}{l.submissionVersion > 1 && <small className="table-sub resubmitted">Resubmission #{l.submissionVersion - 1}</small>}</td><td className="muted nowrap">{dateTime(l.updatedAt)}</td><td><Link className="icon-btn" href={`/leads/${l._id}`} aria-label={`Open ${l.code}`}><ArrowUpRight size={17}/></Link></td></tr>)}</tbody></table></div>}<div className="table-pagination"><span>Page {cursors.length} &middot; 50 records per page &middot; Exports capped at 1,000 rows per request</span><div><Button variant="secondary" disabled={cursors.length <= 1} onClick={() => { setCursors(v => v.slice(0, -1)); setSelected([]); }}><ChevronLeft size={16}/>Previous</Button><Button variant="secondary" disabled={!data?.nextCursor} onClick={() => { setCursors(v => [...v, data!.nextCursor]); setSelected([]); }}>Next<ChevronRight size={16}/></Button></div></div></section>{action && selectedLeads.length > 0 && <WorkflowDialog leads={selectedLeads} action={action} onClose={() => setAction(null)} onDone={() => { setSelected([]); refetch(); }}/>}{confirmDelete && selectedLeads.length > 0 && <BulkDeleteDialog leads={selectedLeads} onClose={() => setConfirmDelete(false)} onDone={() => { setSelected([]); refetch(); }}/>}</>;
}
