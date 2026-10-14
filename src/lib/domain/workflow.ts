import type {Actor,LeadCore,WorkflowInput,LeadStatus,Department} from './types.ts';
import {actionVisible,assertRead,reopenDestination} from './policy.ts';
import {assert} from './errors.ts';
export function transition(actor:Actor,lead:LeadCore,input:WorkflowInput,now=new Date()):LeadCore {
    assertRead(actor,lead);
    assert(input.version===lead.version,409,'VERSION_CONFLICT','This record changed. Refresh before applying your action.');
    assert(actionVisible(actor,lead,input.action,now.getTime()),403,'FORBIDDEN_TRANSITION','This action is not permitted, or the Q/A claim is absent, expired or held by another user.');
    if(['QA_BAD','DENY','INCOMPLETE','REOPEN','ARCHIVE'].includes(input.action)||(input.action==='RELEASE'&&lead.claim?.userId!==actor.id))
        assert(input.reason&&input.reason.trim().length>=3,400,'REASON_REQUIRED','Enter a reason of at least three characters.');
    if(['QA_BAD','REOPEN'].includes(input.action))assert(input.comment?.trim(),400,'COMMENT_REQUIRED','A comment is required.');
    if(input.action==='INCOMPLETE')assert(input.followUpAt&&Number.isFinite(Date.parse(input.followUpAt))&&Date.parse(input.followUpAt)>now.getTime(),400,'FOLLOW_UP_REQUIRED','Choose a future follow-up date.');
    const out:LeadCore={...lead,version:lead.version+1,updatedAt:now.toISOString()};
    const move=(department:Department,status:LeadStatus,assignedTo:string|null=null)=>{Object.assign(out,{department,status,assignedTo,claim:null,followUpAt:null});};
    switch(input.action) {
        case 'SUBMIT':case 'RESUBMIT':move('QA','QA_REVIEW');out.submissionVersion=Math.max(1,lead.submissionVersion+1);break;
        case 'QA_GOOD':move('CHASING','CHASING_ACTIVE');break;
        case 'QA_BAD':move('GENERATION','REWORK_REQUIRED',lead.createdBy);out.reworkFrom='QA';break;
        case 'CLAIM':out.assignedTo=actor.id;out.claim={userId:actor.id,name:actor.name,specialId:actor.employeeId,claimedAt:now.toISOString(),expiresAt:new Date(now.getTime()+300000).toISOString()};break;
        case 'RELEASE':out.assignedTo=null;out.claim=null;break;
        case 'ASSIGN':assert(input.assigneeId,400,'ASSIGNEE_REQUIRED','Select an active agent.');out.assignedTo=input.assigneeId;out.claim=null;break;
        case 'PULL_BACK':out.assignedTo=null;out.claim=null;break;
        case 'DENY':if(lead.department==='CHASING'){out.chasingDeniedAt=now.toISOString();out.chasingDeniedBy=actor.id;move('PV','PV_ACTIVE');}else out.status='DENIED';break;
        case 'INCOMPLETE':out.status='INCOMPLETE';out.followUpAt=new Date(input.followUpAt!).toISOString();break;
        case 'COMPLETE':out.completedSource=lead.department as 'CHASING'|'PV';out.completedAgentId=lead.assignedTo;move('MANAGEMENT','MANAGEMENT_REVIEW');break;
        case 'FINALIZE':out.status='FINALIZED';break;
        case 'ARCHIVE':out.status='ARCHIVED';out.claim=null;break;
        case 'REOPEN':{
            const destination=reopenDestination(lead);
            assert(!input.destination||input.destination===destination,400,'INVALID_ROUTE','The destination is determined automatically from the recorded workflow.');
            const status={GENERATION:'REWORK_REQUIRED',QA:'QA_REVIEW',CHASING:'CHASING_ACTIVE',PV:'PV_ACTIVE'} as const;
            move(destination,status[destination],destination==='GENERATION'?lead.createdBy:null);out.legacyRoutingReview=false;break;
        }
        default:assert(false,403,'FORBIDDEN_TRANSITION','Manual department movement is disabled.');
    }
    return out;
}
