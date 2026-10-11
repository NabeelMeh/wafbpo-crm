import type { Actor, LeadCore, WorkflowInput, LeadStatus, Department } from "./types.ts";
import { actionVisible, assertRead } from "./policy.ts";
import { assert } from "./errors.ts";
export function transition(actor: Actor, lead: LeadCore, input: WorkflowInput, now = new Date()): LeadCore {
    assertRead(actor, lead);
    assert(input.version === lead.version, 409, "VERSION_CONFLICT", "This record changed. Refresh before applying your action.");
    assert(actionVisible(actor, lead, input.action), 403, "FORBIDDEN_TRANSITION", "This action is not permitted for your role or the record's current state.");
    const reasonNeeded = ["QA_BAD", "RETURN_GENERATION", "DENY", "INCOMPLETE", "REOPEN", "ARCHIVE", "ROUTE_PV"].includes(input.action);
    if (reasonNeeded)
        assert(input.reason && input.reason.trim().length >= 3, 400, "REASON_REQUIRED", "Enter a reason of at least three characters.");
    if (["QA_BAD", "REOPEN"].includes(input.action))
        assert(input.comment?.trim(), 400, "COMMENT_REQUIRED", "A comment is required.");
    if (input.action === "INCOMPLETE")
        assert(input.followUpAt && Number.isFinite(Date.parse(input.followUpAt)) && Date.parse(input.followUpAt) > now.getTime(), 400, "FOLLOW_UP_REQUIRED", "Choose a future follow-up date and time.");
    const out: LeadCore = { ...lead, version: lead.version + 1, updatedAt: now.toISOString() };
    const move = (department: Department, status: LeadStatus, assignee: string | null = null) => {
        out.department = department;
        out.status = status;
        out.assignedTo = assignee;
        out.followUpAt = null;
    };
    switch (input.action) {
        case "SUBMIT":
            move("GENERATION", "GENERATION_REVIEW", lead.createdBy);
            out.submissionVersion = 1;
            break;
        case "APPROVE_GENERATION":
            move("QA", "QA_REVIEW");
            break;
        case "RETURN_GENERATION":
            move("GENERATION", "REWORK_REQUIRED", lead.createdBy);
            out.reworkFrom = "GENERATION";
            break;
        case "QA_BAD":
            move("GENERATION", "REWORK_REQUIRED", lead.createdBy);
            out.reworkFrom = "QA";
            break;
        case "QA_GOOD":
            move("CHASING", "CHASING_ACTIVE");
            break;
        case "RESUBMIT":
            out.submissionVersion++;
            if (lead.reworkFrom === "QA")
                move("QA", "QA_REVIEW");
            else
                move("GENERATION", "GENERATION_REVIEW", lead.createdBy);
            break;
        case "ASSIGN":
            assert(input.assigneeId, 400, "ASSIGNEE_REQUIRED", "Select an active agent.");
            out.assignedTo = input.assigneeId;
            break;
        case "PULL_BACK":
            out.assignedTo = null;
            break;
        case "DENY":
            out.status = "DENIED";
            break;
        case "INCOMPLETE":
            out.status = "INCOMPLETE";
            out.followUpAt = new Date(input.followUpAt!).toISOString();
            break;
        case "COMPLETE":
            out.completedSource = lead.department as "CHASING" | "PV";
            out.completedAgentId = lead.assignedTo;
            move("MANAGEMENT", "MANAGEMENT_REVIEW");
            break;
        case "FINALIZE":
            out.status = "FINALIZED";
            break;
        case "ARCHIVE":
            out.status = "ARCHIVED";
            break;
        case "ROUTE_PV":
            move("PV", "PV_ACTIVE");
            break;
        case "REOPEN": {
            assert(input.destination && ["GENERATION", "QA", "CHASING", "PV"].includes(input.destination), 400, "DESTINATION_REQUIRED", "Select a destination department.");
            const states: Record<string, LeadStatus> = { GENERATION: "REWORK_REQUIRED", QA: "QA_REVIEW", CHASING: "CHASING_ACTIVE", PV: "PV_ACTIVE" };
            move(input.destination, states[input.destination], input.destination === "GENERATION" ? lead.createdBy : null);
            if (input.destination === "GENERATION")
                out.reworkFrom = "GENERATION";
            break;
        }
    }
    return out;
}
