import type {Actor,OutsourceTarget} from './domain/types.ts';
import {OUTSOURCE_TARGETS,OUTSOURCE_LABELS} from './domain/types.ts';
import {collections} from './db.ts';
import {getLead,idempotent} from './leads.ts';
import {isManagement,activeActor} from './domain/policy.ts';
import {planOutsource} from './domain/outsourcing.ts';
import {record,text,onlyKeys} from './domain/validation.ts';
import {assert} from './domain/errors.ts';
import {audit} from './audit.ts';
import {recipientIds,insertNotifications} from './notifications.ts';
// Outsourcing updates the existing record in place and routes it into the target department's queue; it never copies records or widens leadScope.
export async function outsourceLeads(u:Actor,raw:unknown,key:string|null){
 assert(activeActor(u)&&isManagement(u),403,'FORBIDDEN','Only Management/Admin can assign outsourcing.');
 const r=record(raw);onlyKeys(r,['items','target']);
 const target=text(r.target,'Outsource target',10,true);
 assert(target==='NONE'||OUTSOURCE_TARGETS.includes(target as OutsourceTarget),400,'INVALID_TARGET','Choose Chasing, PV, both, or none.');
 const next=target==='NONE'?null:target as OutsourceTarget;
 assert(Array.isArray(r.items)&&r.items.length>0&&r.items.length<=50,400,'INVALID_BATCH','Select between 1 and 50 records.');
 const items=r.items.map(v=>{const x=record(v);return {id:text(x.id,'Record ID',100,true),version:Number(x.version)};});
 assert(new Set(items.map(i=>i.id)).size===items.length,400,'DUPLICATE_ITEMS','A record was selected more than once.');
 return idempotent(u,key,{operation:'outsource-leads',items,target},async s=>{
  const c=await collections(),now=new Date(),notify:string[]=[];let updated=0,unchanged=0;
  for(const item of items){
   const lead=await getLead(u,item.id,s);
   assert(item.version===lead.version,409,'VERSION_CONFLICT',`${lead.code} changed. Refresh and try again.`);
   const plan=planOutsource(u,lead,next,now);
   if(!plan){unchanged++;continue;}
   const n=plan.lead,unset:Record<string,''>={};
   if(n.outsourceChasingDoneAt===undefined) unset.outsourceChasingDoneAt='';
   if(n.outsourceChasingAgentId===undefined) unset.outsourceChasingAgentId='';
   const res=await c.leads.updateOne({_id:item.id,version:item.version,deletedAt:{$exists:false}},{
    $set:{department:n.department,status:n.status,assignedTo:n.assignedTo,claim:n.claim??null,followUpAt:n.followUpAt??null,outsource:n.outsource,outsourcedAt:n.outsourcedAt,outsourcedBy:n.outsourcedBy,updatedAt:n.updatedAt},
    ...(Object.keys(unset).length?{$unset:unset}:{}),
    $push:{outsourceHistory:{$each:[plan.entry],$slice:-100}},$inc:{version:1}},{session:s});
   assert(res.modifiedCount,409,'VERSION_CONFLICT',`${lead.code} changed. Refresh and try again.`);
   const e=plan.entry;
   const eventId=await audit(u,'LEAD_OUTSOURCED',{leadId:item.id,code:lead.code,from:e.from,to:e.to,before:{department:e.fromDepartment,status:e.fromStatus,assignedTo:e.previousAssignee},after:{department:e.toDepartment,status:e.toStatus,assignedTo:n.assignedTo}},n,s);
   if(e.fromDepartment!==e.toDepartment){
    const ids=await recipientIds(n,s);
    await insertNotifications(ids,eventId,'Lead outsourced to your queue',`${lead.code}: ${next?OUTSOURCE_LABELS[next]:'Outsourcing removed'}`,n,1,s);
    notify.push(...ids);
   }
   updated++;
  }
  return {data:{ok:true,updated,unchanged,target:next},notify:[...new Set(notify)]};
 });
}
