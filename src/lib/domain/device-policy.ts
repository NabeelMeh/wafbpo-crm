export const DEVICE_CODE_ATTEMPTS=5;
export const DEVICE_CODE_TTL_MS=5*60*1000;
// Sliding window refreshed on every login; 400 days is the browser cookie lifetime cap.
export const TRUSTED_DEVICE_TTL_MS=400*24*60*60*1000;
export function validDeviceToken(value:unknown):value is string{return typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);}
/** attempts is the already atomically incremented attempt count. */
export function verificationAllowed(c:{attempts:number;expiresAt:Date;sessionVersion:number},sessionVersion:number,now=Date.now()){
 return c.attempts>=1&&c.attempts<=DEVICE_CODE_ATTEMPTS&&c.expiresAt.getTime()>now&&c.sessionVersion===sessionVersion;
}
