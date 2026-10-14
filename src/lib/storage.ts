import {randomUUID,randomBytes} from 'node:crypto';
import {S3Client,GetBucketVersioningCommand,HeadObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {createPresignedPost} from '@aws-sdk/s3-presigned-post';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import type {ClientSession} from 'mongodb';
import {collections,transaction,type FileDoc} from './db.ts';
import type {Actor,LeadDoc} from './domain/types.ts';
import {assert} from './domain/errors.ts';
import {record,text,onlyKeys} from './domain/validation.ts';
import {canEditDoctor,isManagement,canDelete} from './domain/policy.ts';
import {validateFileMetadata} from './domain/file-policy.ts';
import {getLead,idempotent} from './leads.ts';
import {audit} from './audit.ts';
import {sameSecret,digest} from './crypto.ts';
let instance:S3Client|undefined;
export function fileStore(){assert(process.env.S3_BUCKET,503,'STORAGE_NOT_CONFIGURED','Private storage is not configured. Contact Management.');if(!instance)instance=new S3Client({region:process.env.AWS_REGION||'us-east-1',...(process.env.S3_ENDPOINT?{endpoint:process.env.S3_ENDPOINT,forcePathStyle:true}:{})});return {s3:instance,bucket:process.env.S3_BUCKET};}
async function writable(u:Actor,leadId:string,s?:ClientSession):Promise<LeadDoc|undefined>{
 if(leadId==='__branding__'){assert(isManagement(u),403,'FORBIDDEN','Only Management/Admin can upload logos.');return undefined;}
 const lead=await getLead(u,leadId,s);assert(canEditDoctor(u,lead),403,'FORBIDDEN','The record must be editable, and Q/A work must be claimed.');return lead;
}
async function lockLead(lead:LeadDoc|undefined,s:ClientSession){if(!lead)return;const changed=await (await collections()).leads.updateOne({_id:lead._id,version:lead.version},{$inc:{version:1},$set:{updatedAt:new Date().toISOString()}},{session:s});assert(changed.modifiedCount,409,'VERSION_CONFLICT','The record changed. Refresh and retry.');}
export async function beginUpload(u:Actor,leadId:string,raw:unknown,key:string|null){
 const r=record(raw);onlyKeys(r,['name','type','size','kind','description']);
 const meta=validateFileMetadata(text(r.name,'File name',180,true),text(r.type,'Content type',150),Number(r.size),leadId==='__branding__');
 await writable(u,leadId);
 assert(process.env.FILE_SCAN_SECRET&&process.env.FILE_SCAN_SECRET.length>=32,503,'SCANNER_NOT_CONFIGURED','Upload security is not configured. Management must complete the scanner setup in the deployment guide.');
 const c=await collections(),heartbeat=await c.settings.findOne({_id:'scanner-heartbeat'});
 assert(heartbeat&&Date.now()-Date.parse(heartbeat.updatedAt)<5*60000,503,'SCANNER_UNAVAILABLE','The security scanner is offline. No upload has been accepted. Ask Management to start the scanner worker.');
 const {s3,bucket}=fileStore();const versioning=await s3.send(new GetBucketVersioningCommand({Bucket:bucket}));
 assert(versioning.Status==='Enabled',503,'VERSIONING_REQUIRED','Private storage must have object versioning enabled.');
 const result=await idempotent(u,key,{leadId,raw},async s=>{
  const lead=await writable(u,leadId,s);await lockLead(lead,s);
  const file:FileDoc={_id:randomUUID(),leadId,key:`${leadId==='__branding__'?'branding':'leads'}/${randomUUID()}/${randomUUID()}`,name:meta.name,type:meta.type,size:meta.size,kind:meta.kind,description:text(r.description,'Description',1000),status:'PENDING',uploadedBy:u.id,uploadedByName:u.name,department:lead?.department||'MANAGEMENT',createdAt:new Date().toISOString()};
  await c.files.insertOne(file,{session:s});await audit(u,'FILE_UPLOAD_STARTED',{fileId:file._id,name:file.name,kind:file.kind},lead,s);
  return {data:{id:file._id},notify:[]};
 });
 const file=await c.files.findOne({_id:result.id,status:'PENDING',uploadedBy:u.id});assert(file,409,'UPLOAD_ALREADY_FINISHED','This upload was already completed or removed.');await writable(u,leadId);
 const post=await createPresignedPost(s3,{Bucket:bucket,Key:file.key,Expires:300,Fields:{'Content-Type':meta.type},Conditions:[['content-length-range',meta.size,meta.size],['eq','$Content-Type',meta.type]]});
 return {fileId:file._id,url:post.url,fields:post.fields};
}
export async function completeUpload(u:Actor,id:string){
 const c=await collections(),file=await c.files.findOne({_id:id});assert(file&&file.uploadedBy===u.id,404,'NOT_FOUND','Upload not found.');await writable(u,file.leadId);
 if(file.status!=='PENDING'){assert(!['DELETED','PURGED'].includes(file.status),404,'NOT_FOUND','Upload was removed.');return {ok:true,status:file.status};}
 const {s3,bucket}=fileStore(),head=await s3.send(new HeadObjectCommand({Bucket:bucket,Key:file.key}));
 assert(head.ContentLength===file.size&&head.ContentType===file.type&&head.VersionId&&head.VersionId!=='null',400,'INVALID_UPLOAD','Uploaded object failed size, type or immutable-version validation.');
 await transaction(async s=>{const lead=await writable(u,file.leadId,s);await lockLead(lead,s);const changed=await c.files.updateOne({_id:id,status:'PENDING'},{$set:{versionId:head.VersionId,status:'QUARANTINED'}},{session:s});if(changed.modifiedCount)await audit(u,'FILE_UPLOADED',{fileId:id,name:file.name,kind:file.kind,status:'QUARANTINED'},lead,s,u.id);});
 return {ok:true,status:'QUARANTINED'};
}
export async function listFiles(u:Actor,leadId:string,url:URL){if(leadId==='__branding__')assert(isManagement(u),403,'FORBIDDEN','Management/Admin access is required.');else await getLead(u,leadId);const c=await collections(),filter:Record<string,unknown>={leadId,status:{$nin:['DELETED','PURGED']}};if(url.searchParams.get('after'))filter._id={$gt:url.searchParams.get('after')};const rows=await c.files.find(filter).sort({_id:1}).limit(101).toArray();return {items:rows.slice(0,100).map(({key,versionId,scanLeaseToken,...rest})=>rest),nextAfter:rows.length>100?rows[99]._id:null};}
async function readableFile(u:Actor,id:string){const file=await (await collections()).files.findOne({_id:id});assert(file,404,'NOT_FOUND','File not found.');if(file.leadId==='__branding__')assert(isManagement(u),403,'FORBIDDEN','Management/Admin access is required.');else await getLead(u,file.leadId);assert(file.status==='CLEAN'&&file.versionId,409,'FILE_NOT_READY','The file is quarantined, rejected, removed or not yet complete.');return file;}
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
 return idempotent(u,key,{id,raw,operation:'delete-file'},async s=>{const c=await collections(),file=await c.files.findOne({_id:id},{session:s});assert(file,404,'NOT_FOUND','File not found.');const lead=file.leadId==='__branding__'?undefined:await getLead(u,file.leadId,s);assert(lead?canDelete(u,lead):isManagement(u),403,'FORBIDDEN','You do not have permission to delete this file.');assert(r.confirmation===file.name,400,'CONFIRMATION_REQUIRED','Enter the exact file name to confirm deletion.');await lockLead(lead,s);const now=new Date().toISOString();await c.files.updateOne({_id:id},{$set:{status:'DELETED',deletedAt:now,deletedBy:u.id,purgeAfter:now}},{session:s});await audit(u,'FILE_DELETED',{fileId:id,name:file.name,reason,physicalPurge:'queued'},lead,s);return {data:{ok:true,purgeQueued:true},notify:[]};});
}
export function scannerAuth(req:Request){const secret=process.env.FILE_SCAN_SECRET,token=req.headers.get('authorization')?.replace(/^Bearer /,'');assert(secret&&secret.length>=32&&token&&sameSecret(secret,token),401,'UNAUTHENTICATED','Invalid scanner authentication.');}
export async function scanQueue(){
 const c=await collections(),{s3,bucket}=fileStore(),now=new Date();await c.settings.updateOne({_id:'scanner-heartbeat'},{$set:{value:{online:true},updatedAt:now.toISOString(),updatedBy:'system:scanner'}},{upsert:true});
 const items=[];
 for(let i=0;i<1;i++){
  const token=randomBytes(32).toString('base64url'),file=await c.files.findOneAndUpdate({status:'QUARANTINED',$and:[{$or:[{scanLeaseUntil:{$exists:false}},{scanLeaseUntil:{$lt:now}}]},{$or:[{nextScanAt:{$exists:false}},{nextScanAt:{$lte:now}}]}]},{$set:{scanLeaseToken:digest(token),scanLeaseUntil:new Date(now.getTime()+15*60000)}},{sort:{createdAt:1},returnDocument:'after'});
  if(!file)break;
  items.push({fileId:file._id,name:file.name,kind:file.kind,versionId:file.versionId,size:file.size,type:file.type,token,url:await getSignedUrl(s3,new GetObjectCommand({Bucket:bucket,Key:file.key,VersionId:file.versionId}),{expiresIn:900})});
 }
 return {items};
}
export async function scanResult(raw:unknown){
 const r=record(raw);onlyKeys(r,['fileId','versionId','clean','token']);assert(typeof r.clean==='boolean',400,'INVALID_INPUT','A scanner verdict is required.');const c=await collections(),id=text(r.fileId,'File ID',100,true),versionId=text(r.versionId,'Version ID',300,true),token=digest(text(r.token,'Lease token',100,true));
 await transaction(async s=>{const file=await c.files.findOneAndUpdate({_id:id,versionId,status:'QUARANTINED',scanLeaseToken:token,scanLeaseUntil:{$gt:new Date()}},{$set:{status:r.clean?'CLEAN':'REJECTED',scanAt:new Date().toISOString()},$unset:{scanLeaseToken:'',scanLeaseUntil:''}},{session:s,returnDocument:'after'});assert(file,409,'SCAN_CONFLICT','File was removed, already scanned, or the scanner lease expired.');const system:Actor={id:'system:scanner',name:'File scanner',username:'system:scanner',employeeId:'SYSTEM',role:'STAFF',memberships:[],accountStatus:'ACTIVE',enrollmentStatus:'ENROLLED',mustChangePassword:false,mfaEnabled:true};const lead=await c.leads.findOne({_id:file.leadId},{session:s});await audit(system,'FILE_SCANNED',{fileId:id,clean:r.clean,versionId},lead||undefined,s);});return {ok:true};
}
