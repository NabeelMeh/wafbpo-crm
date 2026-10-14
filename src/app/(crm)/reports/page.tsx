"use client";
import { isManagement } from "@/lib/domain/policy";
import { useState } from "react";
import { Download, BarChart3 } from "lucide-react";
import { useApp, useLoad } from "@/components/app-provider";
import { PageTitle, Button, ErrorBox, Loading, Empty } from "@/components/ui";
import { DEPARTMENT_NAMES } from "@/lib/domain/types";
import { downloadBlob, csvBlob } from "@/lib/client";
type Row = {
    userId: string;
    department: string;
    name: string;
    employeeId: string;
    metrics: Record<string, number>;
};
function startDate(days: number) { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); }
export default function Reports() {
    const app = useApp();
    const [from, setFrom] = useState(startDate(30)), [to, setTo] = useState(startDate(0)), [applied, setApplied] = useState({ from: startDate(30), to: startDate(0) });
    const params = new URLSearchParams({ from: new Date(`${applied.from}T00:00:00`).toISOString(), to: new Date(`${applied.to}T23:59:59.999`).toISOString() });
    const { data, error, loading } = useLoad<{
        items: Row[];
        from: string;
        to: string;
    }>(`reports?${params}`);
    function preset(days: number) { const range = { from: startDate(days), to: startDate(0) }; setFrom(range.from); setTo(range.to); setApplied(range); }
    function exportReport() {
        if (!data)
            return;
        const rows: unknown[][] = [["Agent", "Employee ID", "Department", "Metric", "Count"]];
        for (const r of data.items)
            for (const [metric, count] of Object.entries(r.metrics))
                rows.push([r.name, r.employeeId, r.department, metric, count]);
        downloadBlob(csvBlob(rows), "cloud-nest-bpo-performance-report.csv");
    }
    return <><PageTitle eyebrow="TEAM PERFORMANCE" title="Reports & attribution" description="Event-based counts preserve agent attribution when a Head performs the final completion. Dates use your browser's local time." actions={app.user&&isManagement(app.user)?<Button variant="secondary" disabled={!data} onClick={exportReport}><Download size={16}/>Export report</Button> : null}/><section className="panel"><form className="table-toolbar" onSubmit={e => {
            e.preventDefault();
            if (from && to)
                setApplied({ from, to });
        }}><label>From <input required type="date" value={from} onChange={e => setFrom(e.target.value)}/></label><label>To <input required type="date" value={to} onChange={e => setTo(e.target.value)}/></label><Button type="submit">Apply range</Button><Button type="button" variant="ghost" onClick={() => preset(0)}>Today</Button><Button type="button" variant="ghost" onClick={() => preset(6)}>7 days</Button><Button type="button" variant="ghost" onClick={() => preset(29)}>30 days</Button></form><ErrorBox error={error}/>{loading ? <Loading /> : !data?.items.length ? <Empty title="No performance events in this range" description="Submitted work, reviews, calls and completions will populate this report."/> : <div className="report-grid">{data.items.map(r => <article className="report-card" key={`${r.userId}:${r.department}`}><div><span className="avatar">{r.name.slice(0, 1)}</span><span><h3>{r.name}</h3><small>{r.employeeId} / {DEPARTMENT_NAMES[r.department as keyof typeof DEPARTMENT_NAMES] || r.department}</small></span></div><dl>{Object.entries(r.metrics).map(([metric, count]) => <div key={metric}><dt>{metric}</dt><dd>{count.toLocaleString()}</dd></div>)}</dl></article>)}</div>}</section></>;
}
