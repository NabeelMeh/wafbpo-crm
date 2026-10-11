/** Run outside Vercel, with ClamAV installed and signatures updated. One bounded batch per invocation. */
import { mkdtemp, open, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { inspectFile } from "../src/lib/file-inspection.ts";
import { execFileSync } from "node:child_process";
type Item = {
    name: string;
    token: string;
    fileId: string;
    versionId: string;
    size: number;
    type: string;
    url: string;
};
const base = process.env.SCANNER_APP_URL || process.env.APP_URL, secret = process.env.FILE_SCAN_SECRET;
if (!base || !secret || secret.length < 32)
    throw new Error("Configure SCANNER_APP_URL and FILE_SCAN_SECRET.");
if (new URL(base).protocol !== "https:" && !['localhost', '127.0.0.1'].includes(new URL(base).hostname))
    throw new Error("Use HTTPS for the scanner endpoint.");
const endpoint = new URL("/api/internal/scan", base);
async function api<T>(body?: unknown): Promise<T> {
    const response = await fetch(endpoint, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    if (!response.ok)
        throw new Error(`Scanner endpoint returned HTTP ${response.status}.`);
    return await response.json() as T;
}
function scan(path: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.env.CLAMSCAN_PATH || "clamscan", ["--no-summary", "--alert-macros=yes", "--alert-encrypted=yes", "--max-filesize=110M", "--max-scansize=150M", "--max-recursion=12", "--max-files=2000", path], { stdio: "ignore", windowsHide: true });
        const timer = setTimeout(() => { child.kill(); reject(new Error("ClamAV scan timed out; item remains quarantined.")); }, 120000);
        child.once("error", () => { clearTimeout(timer); reject(new Error("ClamAV could not start; item remains quarantined.")); });
        child.once("exit", code => {
            clearTimeout(timer);
            if (code === 0)
                resolve(true);
            else if (code === 1)
                resolve(false);
            else
                reject(new Error("ClamAV reported an operational error; item remains quarantined."));
        });
    });
}
async function processItem(item: Item): Promise<boolean> {
    if (!item.versionId || !Number.isInteger(item.size) || item.size <= 0 || item.size > 100 * 1024 * 1024)
        throw new Error("Invalid scanner queue metadata.");
    const dir = await mkdtemp(join(tmpdir(), "cloudnest-scan-")), path = join(dir, "upload.bin");
    try {
        const response = await fetch(item.url, { signal: AbortSignal.timeout(180000), redirect: "error" });
        if (!response.ok || !response.body)
            throw new Error("Could not read the immutable file version.");
        const reader = response.body.getReader(), handle = await open(path, "wx", 0o600);
        let size = 0, head = Buffer.alloc(0);
        try {
            while (true) {
                const part = await reader.read();
                if (part.done)
                    break;
                size += part.value.length;
                if (size > item.size) {
                    await reader.cancel();
                    throw new Error("Downloaded object exceeded declared size.");
                }
                if (head.length < 1024)
                    head = Buffer.concat([head, Buffer.from(part.value).subarray(0, 1024 - head.length)]);
                await handle.writeFile(part.value);
            }
        }
        finally {
            await handle.close();
        }
        if (size !== item.size)
            throw new Error("Downloaded object size did not match the immutable metadata.");
        return inspectFile(item.name, item.type, await readFile(path)) && await scan(path);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
}
try {
    const version=execFileSync(process.env.CLAMSCAN_PATH || "clamscan",["--version"],{encoding:"utf8",timeout:10000}).trim();
    const signatureDate=Date.parse(version.split("/").slice(2).join("/"));
    if(!Number.isFinite(signatureDate)||Date.now()-signatureDate>Number(process.env.CLAMAV_MAX_SIGNATURE_AGE_HOURS||48)*3600000)throw new Error("ClamAV signatures are missing or stale. Run freshclam before accepting uploads.");
    const { items } = await api<{
        items: Item[];
    }>();
    let passed = 0, rejected = 0, errors = 0;
    for (const item of items) {
        try {
            const clean = await processItem(item);
            await api({ fileId: item.fileId, versionId: item.versionId, token: item.token, clean });
            if (clean)
                passed++;
            else
                rejected++;
        }
        catch (error) {
            errors++;
            console.error(error instanceof Error ? error.message : "Scan failed; item remains quarantined.");
        }
    }
    console.log(JSON.stringify({ processed: items.length, clean: passed, rejected, retryableErrors: errors }));
    if (errors)
        process.exitCode = 1;
}
catch (error) {
    console.error(error instanceof Error ? error.message : "Scanner failed.");
    process.exitCode = 1;
}
