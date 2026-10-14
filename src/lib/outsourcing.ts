import type {Actor,OutsourceTarget} from './domain/types.ts';
import {OUTSOURCE_TARGETS} from './domain/types.ts';
import {collections} from './db.ts';
import {getLead,idempotent} from './leads.ts';
import {isManagement,activeActor} from './domain/policy.ts';
import {record,text,onlyKeys} from './domain/validation.ts';
import {assert} from './domain/errors.ts';
import {audit} from './audit.ts';
// Outsourcing is a label on the existing record: it never creates copies, moves departments, or grants access.
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
  const c=await collections(),at=new Date().toISOString();
  for(const item of items){
   const lead=await getLead(u,item.id,s);
   assert(item.version===lead.version,409,'VERSION_CONFLICT',`${lead.code} changed. Refresh and try again.`);
   const res=await c.leads.updateOne({_id:item.id,version:item.version},{$set:{outsource:next,outsourcedAt:at,outsourcedBy:u.id,updatedAt:at},$inc:{version:1}},{session:s});
   assert(res.modifiedCount,409,'VERSION_CONFLICT',`${lead.code} changed. Refresh and try again.`);
   await audit(u,'LEAD_OUTSOURCED',{leadId:item.id,code:lead.code,from:lead.outsource??null,to:next},lead,s);
  }
  return {data:{ok:true,updated:items.length,target:next},notify:[]};
 });
}
