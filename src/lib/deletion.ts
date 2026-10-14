import type {ClientSession} from 'mongodb';
import type {Actor,LeadDoc} from './domain/types.ts';
import {collections} from './db.ts';
import {getLead,idempotent} from './leads.ts';
import {canDelete,isManagement,activeActor} from './domain/policy.ts';
import {record,text,onlyKeys} from './domain/validation.ts';
import {assert} from './domain/errors.ts';
import {audit} from './audit.ts';
import {purgeDeletedFilesSafely} from './storage.ts';
export const BULK_DELETE_LIMIT=50;
async function purgeLead(u:Actor,lead:LeadDoc,reason:string,s:ClientSession,bulk=false){
 const c=await collections(),id=lead._id,at=new Date().toISOString();
 await audit(u,'LEAD_DELETED',{leadId:id,code:lead.code,reference:{department:lead.department,status:lead.status},reason,bulk,physicalFilePurge:'queued',auditHistoryRetained:true},lead,s);
 await c.files.updateMany({leadId:id,status:{$ne:'PURGED'}},{$set:{status:'DELETED',deletedAt:at,deletedBy:u.id,purgeAfter:at}},{session:s});
 await c.activities.deleteMany({leadId:id},{session:s});
 await c.notifications.deleteMany({leadId:id},{session:s});
 await c.importRows.updateMany({leadId:id},{$set:{status:'SKIPPED',error:'Lead deleted by an authorized user'}},{session:s});
 const result=await c.leads.deleteOne({_id:id,version:lead.version},{session:s});assert(result.deletedCount,409,'VERSION_CONFLICT','The record changed.');
}
export async function deleteLead(u:Actor,id:string,raw:unknown,key:string|null){
 const r=record(raw);onlyKeys(r,['confirmation','reason','version']);const reason=text(r.reason,'Reason',1000,true);assert(reason.length>=3,400,'REASON_REQUIRED','Explain why the record is being deleted.');
 const result=await idempotent(u,key,{operation:'delete-lead',id,raw},async s=>{
  const lead=await getLead(u,id,s);assert(canDelete(u,lead),403,'FORBIDDEN','Only Management/Admin or explicitly delegated users may delete this record.');
  assert(r.confirmation===lead.code,400,'CONFIRMATION_REQUIRED','Type the exact lead ID to confirm permanent deletion.');assert(r.version===lead.version,409,'VERSION_CONFLICT','The record changed. Review it before deleting.');
  await purgeLead(u,lead,reason,s);
  return {data:{ok:true,deletedId:id,filesPurgeQueued:true,auditHistoryRetained:true},notify:[]};
 });
 await purgeDeletedFilesSafely();
 return result;
}
export async function bulkDeleteLeads(u:Actor,raw:unknown,key:string|null){
 assert(activeActor(u)&&isManagement(u),403,'FORBIDDEN','Only Management/Admin can bulk delete records.');
 const r=record(raw);onlyKeys(r,['items','reason','confirmation']);
 assert(Array.isArray(r.items)&&r.items.length>0&&r.items.length<=BULK_DELETE_LIMIT,400,'INVALID_BATCH',`Select between 1 and ${BULK_DELETE_LIMIT} records.`);
 const items=r.items.map(v=>{const x=record(v);return {id:text(x.id,'Record ID',100,true),version:Number(x.version)};});
 assert(new Set(items.map(i=>i.id)).size===items.length,400,'DUPLICATE_ITEMS','A record was selected more than once.');
 const reason=text(r.reason,'Reason',1000,true);assert(reason.length>=3,400,'REASON_REQUIRED','Explain why the records are being deleted.');
 assert(r.confirmation===`DELETE ${items.length}`,400,'CONFIRMATION_REQUIRED',`Type DELETE ${items.length} to confirm permanent deletion.`);
 const result=await idempotent(u,key,{operation:'bulk-delete-leads',items,reason},async s=>{
  for(const item of items){
   const lead=await getLead(u,item.id,s);
   assert(canDelete(u,lead),403,'FORBIDDEN',`You are not allowed to delete ${lead.code}.`);
   assert(item.version===lead.version,409,'VERSION_CONFLICT',`${lead.code} changed. Refresh and review before deleting.`);
   await purgeLead(u,lead,reason,s,true);
  }
  return {data:{ok:true,deleted:items.length,filesPurgeQueued:true,auditHistoryRetained:true},notify:[]};
 });
 await purgeDeletedFilesSafely();
 return result;
}
