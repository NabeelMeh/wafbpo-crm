import ExcelJS from "exceljs";
import type { Actor, LeadView } from "./domain/types.ts";
import { listLeads } from "./leads.ts";
import { csvSafe } from "./search.ts";
import { audit } from "./audit.ts";
const columns = ["Lead ID", "Department", "Status", "First name", "Last name", "DOB", "Phone", "Medicare/SSN (masked)", "Insurance", "Member ID (masked)", "Doctor", "NPI", "Doctor phone", "Fax", "Campaign", "Batch", "Created"];
function cells(l: LeadView) { return [l.code, l.department, l.status, l.patient.firstName, l.patient.lastName, l.patient.dob, l.patient.phone, l.patient.identifier, l.patient.insuranceName, l.patient.memberId, l.doctor.name, l.doctor.npi, l.doctor.phone, l.doctor.fax, l.campaign, l.batch, l.createdAt].map(csvSafe); }
export async function exportLeads(u: Actor, url: URL) {
    url.searchParams.set("limit", String(Math.min(Number(url.searchParams.get("limit")) || 1000, 1000)));
    const data = await listLeads(u, url, 1000), format = url.searchParams.get("format");
    await audit(u, "LEADS_EXPORTED", { count: data.items.length, format: format === "xlsx" ? "xlsx" : "csv", identifiers: "masked" });
    const headers: Record<string, string> = { "Cache-Control": "no-store, private", "X-Exported-Rows": String(data.items.length), ...(data.nextCursor ? { "X-Next-Cursor": data.nextCursor } : {}) };
    if (format === "xlsx") {
        const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Authorized leads");
        sheet.addRow(columns);
        for (const lead of data.items)
            sheet.addRow(cells(lead));
        sheet.getRow(1).font = { bold: true };
        sheet.views = [{ state: "frozen", ySplit: 1 }];
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
        sheet.columns.forEach(c => { c.width = 22; });
        const bytes = await book.xlsx.writeBuffer();
        return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=\"wafbpo-leads.xlsx\"" } });
    }
    const csv = [columns, ...data.items.map(cells)].map(row => row.map(v => '"' + v.replaceAll('"', '""') + '"').join(",")).join("\r\n");
    return new Response("\uFEFF" + csv, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=\"wafbpo-leads.csv\"" } });
}
