import type {Actor} from './domain/types.ts';
import {collections} from './db.ts';
import {getLead,idempotent} from './leads.ts';
import {canDelete,isManagement} from './domain/policy.ts';
import {record,text,onlyKeys} from './domain/validation.ts';
import {assert} from './domain/errors.ts';
import {audit} from './audit.ts';
export async function deleteLead(u:Actor,id:string,raw:unknown,key:string|null){
 const r=record(raw);onlyKeys(r,['confirmation','reason','version']);const reason=text(r.reason,'Reason',1000,true);assert(reason.length>=3,400,'REASON_REQUIRED','Explain why the record is being deleted.');
 return idempotent(u,key,{operation:'delete-lead',id,raw},async s=>{
  const c=await collections(),lead=await getLead(u,id,s);assert(canDelete(u,lead),403,'FORBIDDEN','Only Management/Admin or explicitly delegated users may delete this record.');
  assert(r.confirmation===lead.code,400,'CONFIRMATION_REQUIRED','Type the exact lead ID to confirm permanent deletion.');assert(r.version===lead.version,409,'VERSION_CONFLICT','The record changed. Review it before deleting.');
  const at=new Date().toISOString();await audit(u,'LEAD_DELETED',{leadId:id,code:lead.code,reference:{department:lead.department,status:lead.status},reason,physicalFilePurge:'queued',auditHistoryRetained:true},lead,s);
  await c.files.updateMany({leadId:id,status:{$ne:'PURGED'}},{$set:{status:'DELETED',deletedAt:at,deletedBy:u.id,purgeAfter:at}},{session:s});
  await c.activities.deleteMany({leadId:id},{session:s});await c.importRows.updateMany({leadId:id},{$set:{status:'SKIPPED',error:'Lead deleted by an authorized user'}},{session:s});
  const result=await c.leads.deleteOne({_id:id,version:lead.version},{session:s});assert(result.deletedCount,409,'VERSION_CONFLICT','The record changed.');
  return {data:{ok:true,deletedId:id,filesPurgeQueued:true,auditHistoryRetained:true},notify:[]};
 });
}
