import type {ClientSession} from 'mongodb';
import {collections} from './db.ts';
import type {Actor} from './domain/types.ts';
import {audit} from './audit.ts';
import {insertNotifications,publishHint} from './notifications.ts';
import {isManagement} from './domain/policy.ts';
import {assert} from './domain/errors.ts';
import {decodeCursor,encodeCursor} from './http.ts';
export function requestInfo(req:Request){return {userAgent:(req.headers.get('user-agent')||'Unknown device').slice(0,300),ip:process.env.VERCEL?(req.headers.get('x-forwarded-for')?.split(',')[0]?.trim().slice(0,64)||'unknown'):'unavailable'};}
export async function securityEvent(u:Actor,action:'LOGIN'|'LOGOUT'|'DEVICE_VERIFIED'|'DEVICE_REVOKED',data:unknown,session?:ClientSession){
 const id=await audit(u,action,data,undefined,session),c=await collections();
 const recipients=await c.users.find({accountStatus:'ACTIVE',enrollmentStatus:{$ne:'NOT_ENROLLED'},role:{$in:['ADMIN','SUPER_ADMIN','MANAGEMENT']}},{session,projection:{_id:1}}).toArray();
 const ids=recipients.map(v=>v._id);
 await insertNotifications(ids,id,`${action.replaceAll('_',' ')}: ${u.name}`,`${u.name} | ${u.employeeId} | ${u.designation||u.role} | ${new Date().toISOString()}. Device/session details are in Security activity.`,undefined,1,session);
 if(!session)await publishHint(ids);return ids;
}
export async function securityActivity(u:Actor,url:URL){
 assert(isManagement(u),403,'FORBIDDEN','Management/Admin access is required.');const c=await collections(),cursor=decodeCursor(url.searchParams.get('before'));
 const filter={action:{$in:['LOGIN','LOGOUT','DEVICE_VERIFIED','DEVICE_REVOKED','DEVICE_VERIFICATION_FAILED']},...(cursor?{$or:[{at:{$lt:cursor.at}},{at:cursor.at,_id:{$lt:cursor.id}}]}:{})};
 const rows=await c.events.find(filter).sort({at:-1,_id:-1}).limit(101).toArray();const {eventView}=await import('./audit.ts');return {items:rows.slice(0,100).map(x=>eventView(x,true)),nextBefore:rows.length>100?encodeCursor({at:rows[99].at,id:rows[99]._id}):null};
}
