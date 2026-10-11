"use client";
import ExcelJS from "exceljs";
import { useState } from "react";
import { FileUp, ArrowRight, Download, CheckCircle2, Play, RefreshCw } from "lucide-react";
import { useApp, useLoad } from "@/components/app-provider";
import { PageTitle, Button, Field, ErrorBox, Badge, Empty } from "@/components/ui";
import { isManagement } from "@/lib/domain/policy";
import { EMPTY_PATIENT, EMPTY_DOCTOR } from "@/lib/domain/types";
import type { Patient, Doctor } from "@/lib/domain/types";
import { parsePatient, parseDoctor, validateLead } from "@/lib/domain/validation";
import { request, pretty, dateTime, csvBlob, downloadBlob } from "@/lib/client";
type SourceRow = Record<string, string>;
type Job = {
    _id: string;
    name: string;
    department: "CHASING" | "PV";
    total: number;
    status: string;
    createdAt: string;
    counts: {
        _id: string;
        count: number;
    }[];
};
const targets = [...Object.keys(EMPTY_PATIENT).filter(k => k !== "identifierKind").map(k => `patient.${k}`), ...Object.keys(EMPTY_DOCTOR).map(k => `doctor.${k}`)];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const names: Record<string, string> = { "patient.firstName": "first name", "patient.lastName": "last name", "patient.dob": "dob", "patient.phone": "phone", "patient.identifier": "medicare id", "doctor.name": "doctor name", "doctor.npi": "npi", "doctor.fax": "fax" };
export default function Imports() {
    const app = useApp(), [name, setName] = useState(""), [department, setDepartment] = useState<"CHASING" | "PV">("CHASING"), [identifierKind, setIdentifierKind] = useState<"MEDICARE" | "SSN">("MEDICARE"), [rows, setRows] = useState<SourceRow[]>([]), [headers, setHeaders] = useState<string[]>([]), [mapping, setMapping] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [error, setError] = useState<unknown>(null), [issues, setIssues] = useState<string[]>([]), [validated, setValidated] = useState(false), [progress, setProgress] = useState(0), [resume, setResume] = useState<Job | null>(null), [resultId, setResultId] = useState<string | null>(null);
    const { data: jobs, error: jobsError, refetch } = useLoad<{
        items: Job[];
    }>(app.user && isManagement(app.user) ? "imports" : null);
    if (!app.user)
        return null;
    if (!isManagement(app.user))
        return <ErrorBox error="Only Management may upload and route datasets."/>;
    async function readFile(file: File | undefined) {
        if (!file)
            return;
        setError(null);
        setRows([]);
        setValidated(false);
        setResultId(null);
        setReading(true);
        setIssues([]);
        try {
            if (file.size > 5 * 1024 * 1024)
                throw new Error("Interactive imports are limited to 5 MB and 5,000 rows. Split larger files before importing.");
            let data: SourceRow[] = [];
            if (file.name.toLowerCase().endsWith(".csv")) {
                const Papa = await import("papaparse");
                const parsed = Papa.default.parse<SourceRow>(await file.text(), { header: true, skipEmptyLines: "greedy", transformHeader: h => h.trim() });
                if (parsed.errors.length)
                    throw new Error(`CSV parse error: ${parsed.errors[0].message}`);
                data = parsed.data;
            }
            else if (file.name.toLowerCase().endsWith(".xlsx")) {
                const book = new ExcelJS.Workbook();
                await book.xlsx.load(await file.arrayBuffer());
                const sheet = book.worksheets[0];
                if (!sheet)
                    throw new Error("The workbook has no worksheet.");
                if (sheet.rowCount > 5001 || sheet.columnCount > 100)
                    throw new Error("The first worksheet exceeds 5,000 rows or 100 columns.");
                const columns: string[] = [];
                sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => { columns[column - 1] = cell.text.trim() || `Column ${column}`; });
                sheet.eachRow((row, index) => {
                    if (index === 1)
                        return;
                    const item: SourceRow = {};
                    for (let c = 1; c <= columns.length; c++) {
                        const cell = row.getCell(c);
                        item[columns[c - 1]] = cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : cell.text.trim();
                    }
                    if (Object.values(item).some(Boolean))
                        data.push(item);
                });
            }
            else
                throw new Error("Choose a CSV or XLSX file.");
            if (!data.length || data.length > 5000)
                throw new Error("Choose a file containing 1-5,000 non-empty data rows.");
            const cols = Object.keys(data[0]);
            if (cols.length > 100 || new Set(cols).size !== cols.length)
                throw new Error("Headers must be unique, with at most 100 columns.");
            setRows(data);
            setHeaders(cols);
            setName(resume?.name || file.name.replace(/\.[^.]+$/, ""));
            const auto: Record<string, string> = {};
            for (const t of targets) {
                const targetName = names[t] || t.replace(".", " ");
                const match = cols.find(c => norm(c) === norm(targetName) || norm(c) === norm(t));
                if (match)
                    auto[t] = match;
            }
            setMapping(auto);
            setProgress(0);
        }
        catch (e) {
            setError(e);
        }
        finally {
            setReading(false);
        }
    }
    function mapped(row: SourceRow) {
        const patient = { ...EMPTY_PATIENT, identifierKind }, doctor = { ...EMPTY_DOCTOR };
        for (const [target, column] of Object.entries(mapping)) {
            if (!column)
                continue;
            const [part, key] = target.split(".");
            if (part === "patient")
                (patient as unknown as Record<string, string>)[key] = row[column] || "";
            else
                (doctor as unknown as Record<string, string>)[key] = row[column] || "";
        }
        return { patient, doctor };
    }
    function validate() {
        setError(null);
        const errors: string[] = [];
        for (let i = 0; i < rows.length; i++)
            try {
                const r = mapped(rows[i]);
                const p = parsePatient(r.patient), d = parseDoctor(r.doctor);
                validateLead(p, d, false);
                if (!p.firstName || !p.lastName || !p.phone)
                    throw new Error("First name, last name and phone are required.");
            }
            catch (e) {
                errors.push(`Data row ${i + 1}: ${(e as Error).message}`);
            }
        setIssues(errors);
        setValidated(true);
    }
    async function run() {
        setBusy(true);
        setError(null);
        setProgress(0);
        try {
            if (resume && (resume.total !== rows.length || resume.department !== department))
                throw new Error("Resume requires the same source-row count and destination department as the original job.");
            const job = resume || await request<Job>("imports", { body: { name, total: rows.length, department }, activity: true });
            setResultId(job._id);
            for (let start = 0; start < rows.length; start += 25) {
                const chunk = rows.slice(start, start + 25).map((r, i) => ({ row: start + i + 1, data: mapped(r) }));
                await request(`imports/${job._id}/rows`, { body: { rows: chunk }, activity: true });
                setProgress(Math.min(start + 25, rows.length));
            }
            await request(`imports/${job._id}/finish`, { body: {}, activity: true });
            setResume(null);
            refetch();
            app.refresh();
            app.toast("Import complete", "The destination heads receive one grouped incoming-lead notification.");
        }
        catch (e) {
            setError(e);
            refetch();
        }
        finally {
            setBusy(false);
        }
    }
    async function errorsFor(id: string) {
        try {
            const result = await request<{
                items: {
                    row: number;
                    status: string;
                    error?: string;
                }[];
            }>(`imports/${id}/errors`, { activity: true });
            downloadBlob(csvBlob([["Data row", "Status", "Error"], ...result.items.map(r => [r.row, r.status, r.error || ""])]), "cloud-nest-bpo-import-errors.csv");
        }
        catch (e) {
            setError(e);
        }
    }
    async function finish(job: Job) {
        setError(null);
        try {
            await request(`imports/${job._id}/finish`, { body: {}, activity: true });
            refetch();
            app.toast("Import finalized");
        }
        catch (e) {
            setError(e);
        }
    }
    return <><PageTitle eyebrow="MANAGEMENT DATA OPERATIONS" title="Import datasets" description="Upload locally, map columns, preview, validate, then import into Chasing or Patient Verification."/><ErrorBox error={error || jobsError}/><section className="panel import-panel"><div className="import-steps">{["Select file", "Map columns", "Preview", "Validate", "Import", "Report"].map((label, i) => <span key={label} className={i === 0 || rows.length && i < 3 || validated && i < 4 || progress > 0 && i < 5 || resultId && progress === rows.length && i === 5 ? "step-active" : ""}><b>{i + 1}</b>{label}{i < 5 && <ArrowRight size={13}/>}</span>)}</div>{resume && <div className="notice">Resuming {resume.name}. Select the original source file and the same mappings. Previously processed rows are verified, not imported twice. <button onClick={() => setResume(null)}>Cancel resume</button></div>}<div className="upload-drop"><FileUp size={34}/><h3>Bring your data into the workspace</h3><p>CSV or XLSX, up to 5 MB and 5,000 rows. Excel uses the first worksheet.</p><input disabled={busy} aria-label="Select dataset file" type="file" accept=".csv,.xlsx" onChange={e => void readFile(e.target.files?.[0])}/>{reading && <p>Reading source file...</p>}</div>{rows.length > 0 && <><div className="form-grid"><Field label="Dataset / batch name" required><input required maxLength={100} value={name} disabled={busy || !!resume} onChange={e => setName(e.target.value)}/></Field><Field label="Destination department"><select disabled={busy || !!resume} value={department} onChange={e => setDepartment(e.target.value as "CHASING" | "PV")}><option value="CHASING">Chasing Department</option></select></Field><Field label="Identifier type for this file"><select disabled={busy} value={identifierKind} onChange={e => { setIdentifierKind(e.target.value as "MEDICARE" | "SSN"); setValidated(false); }}><option value="MEDICARE">Medicare ID</option><option value="SSN">Social Security Number</option></select></Field></div><h3 className="form-subheading">Map source columns</h3><p className="muted">First name, last name and phone are required for datasets. Missing optional fields remain blank; no data is invented.</p><div className="mapping-grid">{targets.map(target => <Field key={target} label={pretty(target.replace(".", " / ").replace(/([A-Z])/g, " $1"))} required={["patient.firstName", "patient.lastName", "patient.phone"].includes(target)}><select disabled={busy} value={mapping[target] || ""} onChange={e => { setMapping(v => ({ ...v, [target]: e.target.value })); setValidated(false); }}><option value="">Do not import</option>{headers.map(h => <option key={h} value={h}>{h}</option>)}</select></Field>)}</div><h3 className="form-subheading">Preview: first five mapped rows</h3><div className="table-scroll"><table><thead><tr><th>DATA ROW</th><th>FIRST NAME</th><th>LAST NAME</th><th>PHONE</th><th>DOCTOR</th><th>NPI</th></tr></thead><tbody>{rows.slice(0, 5).map((row, i) => { const r = mapped(row); return <tr key={i}><td>{i + 1}</td><td>{r.patient.firstName || "Missing"}</td><td>{r.patient.lastName || "Missing"}</td><td>{r.patient.phone || "Missing"}</td><td>{r.doctor.name || "-"}</td><td>{r.doctor.npi || "-"}</td></tr>; })}</tbody></table></div>{validated && <div className={issues.length ? "notice" : "success-box"}>{rows.length} rows checked. {rows.length - issues.length} pass local field validation; {issues.length} have issues. Duplicates are checked against MongoDB during import. Invalid or duplicate rows are reported, not silently discarded.{issues.length > 0 && <details><summary>Show first 20 issues</summary>{issues.slice(0, 20).map(x => <div key={x}>{x}</div>)}</details>}</div>}{(busy || progress > 0) && <div className="import-progress"><progress value={progress} max={rows.length}/><span>{progress.toLocaleString()} / {rows.length.toLocaleString()} rows processed</span></div>}<div className="form-actions"><Button variant="secondary" disabled={busy} onClick={validate}><CheckCircle2 size={16}/>Validate rows</Button><Button disabled={!validated || busy || !name.trim()} busy={busy} onClick={() => void run()}><Play size={16}/>{resume ? "Resume import" : "Import with report"}</Button>{resultId && !busy && <Button variant="secondary" onClick={() => void errorsFor(resultId)}><Download size={16}/>Error report</Button>}</div></>}</section><section className="panel"><div className="panel-heading"><div><h2>Recent imports</h2><p>Open imports can be resumed using their original source file.</p></div><button className="icon-btn" aria-label="Refresh imports" onClick={refetch}><RefreshCw size={17}/></button></div>{!jobs?.items.length ? <Empty title="No datasets imported yet"/> : <div className="table-scroll"><table><thead><tr><th>DATASET</th><th>DESTINATION</th><th>RESULT</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{jobs.items.map(job => <tr key={job._id}><td><strong>{job.name}</strong><small className="table-sub">{dateTime(job.createdAt)}</small></td><td>{job.department === "PV" ? "Patient Verification" : "Chasing"}</td><td><span>Total: {job.total}</span>{job.counts.map(c => <small className="table-sub" key={c._id}>{pretty(c._id)}: {c.count}</small>)}</td><td><Badge value={job.status}/></td><td><div className="row-actions"><Button variant="ghost" onClick={() => void errorsFor(job._id)}>Errors</Button>{job.status === "OPEN" && <><Button variant="ghost" disabled={busy} onClick={() => { setResume(job); setName(job.name); setDepartment(job.department); setRows([]); setValidated(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Resume</Button><Button variant="ghost" onClick={() => void finish(job)}>Finalize</Button></>}</div></td></tr>)}</tbody></table></div>}</section></>;
}
