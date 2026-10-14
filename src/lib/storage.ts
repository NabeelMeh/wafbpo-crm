import {randomUUID} from 'node:crypto';
import {S3Client,GetBucketVersioningCommand,HeadObjectCommand,GetObjectCommand,ListObjectVersionsCommand,DeleteObjectsCommand} from '@aws-sdk/client-s3';
import {createPresignedPost} from '@aws-sdk/s3-presigned-post';
import type {ClientSession} from 'mongodb';
import {collections,transaction,type FileDoc} from './db.ts';
import type {Actor,LeadDoc} from './domain/types.ts';
import {assert,AppError} from './domain/errors.ts';
import {record,text,onlyKeys} from './domain/validation.ts';
import {canEditDoctor,isManagement,canDelete} from './domain/policy.ts';
import {validateFileMetadata,assertLeadAttachment} from './domain/file-policy.ts';
import {inspectFile} from './file-inspection.ts';
import {getLead,idempotent} from './leads.ts';
import {audit} from './audit.ts';
let instance:S3Client|undefined;
// Provider errors (missing credentials, AccessDenied, NoSuchBucket, network) become a safe 503 instead of an opaque 500; only the error name is logged.
function storageFailure(e:unknown):never{
 if(e instanceof AppError)throw e;
 const name=e instanceof Error?e.name:'UnknownError';
 if(name==='NoSuchKey'||name==='NotFound')throw new AppError(404,'NOT_FOUND','The stored object was not found.');
 console.error(JSON.stringify({level:'error',type:'STORAGE_ERROR',name}));
 throw new AppError(503,'STORAGE_UNAVAILABLE','Private storage is unavailable. Contact Management.');
}
export function fileStore(){
 assert(process.env.S3_BUCKET&&process.env.AWS_REGION,503,'STORAGE_NOT_CONFIGURED','Private storage is not configured. Contact Management.');
 assert(!process.env.AWS_ACCESS_KEY_ID===!process.env.AWS_SECRET_ACCESS_KEY,503,'STORAGE_NOT_CONFIGURED','Private storage credentials are incomplete. Contact Management.');
 if(!instance)instance=new S3Client({region:process.env.AWS_REGION,...(process.env.S3_ENDPOINT?{endpoint:process.env.S3_ENDPOINT,forcePathStyle:true}:{})});
 const client=instance;
 const s3={send:(<T extends Parameters<S3Client['send']>[0]>(command:T)=>client.send(command as never).catch(storageFailure)) as S3Client['send']};
 return {s3,client,bucket:process.env.S3_BUCKET};
}
async function writable(u:Actor,leadId:string,s?:ClientSession):Promise<LeadDoc|undefined>{
 if(leadId==='__branding__'){assert(isManagement(u),403,'FORBIDDEN','Only Management/Admin can upload logos.');return undefined;}
 const lead=await getLead(u,leadId,s);assert(canEditDoctor(u,lead),403,'FORBIDDEN','The record must be editable, and Q/A work must be claimed.');return lead;
}
async function lockLead(lead:LeadDoc|undefined,s:ClientSession){if(!lead)return;const changed=await (await collections()).leads.updateOne({_id:lead._id,version:lead.version},{$inc:{version:1},$set:{updatedAt:new Date().toISOString()}},{session:s});assert(changed.modifiedCount,409,'VERSION_CONFLICT','The record changed. Refresh and retry.');}
// Audio signatures live in the header, so only the first 64 KB is read; PDFs and logos are read whole to find active content.
export async function inspectStoredObject(file:Pick<FileDoc,'key'|'name'|'type'|'kind'>,versionId:string){
 const {s3,bucket}=fileStore(),range=file.kind==='RECORDING'?'bytes=0-65535':undefined;
 const result=await s3.send(new GetObjectCommand({Bucket:bucket,Key:file.key,VersionId:versionId,...(range?{Range:range}:{})}));
 if(!result.Body)return false;
 return inspectFile(file.name,file.type,Buffer.from(await result.Body.transformToByteArray()));
}
export async function beginUpload(u:Actor,leadId:string,raw:unknown,key:string|null){
 const r=record(raw);onlyKeys(r,['name','type','size','kind','description']);
 const meta=validateFileMetadata(text(r.name,'File name',180,true),text(r.type,'Content type',150),Number(r.size),leadId==='__branding__');
 if(leadId!=='__branding__')assertLeadAttachment(meta.kind);
 await writable(u,leadId);
 const c=await collections(),{s3,client,bucket}=fileStore(),versioning=await s3.send(new GetBucketVersioningCommand({Bucket:bucket}));
 assert(versioning.Status==='Enabled',503,'VERSIONING_REQUIRED','Private storage must have object versioning enabled.');
 const result=await idempotent(u,key,{leadId,raw},async s=>{
  const lead=await writable(u,leadId,s);await lockLead(lead,s);
  const file:FileDoc={_id:randomUUID(),leadId,key:`${leadId==='__branding__'?'branding':'leads'}/${randomUUID()}/${randomUUID()}`,name:meta.name,type:meta.type,size:meta.size,kind:meta.kind,description:text(r.description,'Description',1000),status:'PENDING',uploadedBy:u.id,uploadedByName:u.name,department:lead?.department||'MANAGEMENT',createdAt:new Date().toISOString()};
  await c.files.insertOne(file,{session:s});await audit(u,'FILE_UPLOAD_STARTED',{fileId:file._id,name:file.name,kind:file.kind},lead,s);
  return {data:{id:file._id},notify:[]};
 });
 const file=await c.files.findOne({_id:result.id,status:'PENDING',uploadedBy:u.id});assert(file,409,'UPLOAD_ALREADY_FINISHED','This upload was already completed or removed.');await writable(u,leadId);
 const post=await createPresignedPost(client,{Bucket:bucket,Key:file.key,Expires:300,Fields:{'Content-Type':meta.type},Conditions:[['content-length-range',meta.size,meta.size],['eq','$Content-Type',meta.type]]});
 return {fileId:file._id,url:post.url,fields:post.fields};
}
export async function completeUpload(u:Actor,id:string){
 const c=await collections(),file=await c.files.findOne({_id:id});assert(file&&file.uploadedBy===u.id,404,'NOT_FOUND','Upload not found.');await writable(u,file.leadId);
 if(file.status!=='PENDING'){assert(!['DELETED','PURGED'].includes(file.status),404,'NOT_FOUND','Upload was removed.');return {ok:true,status:file.status};}
 const {s3,bucket}=fileStore(),head=await s3.send(new HeadObjectCommand({Bucket:bucket,Key:file.key}));
 assert(head.ContentLength===file.size&&head.ContentType===file.type&&head.VersionId&&head.VersionId!=='null',400,'INVALID_UPLOAD','Uploaded object failed size, type or immutable-version validation.');
 const verified=await inspectStoredObject(file,head.VersionId),status=verified?'CLEAN' as const:'REJECTED' as const,at=new Date().toISOString();
 await transaction(async s=>{const lead=await writable(u,file.leadId,s);await lockLead(lead,s);const changed=await c.files.updateOne({_id:id,status:'PENDING'},{$set:{versionId:head.VersionId,status,inspection:'IN_APP',inspectedAt:at}},{session:s});if(changed.modifiedCount)await audit(u,'FILE_UPLOADED',{fileId:id,name:file.name,kind:file.kind,status,inspection:'IN_APP'},lead,s,u.id);});
 return {ok:true,status};
}
export async function listFiles(u:Actor,leadId:string,url:URL){if(leadId==='__branding__')assert(isManagement(u),403,'FORBIDDEN','Management/Admin access is required.');else await getLead(u,leadId);const c=await collections(),filter:Record<string,unknown>={leadId,status:{$nin:['DELETED','PURGED']}};if(url.searchParams.get('after'))filter._id={$gt:url.searchParams.get('after')};const rows=await c.files.find(filter).sort({_id:1}).limit(101).toArray();return {items:rows.slice(0,100).map(({key,versionId,scanLeaseToken,...rest})=>rest),nextAfter:rows.length>100?rows[99]._id:null};}
async function readableFile(u:Actor,id:string){const file=await (await collections()).files.findOne({_id:id});assert(file,404,'NOT_FOUND','File not found.');if(file.leadId==='__branding__')assert(isManagement(u),403,'FORBIDDEN','Management/Admin access is required.');else await getLead(u,file.leadId);assert(file.status==='CLEAN'&&file.versionId,409,'FILE_NOT_READY','The file failed verification, was removed, or is not yet complete.');return file;}
export async function downloadFile(u:Actor,id:string,inline=false){await readableFile(u,id);return {url:`/api/files/${encodeURIComponent(id)}/content${inline?'?inline=1':''}`};}
async function streamFile(file:FileDoc,req:Request,inline:boolean){
 const {s3,bucket}=fileStore(),range=req.headers.get('range');assert(!range||/^bytes=(?:\d+-\d*|-\d+)$/.test(range),416,'INVALID_RANGE','Only one byte range is supported.');
 const result=await s3.send(new GetObjectCommand({Bucket:bucket,Key:file.key,VersionId:file.versionId,...(range?{Range:range}:{})}));
 assert(result.Body,404,'NOT_FOUND','Stored file could not be read.');const safeInline=inline&&(file.kind==='PDF'||file.kind==='IMAGE'||file.kind==='LOGO'||file.kind==='RECORDING');
 const headers=new Headers({'Content-Type':file.type,'Content-Disposition':`${safeInline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Content-Security-Policy':"sandbox; default-src 'none'"});
 if(result.ContentLength!==undefined)headers.set('Content-Length',String(result.ContentLength));if(result.ContentRange)headers.set('Content-Range',result.ContentRange);
 return new Response(result.Body.transformToWebStream() as ReadableStream,{status:result.ContentRange?206:200,headers});
}
export async function fileContent(u:Actor,id:string,req:Request,inline=false){const file=await readableFile(u,id),lead=file.leadId==='__branding__'?undefined:await getLead(u,file.leadId);await audit(u,inline?'FILE_PREVIEWED':'FILE_DOWNLOADED',{fileId:id},lead);return streamFile(file,req,inline);}
export async function publicLogo(req:Request){const c=await collections(),branding=await c.settings.findOne({_id:'branding'}),id=(branding?.value as {logoFileId?:string}|undefined)?.logoFileId;assert(id,404,'NOT_FOUND','No logo configured.');const file=await c.files.findOne({_id:id,kind:'LOGO',leadId:'__branding__',status:'CLEAN'});assert(file&&file.versionId,404,'NOT_FOUND','Logo not available.');return streamFile(file,req,true);}
export async function deleteFile(u:Actor,id:string,raw:unknown,key:string|null){
 const r=record(raw);onlyKeys(r,['confirmation','reason']);const reason=text(r.reason,'Reason',1000,true);assert(reason.length>=3,400,'REASON_REQUIRED','Provide a deletion reason.');
 const result=await idempotent(u,key,{id,raw,operation:'delete-file'},async s=>{const c=await collections(),file=await c.files.findOne({_id:id},{session:s});assert(file,404,'NOT_FOUND','File not found.');const lead=file.leadId==='__branding__'?undefined:await getLead(u,file.leadId,s);assert(lead?canDelete(u,lead):isManagement(u),403,'FORBIDDEN','You do not have permission to delete this file.');assert(r.confirmation===file.name,400,'CONFIRMATION_REQUIRED','Enter the exact file name to confirm deletion.');await lockLead(lead,s);const now=new Date().toISOString();await c.files.updateOne({_id:id},{$set:{status:'DELETED',deletedAt:now,deletedBy:u.id,purgeAfter:now}},{session:s});await audit(u,'FILE_DELETED',{fileId:id,name:file.name,reason,physicalPurge:'queued'},lead,s);return {data:{ok:true,purgeQueued:true},notify:[]};});
 await purgeDeletedFilesSafely();
 return result;
}
/** Removes every stored version of files already marked DELETED. Each key is a unique random path owned by one file record, so no other lead's file can match. */
export async function purgeDeletedFiles(limit=25){
 const c=await collections(),{s3,bucket}=fileStore();
 const rows=await c.files.find({status:'DELETED',purgeAfter:{$lte:new Date().toISOString()}}).limit(limit).toArray();
 for(const file of rows){
  let keyMarker:string|undefined,versionMarker:string|undefined;
  do{const page=await s3.send(new ListObjectVersionsCommand({Bucket:bucket,Prefix:file.key,KeyMarker:keyMarker,VersionIdMarker:versionMarker}));
   const objects=[...(page.Versions||[]),...(page.DeleteMarkers||[])].filter(v=>v.Key===file.key&&v.VersionId).map(v=>({Key:v.Key!,VersionId:v.VersionId!}));
   if(objects.length){const result=await s3.send(new DeleteObjectsCommand({Bucket:bucket,Delete:{Objects:objects,Quiet:true}}));if(result.Errors?.length)throw new Error('Storage purge failed; metadata remains queued.');}
   keyMarker=page.IsTruncated?page.NextKeyMarker:undefined;versionMarker=page.IsTruncated?page.NextVersionIdMarker:undefined;
  }while(keyMarker);
  await c.files.updateOne({_id:file._id,status:'DELETED'},{$set:{status:'PURGED'},$unset:{scanLeaseToken:'',scanLeaseUntil:''}});
 }
 return rows.length;
}
// Deletion is already committed and the content is unreadable; a storage failure only leaves the purge queued for `npm run worker:purge`.
export async function purgeDeletedFilesSafely(){try{await purgeDeletedFiles(25);}catch(e){console.error('File purge deferred:',e instanceof Error?e.message:e);}}
