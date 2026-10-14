"use client";
import Link from "next/link";
import { Plus, ArrowUpRight, Layers, Clock3, CheckCircle2, RotateCcw, ArrowRight, Users, FileUp } from "lucide-react";
import { useApp, useLoad } from "@/components/app-provider";
import { PageTitle, Badge, Empty, ErrorBox, Loading } from "@/components/ui";
import { DEPARTMENTS, DEPARTMENT_NAMES } from "@/lib/domain/types";
import type { LeadView } from "@/lib/domain/types";
import { inDepartment, isManagement, canSeeTeam } from "@/lib/domain/policy";
import { dateTime, pretty } from "@/lib/client";
type Dashboard = {
    counts: {
        department: string;
        status: string;
        count: number;
    }[];
    metrics: {
        active: number;
        review: number;
        rework: number;
        due: number;
    };
    recent: LeadView[];
};
export default function Dashboard() {
    const { user } = useApp(), { data, error, loading } = useLoad<Dashboard>("dashboard", true);
    if (!user)
        return null;
    const hours = new Date().getHours(), greeting = hours < 12 ? "Good morning" : hours < 18 ? "Good afternoon" : "Good evening";
    return <><PageTitle eyebrow="OPERATIONS OVERVIEW" title={`${greeting}, ${user.name.split(" ")[0]}.`} description="A clear view of your queues, your team, and what needs attention." actions={inDepartment(user, "GENERATION") ? <Link className="btn btn-primary" href="/leads/new"><Plus size={17}/>New lead</Link> : null}/><ErrorBox error={error}/>{loading && !data ? <Loading /> : data && <><div className="metric-grid">{[{ label: "Active leads", value: data.metrics.active, icon: Layers, foot: "Across your authorized queues", tone: "teal" }, { label: "Ready for Management", value: data.metrics.review, icon: CheckCircle2, foot: "Awaiting final review", tone: "violet" }, { label: "Rework required", value: data.metrics.rework, icon: RotateCcw, foot: "Returned for a correction", tone: "rose" }, { label: "Follow-ups due", value: data.metrics.due, icon: Clock3, foot: "Due now or overdue", tone: "amber" }].map(m => <section className="metric-card" key={m.label}><div className="metric-card-top"><span>{m.label}</span><i className={`metric-icon ${m.tone}`}><m.icon size={19}/></i></div><strong>{m.value.toLocaleString()}</strong><small>{m.foot}</small></section>)}</div><div className="dashboard-middle"><section className="panel department-panel"><div className="panel-heading"><div><h2>Department queues</h2><p>Live workload, in your department order</p></div><span className="subtle-pill">CURRENT RECORDS</span></div><div className="department-rows">{DEPARTMENTS.map(d => { const total = data.counts.filter(c => c.department === d && !['ARCHIVED', 'FINALIZED'].includes(c.status)).reduce((s, c) => s + c.count, 0), max = Math.max(1, ...DEPARTMENTS.map(x => data.counts.filter(c => c.department === x && !['ARCHIVED', 'FINALIZED'].includes(c.status)).reduce((s, c) => s + c.count, 0))); return <div className="department-row" key={d}><span className={`department-dot dot-${d.toLowerCase()}`}/><div><strong>{DEPARTMENT_NAMES[d]}</strong><div className="bar-track"><span className={`bar-fill bg-${d.toLowerCase()}`} style={{ width: `${total / max * 100}%` }}/></div></div><b>{total.toLocaleString()}</b>{inDepartment(user, d) ? <Link className="icon-btn" href={`/leads?department=${d}`} aria-label={`Open ${DEPARTMENT_NAMES[d]}`}><ArrowUpRight size={17}/></Link> : <span className="muted">Restricted</span>}</div>; })}</div></section><section className="workflow-card"><span className="eyebrow">BUILT AROUND ACCOUNTABILITY</span><h2>The right lead.<br />The next right step.</h2><p>Your main workflow keeps ownership clear at every handoff.</p><div className="workflow-steps">{["Generation", "Q/A", "Chasing", "Patient Verification / Management"].map((s, i) => <div key={s}><span>{String(i + 1).padStart(2, "0")}</span><strong>{s}</strong>{i < 3 && <ArrowRight size={15}/>}</div>)}</div><div className="workflow-pv"><span className="department-dot dot-pv"/><span>Chasing Complete goes to Management; Chasing Denied goes to Patient Verification, then Management.</span></div><Link href="/leads">Explore your leads<ArrowUpRight size={18}/></Link></section></div><section className="panel"><div className="panel-heading"><div><h2>Recently updated</h2><p>The latest activity in records you are authorized to view</p></div><Link className="text-link" href="/leads">View all leads<ArrowRight size={16}/></Link></div>{!data.recent.length ? <Empty title="Your workspace is ready" description="Create your first Generation lead, or import a dataset into Chasing or Patient Verification."/> : <div className="table-scroll"><table><thead><tr><th>LEAD / PATIENT</th><th>DEPARTMENT</th><th>STATUS</th><th>UPDATED</th><th /></tr></thead><tbody>{data.recent.map(l => <tr key={l._id}><td><Link className="table-title" href={`/leads/${l._id}`}>{l.patient.firstName || "Untitled"} {l.patient.lastName}</Link><small className="table-sub">{l.code}</small></td><td><span className={`department-dot dot-${l.department.toLowerCase()}`}/>{DEPARTMENT_NAMES[l.department].replace(" Department", "")}</td><td><Badge value={l.status}/></td><td className="muted">{dateTime(l.updatedAt)}</td><td><Link className="icon-btn" href={`/leads/${l._id}`} aria-label={`Open ${l.code}`}><ArrowUpRight size={17}/></Link></td></tr>)}</tbody></table></div>}</section><div className="quick-links">{canSeeTeam(user) && <Link href="/team"><Users size={19}/><span><strong>Live team status</strong><small>Account access and current presence</small></span><ArrowUpRight size={18}/></Link>}{isManagement(user) && <Link href="/imports"><FileUp size={19}/><span><strong>Bring in a dataset</strong><small>Map, validate, and import CSV or Excel</small></span><ArrowUpRight size={18}/></Link>}</div></>}</>;
}
