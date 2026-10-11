/** Additive, explicit opt-in migration. Never rename permanent IDs or rotate encryption keys. */
import {collections,client,transaction,actor,ensureIndexes} from '../src/lib/db.ts';
import {patientOf} from '../src/lib/leads.ts';
import {identifierSearchKeys,userSearchTokens} from '../src/lib/search.ts';
import {audit} from '../src/lib/audit.ts';
import {unseal} from '../src/lib/crypto.ts';
import type {Actor,LeadDoc} from '../src/lib/domain/types.ts';
const apply=process.argv.includes('--apply');
if(apply&&process.env.MIGRATION_BACKUP_CONFIRMED!=='yes')throw new Error('Back up and verify restore first, stop old writers, then set MIGRATION_BACKUP_CONFIRMED=yes to apply.');
const system:Actor={id:'system:migration-0.3',name:'Cloud Nest migration',username:'system:migration',employeeId:'SYSTEM',designation:'Migration service',role:'SUPER_ADMIN',memberships:[],enrollmentStatus:'ENROLLED',accountStatus:'ACTIVE',mustChangePassword:false,mfaEnabled:true};
try{
 const c=await collections();let users=0,leads=0,routed=0,events=0;
 const namespace=new Map<string,string>();
 for await(const u of c.users.find({})){for(const key of [u.username.toLowerCase(),u.employeeId.toLowerCase()]){if(namespace.has(key)&&namespace.get(key)!==u._id)throw new Error('Username/special-ID ambiguity exists. Resolve user identifiers before migration.');namespace.set(key,u._id);}}
 for await(const u of c.users.find({})){users++;if(apply)await c.users.updateOne({_id:u._id},{$set:{employeeIdNormalized:u.employeeId.toLowerCase(),enrollmentStatus:u.enrollmentStatus||'ENROLLED',designation:u.designation||actor(u).designation,searchTokens:userSearchTokens(u.name,u.username,u.employeeId)}});}
 for await(const old of c.leads.find({})){
  leads++;const keys=identifierSearchKeys(patientOf(old));
  const next:LeadDoc={...old,identifierSearchKeys:keys};let changed=false;
  if(old.department==='GENERATION'&&old.status==='GENERATION_REVIEW'){Object.assign(next,{department:'QA',status:'QA_REVIEW',assignedTo:null,claim:null});changed=true;}
  if(old.department==='QA'&&!old.claim&&old.assignedTo){Object.assign(next,{assignedTo:null,claim:null});changed=true;}
  if(old.department==='PV'&&!old.chasingDeniedAt){Object.assign(next,{department:'MANAGEMENT',status:'MIGRATION_REVIEW',assignedTo:null,claim:null,legacyRoutingReview:true});changed=true;}
  if(changed)routed++;
  if(apply)await transaction(async s=>{next.version=old.version+1;next.updatedAt=new Date().toISOString();const result=await c.leads.replaceOne({_id:old._id,version:old.version},next,{session:s});if(!result.modifiedCount)throw new Error('A record changed during migration. Stop writes and rerun.');if(changed)await audit(system,'MIGRATION_ROUTE_RECONCILED',{before:{department:old.department,status:old.status,assignedTo:old.assignedTo},after:{department:next.department,status:next.status,assignedTo:next.assignedTo},permanentIdPreserved:true},next,s);});
 }
 for await(const e of c.events.find({arrivalDepartment:{$exists:false},leadId:{$exists:true}})){
  const data=unseal<{before?:{department?:string};after?:{department?:string}}>(e.dataSealed,`event:${e._id}`),from=data?.before?.department,to=data?.after?.department;
  const arrival=e.action==='CREATED'?e.department:from&&to&&from!==to?to:undefined;
  if(arrival){events++;if(apply)await c.events.updateOne({_id:e._id},{$set:{arrivalDepartment:arrival,...(from?{fromDepartment:from}:{}),...(to?{toDepartment:to}:{})}});}
 }
 if(apply){await ensureIndexes();await c.settings.updateOne({_id:'schema-version'},{$set:{value:'0.3.0',updatedAt:new Date().toISOString(),updatedBy:system.id}},{upsert:true});}
 console.log(JSON.stringify({mode:apply?'applied':'dry-run',users,leads,routingReconciliations:routed,reportingEventsBackfilled:events,permanentIds:'unchanged'}));
}finally{await(await client()).close();}
