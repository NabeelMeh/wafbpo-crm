/** Run on the private worker host. Audit records survive authorized content deletion. */
import {ListObjectVersionsCommand,DeleteObjectsCommand} from '@aws-sdk/client-s3';
import {collections,client} from '../src/lib/db.ts';
import {fileStore} from '../src/lib/storage.ts';
const c=await collections(),{s3,bucket}=fileStore();
try{
 const rows=await c.files.find({status:'DELETED',purgeAfter:{$lte:new Date().toISOString()}}).limit(25).toArray();
 for(const file of rows){
  // Remove every version of the exact key, including unfinalized or replayed upload versions.
  let keyMarker:string|undefined,versionMarker:string|undefined;
  do{const page=await s3.send(new ListObjectVersionsCommand({Bucket:bucket,Prefix:file.key,KeyMarker:keyMarker,VersionIdMarker:versionMarker}));
   const objects=[...(page.Versions||[]),...(page.DeleteMarkers||[])].filter(v=>v.Key===file.key&&v.VersionId).map(v=>({Key:v.Key!,VersionId:v.VersionId!}));
   if(objects.length){const result=await s3.send(new DeleteObjectsCommand({Bucket:bucket,Delete:{Objects:objects,Quiet:true}}));if(result.Errors?.length)throw new Error('Storage purge failed; metadata remains queued.');}
   keyMarker=page.IsTruncated?page.NextKeyMarker:undefined;versionMarker=page.IsTruncated?page.NextVersionIdMarker:undefined;
  }while(keyMarker);
  await c.files.updateOne({_id:file._id,status:'DELETED'},{$set:{status:'PURGED'},$unset:{scanLeaseToken:'',scanLeaseUntil:''}});
 }
 console.log(JSON.stringify({purged:rows.length}));
}finally{await(await client()).close();}
