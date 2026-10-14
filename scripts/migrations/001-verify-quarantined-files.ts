/**
 * Migration 001: move files left in QUARANTINED by the retired external scanner to CLEAN or REJECTED
 * using the built-in verification. Dry run by default; pass --apply to write. Safe to re-run: it only
 * touches rows still QUARANTINED with the same stored version, and never deletes data or objects.
 */
import {collections,client} from '../../src/lib/db.ts';
import {inspectStoredObject} from '../../src/lib/storage.ts';
import {audit} from '../../src/lib/audit.ts';
import type {Actor} from '../../src/lib/domain/types.ts';
const MIGRATION_ID='migration:001-verify-quarantined-files',apply=process.argv.includes('--apply');
const system:Actor={id:'system:migration',name:'File verification migration',username:'system:migration',employeeId:'SYSTEM',role:'STAFF',memberships:[],accountStatus:'ACTIVE',enrollmentStatus:'ENROLLED',mustChangePassword:false,mfaEnabled:true};
const c=await collections(),summary={mode:apply?'apply':'dry-run',examined:0,clean:0,rejected:0,skippedNoVersion:0,changedConcurrently:0,errors:0};
try{
 for await(const file of c.files.find({status:'QUARANTINED'}).sort({createdAt:1})){
  summary.examined++;
  if(!file.versionId){summary.skippedNoVersion++;continue;}
  let verified:boolean;
  try{verified=await inspectStoredObject(file,file.versionId);}catch(e){summary.errors++;console.error(`Could not read ${file._id}:`,e instanceof Error?e.message:e);continue;}
  const status=verified?'CLEAN' as const:'REJECTED' as const;verified?summary.clean++:summary.rejected++;
  if(!apply)continue;
  const at=new Date().toISOString(),res=await c.files.updateOne({_id:file._id,status:'QUARANTINED',versionId:file.versionId},{$set:{status,inspection:'IN_APP',inspectedAt:at},$unset:{scanLeaseToken:'',scanLeaseUntil:'',nextScanAt:''}});
  if(!res.modifiedCount){summary.changedConcurrently++;continue;}
  const lead=file.leadId==='__branding__'?undefined:await c.leads.findOne({_id:file.leadId});
  await audit(system,'FILE_INSPECTED',{fileId:file._id,status,inspection:'IN_APP',migration:MIGRATION_ID},lead||undefined);
 }
 if(apply)await c.settings.updateOne({_id:MIGRATION_ID},{$set:{value:summary,updatedAt:new Date().toISOString(),updatedBy:system.id}},{upsert:true});
 console.log(JSON.stringify(summary));
}finally{await(await client()).close();}
