import type {Actor,LeadCore,OutsourceTarget,LeadStatus} from './types.ts';
import {isManagement,activeActor,claimIsActive} from './policy.ts';
import {assert} from './errors.ts';
type OutsourceDepartment='CHASING'|'PV';
const ACTIVE_STATUS:Record<OutsourceDepartment,LeadStatus>={CHASING:'CHASING_ACTIVE',PV:'PV_ACTIVE'};
// Only records that already passed Q/A (or entered through Management intake) may be routed, so outsourcing never skips review.
const ELIGIBLE:Record<string,LeadStatus[]>={CHASING:['CHASING_ACTIVE','INCOMPLETE'],PV:['PV_ACTIVE','INCOMPLETE'],MANAGEMENT:['MANAGEMENT_REVIEW']};
export const outsourceServes=(t:OutsourceTarget|null|undefined,d:OutsourceDepartment)=>t===d||t==='BOTH';
export const outsourceEligible=(l:LeadCore)=>!l.deletedAt&&(ELIGIBLE[l.department]?.includes(l.status)??false);
const chasingStageDone=(l:LeadCore)=>!!l.outsourceChasingDoneAt||!!l.chasingDeniedAt;
const normallyPvEligible=(l:LeadCore)=>!!l.chasingDeniedAt||l.origin==='PV';
export function outsourceDestination(l:LeadCore,next:OutsourceTarget|null):LeadCore['department'] {
    if(next==='CHASING'||next==='PV') return next;
    // "Both" is worked sequentially (Chasing, then PV) so the two departments never transition the same record at once.
    if(next==='BOTH') return chasingStageDone(l)?'PV':'CHASING';
    if(l.department==='PV'&&!normallyPvEligible(l)) return 'CHASING';
    return l.department;
}
export interface OutsourceHistoryEntry {from:OutsourceTarget|null;to:OutsourceTarget|null;fromDepartment:string;toDepartment:string;fromStatus:string;toStatus:string;previousAssignee:string|null;by:string;at:string;}
export function planOutsource(actor:Actor,lead:LeadCore,next:OutsourceTarget|null,now=new Date()):{lead:LeadCore;entry:OutsourceHistoryEntry}|null {
    assert(activeActor(actor)&&isManagement(actor),403,'FORBIDDEN','Only Management/Admin can assign outsourcing.');
    assert(outsourceEligible(lead),409,'OUTSOURCE_NOT_ELIGIBLE',`${lead.code} is not eligible. Only records in Chasing, Patient Verification, or Management review can be outsourced; Generation and Q/A records must finish Q/A first.`);
    assert(!claimIsActive(lead,now.getTime()),409,'CLAIM_ACTIVE',`${lead.code} is currently claimed. Release it first.`);
    const current=lead.outsource??null,department=outsourceDestination(lead,next);
    if(current===next&&department===lead.department) return null;
    const at=now.toISOString(),moved=department!==lead.department;
    const out:LeadCore={...lead,outsource:next,outsourcedAt:at,outsourcedBy:actor.id,version:lead.version+1,updatedAt:at};
    if(next!=='BOTH'){delete out.outsourceChasingDoneAt;delete out.outsourceChasingAgentId;}
    if(moved) Object.assign(out,{department,status:ACTIVE_STATUS[department as OutsourceDepartment],assignedTo:null,claim:null,followUpAt:null});
    return {lead:out,entry:{from:current,to:next,fromDepartment:lead.department,toDepartment:out.department,fromStatus:lead.status,toStatus:out.status,previousAssignee:lead.assignedTo,by:actor.id,at}};
}
