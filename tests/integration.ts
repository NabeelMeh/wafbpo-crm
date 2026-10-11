/** Explicit opt-in suite: needs installed dependencies and an EMPTY isolated MongoDB replica-set database. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { collections, database, client, ensureIndexes, type UserDoc } from "../src/lib/db.ts";
import { hashPassword } from "../src/lib/crypto.ts";
import { handle } from "../src/lib/api.ts";
import { EMPTY_PATIENT, EMPTY_DOCTOR } from "../src/lib/domain/types.ts";
import type { LeadView, Action } from "../src/lib/domain/types.ts";
const name = process.env.MONGODB_DB || "";
assert(process.env.TEST_ALLOW_DB_WRITE === "true", "Set TEST_ALLOW_DB_WRITE=true to run this suite.");
assert(/^wafbpo_[a-zA-Z0-9_]*test$/.test(name), "MONGODB_DB must begin wafbpo_ and end test.");
assert(process.env.NODE_ENV !== "production", "Do not run integration tests in production mode.");
assert(process.env.MONGODB_URI, "Configure a replica-set test database in .env.test.");
process.env.APP_URL = "http://localhost:3000";
process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.SEARCH_HMAC_KEY = randomBytes(32).toString("base64");
process.env.REQUIRE_PRIVILEGED_MFA = "false";
delete process.env.ABLY_API_KEY;
const origin = process.env.APP_URL, secret = `Test-only-${randomBytes(24).toString("hex")}`;
let initialized = false, checks = 0;
async function call(method: string, path: string, payload?: unknown, cookie?: string, key = randomUUID()) {
    const headers: Record<string, string> = { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": key };
    if (cookie)
        headers.Cookie = cookie;
    const response = await handle(new Request(`${origin}/api/${path}`, { method, headers, ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) }));
    const data = await response.json();
    return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
}
async function ok(method: string, path: string, payload?: unknown, cookie?: string, key?: string) {
    const result = await call(method, path, payload, cookie, key);
    assert(result.status < 300, `${method} ${path}: ${JSON.stringify(result.data)}`);
    checks++;
    return result;
}
try {
    const db = await database();
    assert.equal((await db.listCollections({}, { nameOnly: true }).toArray()).length, 0, "Test database is not empty. Refusing to alter it; use a new isolated test database.");
    initialized = true;
    await ensureIndexes();
    const c = await collections(), hash = await hashPassword(secret), now = new Date().toISOString();
    const labels = ["admin", "generationHead", "generationAgent", "qaHead", "qaAgent", "chasingHead", "chasingAgent", "pvHead", "pvAgent"] as const;
    const people = new Map<string, UserDoc>();
    for (const label of labels) {
        const department = label.startsWith("generation") ? "GENERATION" : label.startsWith("qa") ? "QA" : label.startsWith("chasing") ? "CHASING" : "PV";
        const head = label.endsWith("Head"), headLabel = label.replace(/Agent$/, "Head");
        const user: UserDoc = { _id: randomUUID(), name: `Synthetic ${label}`, username: label.toLowerCase(), employeeId: label, role: label === "admin" ? "SUPER_ADMIN" : "STAFF", memberships: label === "admin" ? [] : [{ department, kind: head ? "HEAD" : "AGENT", ...(head ? {} : { headId: people.get(headLabel)!._id }) }], accountStatus: "ACTIVE", passwordHash: hash, sessionVersion: 0, mustChangePassword: false, mfaEnabled: false, createdAt: now, updatedAt: now };
        people.set(label, user);
        await c.users.insertOne(user);
    }
    const cookies = new Map<string, string>();
    for (const label of labels) {
        const result = await ok("POST", "auth/login", { username: people.get(label)!.username, password: secret });
        cookies.set(label, result.cookie);
    }
    const auth = (label: string) => cookies.get(label)!;
    const source = { patient: { ...EMPTY_PATIENT, firstName: "Synthetic", lastName: "Integration Patient", dob: "1980-02-29", address: "100 Test Street", city: "Test City", state: "TX", zip: "00000", phone: "202-555-0100", identifierKind: "SSN", identifier: "999-99-9999", height: "170 cm", weight: "70 kg", brace: "TEST" }, doctor: { ...EMPTY_DOCTOR, name: "Synthetic Doctor", npi: "1234567890", address: "10 Test Street", city: "Test City", state: "TX", zip: "00000", phone: "202-555-0101", fax: "202-555-0102" }, department: "GENERATION" };
    const key = randomUUID();
    let lead = (await ok("POST", "leads", source, auth("generationAgent"), key)).data as LeadView;
    assert.equal((await ok("POST", "leads", source, auth("generationAgent"), key)).data._id, lead._id);
    checks++;
    assert.equal(await c.leads.countDocuments({}), 1);
    checks++;
    const stored = await c.leads.findOne({ _id: lead._id });
    assert(stored && !stored.patientSealed.includes("Synthetic"));
    assert(!("patient" in stored));
    checks++;
    assert(lead.patient.identifier.startsWith("****"));
    checks++;
    assert.equal((await call("GET", `leads/${lead._id}`, undefined, auth("generationHead"))).status, 404);
    checks++;
    assert.equal((await call("POST", "leads", source, auth("generationAgent"))).status, 409);
    checks++;
    assert.equal((await call("POST", "leads", { ...source, department: "MANAGEMENT" }, auth("admin"))).status, 400);
    checks++;
    const action = async (label: string, act: Action, extra: Record<string, unknown> = {}, idem?: string) => { lead = (await ok("POST", `leads/${lead._id}/workflow`, { action: act, version: lead.version, ...extra }, auth(label), idem)).data; };
    await action("generationAgent", "SUBMIT");
    const oldVersion = lead.version, approvalKey = randomUUID();
    await action("generationHead", "APPROVE_GENERATION", {}, approvalKey);
    const replay = await call("POST", `leads/${lead._id}/workflow`, { action: "APPROVE_GENERATION", version: oldVersion }, auth("generationHead"), approvalKey);
    assert.equal(replay.status, 409);
    assert.equal(replay.data.error.code, "ALREADY_APPLIED_ACCESS_CHANGED");
    checks++;
    assert.equal((await call("GET", `leads/${lead._id}`, undefined, auth("generationAgent"))).status, 404);
    checks++;
    await action("qaHead", "ASSIGN", { assigneeId: people.get("qaAgent")!._id });
    await action("qaAgent", "QA_BAD", { reason: "Synthetic review", comment: "Correct synthetic information" });
    assert.equal(lead.assignedTo, people.get("generationAgent")!._id);
    checks++;
    await action("generationAgent", "RESUBMIT");
    await action("qaHead", "ASSIGN", { assigneeId: people.get("qaAgent")!._id });
    await action("qaAgent", "QA_GOOD");
    await action("chasingHead", "ASSIGN", { assigneeId: people.get("chasingAgent")!._id });
    assert.equal((await call("PATCH", `leads/${lead._id}`, { version: lead.version, patient: { brace: "Forbidden change" } }, auth("chasingAgent"))).status, 403);
    checks++;
    assert.equal((await call("POST", `leads/${lead._id}/reveal`, {}, auth("chasingAgent"))).status, 403);
    checks++;
    assert.equal((await call("POST", `leads/${lead._id}/workflow`, { action: "COMPLETE", version: lead.version }, auth("chasingAgent"))).status, 403);
    checks++;
    await ok("POST", `leads/${lead._id}/activities`, { kind: "CALL", data: { number: "202-555-0101", outcome: "Synthetic call", comment: "Integration fixture" } }, auth("chasingAgent"));
    lead = (await ok("GET", `leads/${lead._id}`, undefined, auth("chasingHead"))).data;
    await action("chasingHead", "COMPLETE");
    assert.equal(lead.completedAgentId, people.get("chasingAgent")!._id);
    checks++;
    await action("admin", "FINALIZE");
    await action("admin", "REOPEN", { reason: "Synthetic verification", comment: "Route separately to PV", destination: "PV" });
    await action("pvHead", "ASSIGN", { assigneeId: people.get("pvAgent")!._id });
    await ok("POST", `leads/${lead._id}/activities`, { kind: "VERIFICATION", data: { status: "VERIFIED", result: "Synthetic verification complete" } }, auth("pvAgent"));
    lead = (await ok("GET", `leads/${lead._id}`, undefined, auth("pvHead"))).data;
    await action("pvHead", "COMPLETE");
    assert.equal(lead.completedSource, "PV");
    checks++;
    await action("admin", "FINALIZE");
    await action("admin", "ARCHIVE", { reason: "Synthetic record retained" });
    const history = (await ok("GET", `leads/${lead._id}/history`, undefined, auth("admin"))).data;
    assert(history.items.length >= 15);
    checks++;
    const notes = (await ok("GET", "notifications", undefined, auth("qaHead"))).data;
    assert(notes.items.length > 0);
    const note = notes.items[0];
    const claims = await Promise.all([ok("POST", `notifications/${note._id}/claim`, {}, auth("qaHead")), ok("POST", `notifications/${note._id}/claim`, {}, auth("qaHead"))]);
    assert.equal(claims.filter(x => x.data.claimed).length, 1);
    checks++;
    // User-creation retries must use a stable password fingerprint, not a salted password hash.
    const userKey = randomUUID(), payload = { name: "Synthetic Management", username: "synthetic.management", employeeId: "TEST-MGR", role: "MANAGEMENT", memberships: [], accountStatus: "ACTIVE", password: secret };
    const first = (await ok("POST", "users", payload, auth("admin"), userKey)).data;
    const second = (await ok("POST", "users", payload, auth("admin"), userKey)).data;
    assert.equal(first.id, second.id);
    checks++;
    // Role/status changes revoke previously issued sessions.
    const agent = people.get("generationAgent")!;
    await ok("PATCH", `users/${agent._id}`, { name: agent.name, username: agent.username, employeeId: agent.employeeId, role: agent.role, memberships: agent.memberships, accountStatus: "INACTIVE" }, auth("admin"));
    assert.equal((await call("GET", "dashboard", undefined, auth("generationAgent"))).status, 401);
    checks++;
    console.log(`Integration checks passed: ${checks}. Synthetic test data only.`);
}
catch (error) {
    console.error(error instanceof Error ? error.message : "Integration suite failed.");
    process.exitCode = 1;
}
finally {
    if (globalThis.wafMongoPromise) {
        if (initialized && process.env.TEST_ALLOW_DB_DROP === "true") {
            await (await database()).dropDatabase();
            console.log("Dropped the explicitly isolated integration test database.");
        }
        else if (initialized)
            console.log("Test database retained for inspection. Its encryption keys were ephemeral; never reuse it for real data.");
        await (await client()).close();
    }
}
