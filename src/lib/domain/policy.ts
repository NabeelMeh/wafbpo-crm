import type { Actor, Department, LeadCore, Patient, Doctor, WorkDepartment, Action } from './types.ts';
import { assert } from './errors.ts';
export const isManagement = (u: Actor) => ['MANAGEMENT','ADMIN','SUPER_ADMIN'].includes(u.role);
export const isHead = (u: Actor, d?: Department) => u.memberships.some(m => m.kind === 'HEAD' && (!d || m.department === d));
export const inDepartment = (u: Actor, d: Department) => isManagement(u) || u.memberships.some(m => m.department === d);
export const canSeeTeam = (u: Actor) => isManagement(u) || isHead(u);
export const activeActor = (u: Actor) => u.accountStatus === 'ACTIVE' && u.enrollmentStatus !== 'NOT_ENROLLED';
export const claimIsActive = (l: LeadCore, now = Date.now()) => !!l.claim && Date.parse(l.claim.expiresAt) > now;
export const ownsClaim = (u: Actor, l: LeadCore, now = Date.now()) => claimIsActive(l, now) && l.claim!.userId === u.id;
export function canReadLead(u: Actor, l: LeadCore): boolean {
    if (!activeActor(u) || l.deletedAt) return false;
    if (isManagement(u)) return true;
    if (!inDepartment(u,l.department) || ['ARCHIVED','FINALIZED','MIGRATION_REVIEW'].includes(l.status)) return false;
    if (l.status === 'DRAFT') return l.createdBy === u.id;
    if (l.department === 'QA' && l.status === 'QA_REVIEW') return true;
    if (isHead(u,l.department)) return true;
    return l.assignedTo === u.id || (l.department === 'GENERATION' && l.createdBy === u.id && l.status === 'REWORK_REQUIRED');
}
export function assertRead(u: Actor, l: LeadCore | null): asserts l is LeadCore {
    assert(l && canReadLead(u,l),404,'NOT_FOUND','Record not found or no longer in your authorized queue.');
}
export const canSeeSecurity = (u: Actor) => isManagement(u);
export const canReveal = (u: Actor,l: LeadCore) => canReadLead(u,l) && (isManagement(u) || ['QA','GENERATION','CHASING','PV'].includes(l.department));
export const pvEligible = (l: LeadCore) => !!l.chasingDeniedAt || l.origin === 'PV';
export function canEditDoctor(u: Actor,l: LeadCore,now=Date.now()): boolean {
    if (!canReadLead(u,l) || ['ARCHIVED','FINALIZED','DENIED','MIGRATION_REVIEW'].includes(l.status)) return false;
    if (l.department === 'QA') return l.status === 'QA_REVIEW' && ownsClaim(u,l,now);
    if (l.department === 'PV' && !pvEligible(l)) return false;
    return isManagement(u) || inDepartment(u,l.department);
}
export function canEditPatient(u: Actor,l: LeadCore,now=Date.now()): boolean {
    if (!canEditDoctor(u,l,now)) return false;
    return isManagement(u) || ['QA','CHASING','PV'].includes(l.department) || (l.department === 'GENERATION' && ['DRAFT','REWORK_REQUIRED','GENERATION_REVIEW'].includes(l.status) && (l.createdBy === u.id || isHead(u,'GENERATION')));
}
export function assertEdit(u:Actor,l:LeadCore,patch:{patient?:Partial<Patient>;doctor?:Partial<Doctor>}) {
    assertRead(u,l);
    if(patch.patient) assert(canEditPatient(u,l),403,'FORBIDDEN','Patient editing is not authorized. Claim Q/A work before editing.');
    if(patch.doctor) assert(canEditDoctor(u,l),403,'FORBIDDEN','Doctor editing is not authorized. Claim Q/A work before editing.');
}
export const canDelete = (u:Actor,l:LeadCore) => canReadLead(u,l) && (isManagement(u) || u.deletionGranted === true);
export function assertCreate(u:Actor,d:WorkDepartment) {
    assert(activeActor(u),403,'FORBIDDEN','Account is not enrolled and active.');
    assert(d === 'GENERATION' || d === 'CHASING' || d === 'PV',400,'INVALID_DEPARTMENT','Records may start in Generation; Management can import raw Chasing or Patient Verification datasets.');
    assert(isManagement(u) || (d === 'GENERATION' && inDepartment(u,'GENERATION')),403,'FORBIDDEN','Only Generation staff or Management may create leads.');
}
export function leadScope(u:Actor,department?:Department):Record<string,unknown> {
    if(!activeActor(u)) return {_id:'__no_access__'};
    const base:Record<string,unknown>={deletedAt:{$exists:false}};
    if(department) base.department=department;
    if(isManagement(u)) return base;
    const scopes:Record<string,unknown>[]=[];
    for(const m of u.memberships) {
        if(m.kind === 'HEAD') scopes.push({department:m.department,status:{$nin:['DRAFT','FINALIZED','ARCHIVED','MIGRATION_REVIEW']}});
        scopes.push({department:m.department,assignedTo:u.id,status:{$nin:['DRAFT','FINALIZED','ARCHIVED','MIGRATION_REVIEW']}});
        if(m.department === 'QA') scopes.push({department:'QA',status:'QA_REVIEW'});
        if(m.department === 'GENERATION') scopes.push({department:'GENERATION',createdBy:u.id,status:{$in:['DRAFT','REWORK_REQUIRED']}});
    }
    return scopes.length ? {...base,$or:scopes} : {_id:'__no_access__'};
}
export function canAssignTo(actor:Actor,target:Actor,department:Department):boolean {
    return activeActor(target) && department !== 'MANAGEMENT' && target.memberships.some(m=>m.department===department&&m.kind==='AGENT'&&(isManagement(actor)||m.headId===actor.id));
}
export function reopenDestination(l:LeadCore):WorkDepartment {
    if(l.legacyRoutingReview) return 'CHASING';
    if(l.completedSource==='PV'&&pvEligible(l)) return 'PV';
    if(l.department==='PV'&&pvEligible(l)) return 'PV';
    if(l.department==='GENERATION'||l.department==='QA') return l.department;
    return 'CHASING';
}
export function actionVisible(u:Actor,l:LeadCore,action:Action,now=Date.now()):boolean {
    if(!canReadLead(u,l)) return false;
    const mg=isManagement(u),head=mg||isHead(u,l.department),qa=l.department==='QA'&&l.status==='QA_REVIEW';
    switch(action) {
        case 'SUBMIT':return l.department==='GENERATION'&&l.status==='DRAFT'&&(l.createdBy===u.id||mg);
        case 'APPROVE_GENERATION':case 'RETURN_GENERATION':case 'ROUTE_PV':return false;
        case 'QA_GOOD':case 'QA_BAD':return qa&&ownsClaim(u,l,now);
        case 'CLAIM':return qa&&inDepartment(u,'QA')&&(!claimIsActive(l,now)||ownsClaim(u,l,now));
        case 'RELEASE':return qa&&!!l.claim&&(l.claim.userId===u.id||head);
        case 'RESUBMIT':return l.department==='GENERATION'&&l.status==='REWORK_REQUIRED'&&(l.createdBy===u.id||head);
        case 'ASSIGN':case 'PULL_BACK':return head&&l.department!=='MANAGEMENT'&&!claimIsActive(l,now)&&!['DRAFT','ARCHIVED','FINALIZED','DENIED','MIGRATION_REVIEW'].includes(l.status)&&(action==='ASSIGN'||!!l.assignedTo);
        case 'DENY':return head&&l.department==='CHASING'&&['CHASING_ACTIVE','INCOMPLETE'].includes(l.status);
        case 'INCOMPLETE':case 'COMPLETE':return head&&(l.department==='CHASING'||(l.department==='PV'&&pvEligible(l)))&&['CHASING_ACTIVE','PV_ACTIVE','INCOMPLETE'].includes(l.status);
        case 'FINALIZE':return mg&&l.status==='MANAGEMENT_REVIEW';
        case 'REOPEN':return mg&&['DENIED','INCOMPLETE','MANAGEMENT_REVIEW','FINALIZED','ARCHIVED','MIGRATION_REVIEW'].includes(l.status);
        case 'ARCHIVE':return mg&&!['ARCHIVED','DRAFT'].includes(l.status)&&!claimIsActive(l,now);
    }
}
