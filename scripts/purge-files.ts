/** Catch-up purge for deletions whose inline storage cleanup was deferred. Audit records survive authorized content deletion. */
import {client} from '../src/lib/db.ts';
import {purgeDeletedFiles} from '../src/lib/storage.ts';
try{
 let total=0,batch=0;
 do{batch=await purgeDeletedFiles(25);total+=batch;}while(batch===25);
 console.log(JSON.stringify({purged:total}));
}finally{await(await client()).close();}
