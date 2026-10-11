import {collections} from './db.ts';
import type {Actor} from './domain/types.ts';
import {isManagement} from './domain/policy.ts';
import {assert} from './domain/errors.ts';
import {record,text,onlyKeys} from './domain/validation.ts';
import {seal,unseal} from './crypto.ts';
import {audit} from './audit.ts';
import {idempotent} from './leads.ts';
export const BRAND_NAME='Cloud Nest BPO';
export async function securityEmail():Promise<string>{const row=await (await collections()).settings.findOne({_id:'security-email'});return row?unseal<string>(row.value as string,'setting:security-email'):(process.env.SECURITY_EMAIL||'cloudnestbpo@gmail.com');}
export async function publicBranding(){const row=await (await collections()).settings.findOne({_id:'branding'});const value=row?.value as {logoFileId?:string}|undefined;return {name:BRAND_NAME,logoUrl:value?.logoFileId?`/api/branding/logo?revision=${encodeURIComponent(row!.updatedAt)}`:null,revision:row?.updatedAt||'default'};}
export async function getSettings(u:Actor){assert(isManagement(u),403,'FORBIDDEN','Management/Admin access is required.');const c=await collections(),heartbeat=await c.settings.findOne({_id:'scanner-heartbeat'});return {branding:await publicBranding(),securityEmail:await securityEmail(),emailConfigured:!!(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASSWORD&&process.env.SMTP_FROM),storageConfigured:!!process.env.S3_BUCKET,scannerLastSeen:heartbeat?.updatedAt||null,scannerConfigured:!!process.env.FILE_SCAN_SECRET};}
export async function saveSettings(u:Actor,raw:unknown,key:string|null){
 assert(isManagement(u),403,'FORBIDDEN','Management/Admin access is required.');const r=record(raw);onlyKeys(r,['securityEmail','logoFileId']);
 const email=r.securityEmail===undefined?undefined:text(r.securityEmail,'Security email',254,true);
 assert(!email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),400,'INVALID_EMAIL','Enter a valid security email.');
 return idempotent(u,key,raw,async s=>{
  const c=await collections(),now=new Date().toISOString();
  if(email){await c.settings.updateOne({_id:'security-email'},{$set:{value:seal(email,'setting:security-email'),updatedAt:now,updatedBy:u.id}},{upsert:true,session:s});await audit(u,'SECURITY_EMAIL_CHANGED',{changed:true},undefined,s);}
  if(r.logoFileId!==undefined){
   const id=r.logoFileId===null?null:text(r.logoFileId,'Logo file',100,true);
   if(id){const file=await c.files.findOne({_id:id,kind:'LOGO',status:'CLEAN',leadId:'__branding__'},{session:s});assert(file,409,'LOGO_NOT_READY','The uploaded logo must finish security scanning before saving.');}
   const old=await c.settings.findOne({_id:'branding'},{session:s});const oldId=(old?.value as {logoFileId?:string}|undefined)?.logoFileId;
   await c.settings.updateOne({_id:'branding'},{$set:{value:{name:BRAND_NAME,logoFileId:id},updatedAt:now,updatedBy:u.id}},{upsert:true,session:s});
   if(oldId&&oldId!==id)await c.files.updateOne({_id:oldId,kind:'LOGO'},{$set:{status:'DELETED',deletedAt:now,deletedBy:u.id,purgeAfter:now}},{session:s});
   await audit(u,id?'LOGO_CHANGED':'LOGO_REMOVED',{fileId:id,previousFileId:oldId},undefined,s);
  }
  return {data:{ok:true},notify:[]};
 });
}
export async function listDevices(u:Actor,userId:string){assert(isManagement(u),403,'FORBIDDEN','Management/Admin access is required.');const c=await collections();const rows=await c.trustedDevices.find({userId}).sort({createdAt:-1}).limit(100).toArray();return {items:rows.map(({deviceHash,sessionVersion,...x})=>x)};}
export async function revokeDevice(u:Actor,id:string){assert(isManagement(u),403,'FORBIDDEN','Management/Admin access is required.');const c=await collections(),device=await c.trustedDevices.findOneAndUpdate({_id:id},{$set:{revokedAt:new Date().toISOString()}},{returnDocument:'after'});assert(device,404,'NOT_FOUND','Device not found.');await c.sessions.deleteMany({userId:device.userId,deviceHash:device.deviceHash});await c.deviceChallenges.deleteMany({userId:device.userId,deviceHash:device.deviceHash});const {securityEvent}=await import('./security-events.ts');await securityEvent(u,'DEVICE_REVOKED',{userId:device.userId,deviceId:id});return {ok:true};}
