import { randomUUID } from "node:crypto";
import { AppError, assert } from "./domain/errors.ts";
export async function body(req: Request, maxBytes = 1024 * 1024): Promise<unknown> {
    assert(req.headers.get("content-type")?.includes("application/json"), 415, "CONTENT_TYPE", "Send application/json.");
    const reader = req.body?.getReader();
    assert(reader, 400, "EMPTY_BODY", "A JSON body is required.");
    let size = 0;
    const parts: Uint8Array[] = [];
    try {
        while (true) {
            const r = await reader.read();
            if (r.done)
                break;
            size += r.value.length;
            if (size > maxBytes) {
                await reader.cancel();
                throw new AppError(413, "BODY_TOO_LARGE", "Request exceeds the allowed size.");
            }
            parts.push(r.value);
        }
        return JSON.parse(Buffer.concat(parts).toString("utf8"));
    }
    catch (e) {
        if (e instanceof AppError)
            throw e;
        throw new AppError(400, "INVALID_JSON", "The JSON body is invalid.");
    }
}
export function csrf(req: Request) {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method))
        return;
    const configured = process.env.APP_URL;
    assert(configured, 503, "CONFIGURATION_REQUIRED", "APP_URL must be configured.");
    const origin = req.headers.get("origin");
    assert(origin === new URL(configured).origin, 403, "CSRF", "Request origin is not authorized.");
    const fetchSite = req.headers.get("sec-fetch-site");
    assert(!fetchSite || ["same-origin", "none"].includes(fetchSite), 403, "CSRF", "Cross-site requests are not authorized.");
}
export const json = (data: unknown, status = 200, headers?: HeadersInit) => Response.json(data, { status, headers: { "Cache-Control": "no-store, private", ...headers } });
export function failure(error: unknown): Response {
    if (error instanceof AppError)
        return json({ error: { code: error.code, message: error.message, details: error.details } }, error.status);
    const errorId = randomUUID();
    // Never log submitted payloads, tokens, database URIs, or decrypted patient data.
    console.error(JSON.stringify({ level: "error", errorId, type: error instanceof Error ? error.name : "UnknownError" }));
    return json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed. Check server configuration or contact your administrator.", errorId } }, 500);
}
export function pageLimit(url: URL, max = 100): number { return Math.min(max, Math.max(1, Math.floor(Number(url.searchParams.get("limit"))) || 50)); }
export function encodeCursor(value: unknown) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
export function decodeCursor(value: string | null): Record<string, string> | null {
    if (!value)
        return null;
    assert(value.length < 1000, 400, "INVALID_CURSOR", "Invalid cursor.");
    try {
        const d = JSON.parse(Buffer.from(value, "base64url").toString());
        assert(d && typeof d === "object" && !Array.isArray(d) && Object.values(d).every(x => typeof x === "string"), 400, "INVALID_CURSOR", "Invalid cursor.");
        return d;
    }
    catch {
        throw new AppError(400, "INVALID_CURSOR", "Invalid cursor.");
    }
}
