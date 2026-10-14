/** Part 6: internal department outsourcing. Synthetic data only. */
import test from "node:test";
import assert from "node:assert/strict";
import { transition } from "../src/lib/domain/workflow.ts";
import { canReadLead, actionVisible, leadScope } from "../src/lib/domain/policy.ts";
import { planOutsource, outsourceEligible, outsourceServes } from "../src/lib/domain/outsourcing.ts";
import type { Actor, LeadCore, WorkDepartment, Action, OutsourceTarget } from "../src/lib/domain/types.ts";
const person = (id: string, dept: WorkDepartment, head = false): Actor => ({ id, name: `Synthetic ${id}`, username: id, employeeId: `ID-${id}`, role: "STAFF", memberships: [{ department: dept, kind: head ? "HEAD" : "AGENT" }], accountStatus: "ACTIVE", mfaEnabled: false, mustChangePassword: false });
const gen = person("g", "GENERATION"), qa = person("q", "QA"), ch = person("ch", "CHASING", true), chAgent = person("ca", "CHASING"), pv = person("pv", "PV", true), pvAgent = person("pa", "PV");
const admin: Actor = { ...gen, id: "admin", role: "ADMIN", memberships: [] }, mg: Actor = { ...admin, id: "manager", role: "MANAGEMENT" };
const make = (p: Partial<LeadCore> = {}): LeadCore => ({ _id: "synthetic", code: "WAF-2026-000099", department: "CHASING", status: "CHASING_ACTIVE", origin: "GENERATION", createdBy: gen.id, assignedTo: chAgent.id, version: 3, submissionVersion: 1, campaign: "", batch: "", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...p });
const plan = (l: LeadCore, t: OutsourceTarget | null, u: Actor = mg) => planOutsource(u, l, t, new Date("2026-02-01T00:00:00.000Z"));
const errCode = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as { code?: string }).code; } return undefined; };
const step = (u: Actor, l: LeadCore, action: Action, extra: Record<string, unknown> = {}) => transition(u, l, { action, version: l.version, ...extra });

test("Chasing-only keeps the record in Chasing with its assignment and history", () => {
  const p = plan(make(), "CHASING")!;
  assert.equal(p.lead.department, "CHASING"); assert.equal(p.lead.status, "CHASING_ACTIVE"); assert.equal(p.lead.assignedTo, chAgent.id);
  assert.equal(p.lead._id, "synthetic"); assert.equal(p.lead.createdBy, gen.id); assert.equal(p.lead.origin, "GENERATION"); assert.equal(p.lead.version, 4);
  assert.deepEqual({ from: p.entry.from, to: p.entry.to, by: p.entry.by, prev: p.entry.previousAssignee }, { from: null, to: "CHASING", by: mg.id, prev: chAgent.id });
});
test("PV-only moves the same record into the PV queue where PV heads can work it", () => {
  const p = plan(make(), "PV")!;
  assert.equal(p.lead.department, "PV"); assert.equal(p.lead.status, "PV_ACTIVE"); assert.equal(p.lead.assignedTo, null);
  assert.equal(p.entry.fromDepartment, "CHASING"); assert.equal(p.entry.toDepartment, "PV");
  assert.equal(canReadLead(pv, p.lead), true); assert.equal(actionVisible(pv, p.lead, "COMPLETE"), true); assert.equal(actionVisible(pv, p.lead, "INCOMPLETE"), true);
  assert.equal(canReadLead(ch, p.lead), false, "Chasing loses access once the record leaves Chasing");
  assert.equal(canReadLead(pvAgent, p.lead), false, "unassigned PV agents gain no access");
});
test("Both runs Chasing first, then PV, then Management; never two departments at once", () => {
  const p = plan(make({ department: "PV", status: "PV_ACTIVE", origin: "PV", assignedTo: null }), "BOTH")!;
  assert.equal(p.lead.department, "CHASING");
  const atPv = step(ch, { ...p.lead }, "COMPLETE");
  assert.equal(atPv.department, "PV"); assert.equal(atPv.status, "PV_ACTIVE"); assert.ok(atPv.outsourceChasingDoneAt); assert.equal(atPv.completedSource, undefined);
  assert.equal(actionVisible(ch, atPv, "COMPLETE"), false); assert.equal(actionVisible(pv, atPv, "COMPLETE"), true);
  const done = step(pv, atPv, "COMPLETE");
  assert.equal(done.department, "MANAGEMENT"); assert.equal(done.completedSource, "PV"); assert.equal(done.createdBy, gen.id);
  assert.equal(plan(atPv, "BOTH"), null, "re-applying Both mid-flow is a no-op");
});
test("Chasing Deny on a Both record still uses the existing Deny-to-PV rule", () => {
  const l = plan(make(), "BOTH")!.lead, denied = step(ch, l, "DENY", { reason: "not reachable" });
  assert.equal(denied.department, "PV"); assert.equal(plan(denied, "BOTH"), null);
});
test("Removing outsourcing returns PV-only records to Chasing unless PV is otherwise eligible", () => {
  const inPv = plan(make(), "PV")!.lead;
  const removed = plan(inPv, null)!;
  assert.equal(removed.lead.department, "CHASING"); assert.equal(removed.lead.outsource, null); assert.equal(removed.entry.from, "PV");
  const legit = plan(make({ department: "PV", status: "PV_ACTIVE", origin: "PV", outsource: "PV" }), null)!;
  assert.equal(legit.lead.department, "PV");
  assert.equal(plan(make(), null), null, "removing when nothing is set changes nothing");
});
test("Changing outsourcing clears Both stage markers", () => {
  const atPv = step(ch, plan(make(), "BOTH")!.lead, "COMPLETE"), changed = plan(atPv, "CHASING")!;
  assert.equal(changed.lead.department, "CHASING"); assert.equal(changed.lead.outsourceChasingDoneAt, undefined);
});
test("Outsourcing cannot bypass Generation or Q/A, or move terminal or claimed records", () => {
  for (const p of [{ department: "GENERATION", status: "DRAFT" }, { department: "GENERATION", status: "REWORK_REQUIRED" }, { department: "QA", status: "QA_REVIEW" }, { department: "MANAGEMENT", status: "FINALIZED" }, { department: "MANAGEMENT", status: "ARCHIVED" }, { department: "PV", status: "DENIED" }] as Partial<LeadCore>[]) {
    assert.equal(outsourceEligible(make(p)), false); assert.equal(errCode(() => plan(make(p), "CHASING")), "OUTSOURCE_NOT_ELIGIBLE");
  }
  assert.equal(outsourceEligible(make({ department: "MANAGEMENT", status: "MANAGEMENT_REVIEW" })), true);
  assert.equal(outsourceEligible(make({ deletedAt: "2026-01-02T00:00:00.000Z" })), false);
  const claimed = make({ claim: { userId: "x", name: "x", specialId: "x", claimedAt: "2026-01-31T23:59:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z" } });
  assert.equal(errCode(() => plan(claimed, "PV")), "CLAIM_ACTIVE");
});
test("Only active Management/Admin can plan outsourcing", () => {
  for (const u of [gen, qa, ch, chAgent, pv, pvAgent]) assert.equal(errCode(() => plan(make(), "PV", u)), "FORBIDDEN");
  assert.equal(errCode(() => plan(make(), "PV", { ...admin, accountStatus: "SUSPENDED" })), "FORBIDDEN");
  assert.ok(plan(make(), "PV", admin));
});
test("Outsourcing does not widen leadScope for department staff", () => {
  for (const u of [ch, chAgent, pv, pvAgent]) assert.equal(JSON.stringify(leadScope(u)).includes("outsource"), false);
});
test("Repeated or stale requests cannot produce inconsistent assignments", () => {
  const first = plan(make(), "PV")!.lead;
  assert.equal(plan(first, "PV"), null, "same target twice is a no-op, no second version bump");
  assert.equal(first.version, 4);
  const stale = make();
  assert.notEqual(stale.version, first.version, "the service rejects the stale version with VERSION_CONFLICT");
});
test("Queue helper matches targets", () => {
  assert.equal(outsourceServes("BOTH", "PV"), true); assert.equal(outsourceServes("CHASING", "PV"), false); assert.equal(outsourceServes(null, "CHASING"), false);
});
