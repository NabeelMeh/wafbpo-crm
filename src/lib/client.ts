"use client";
export class ApiError extends Error {
    status: number;
    code: string;
    details?: unknown;
    constructor(message: string, status: number, code: string, details?: unknown) { super(message); this.status = status; this.code = code; this.details = details; }
}
export async function request<T>(path: string, options: {
    method?: string;
    body?: unknown;
    activity?: boolean;
    key?: string;
    signal?: AbortSignal;
} = {}): Promise<T> {
    const method = options.method || (options.body !== undefined ? "POST" : "GET");
    const response = await fetch(`/api/${path}`, { method, credentials: "same-origin", cache: "no-store", signal: options.signal, headers: { ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(options.activity ? { "X-User-Activity": "1" } : {}), ...(["POST", "PATCH", "DELETE"].includes(method) ? { "Idempotency-Key": options.key || crypto.randomUUID() } : {}) }, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
    const data = await response.json().catch(() => ({ error: { message: "The server returned an invalid response." } }));
    if (!response.ok)
        throw new ApiError(data.error?.message || "Request failed.", response.status, data.error?.code || "REQUEST_FAILED", data.error?.details);
    return data as T;
}
export const pretty = (value: string) => value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
export const dateTime = (value?: string) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
export function downloadBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function csvBlob(rows: unknown[][]) {
    return new Blob(["\uFEFF" + rows.map(r => r.map(v => {
            let s = String(v ?? "");
            if (/^[\s]*[=+@\-\t\r]/.test(s))
                s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
        }).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
}
