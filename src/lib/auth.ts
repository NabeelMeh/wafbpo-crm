import { randomBytes, randomInt } from "node:crypto";
import { actor, collections, type UserDoc, type SessionDoc, transaction } from "./db.ts";
import { AppError, assert } from "./domain/errors.ts";
import { record, text, onlyKeys, passwordPolicy } from "./domain/validation.ts";
import { isManagement } from "./domain/policy.ts";
import { blind, digest, hashPassword, verifyPassword, unseal, seal, newTotpSecret, verifyTotp, sameSecret } from "./crypto.ts";
import { audit } from "./audit.ts";
import { DEVICE_CODE_ATTEMPTS, DEVICE_CODE_TTL_MS, TRUSTED_DEVICE_TTL_MS, validDeviceToken, verificationAllowed } from "./domain/device-policy.ts";
import { securityEvent, requestInfo } from "./security-events.ts";
import { sendSecurityCode } from "./email.ts";
const DEVICE_VERIFICATION_EMAIL = "cloudnestbpo@gmail.com";
export const cookieName = () => process.env.NODE_ENV === "production" ? "__Host-cloudnest_session" : "cloudnest_session";
const maxAge = 8 * 60 * 60, idleMs = 30 * 60 * 1000;
export function sessionCookie(token: string, clear = false): string {
    return `${cookieName()}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
function cookie(req: Request): string | null {
    const part = req.headers.get("cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith(`${cookieName()}=`));
    return part ? part.slice(cookieName().length + 1) : null;
}
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
    const now = Date.now(), window = Math.floor(now / (windowSeconds * 1000)), c = await collections();
    const id = blind(`rate:${key}:${window}`);
    let row;
    try {
        row = await c.rateLimits.findOneAndUpdate({ _id: id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * windowSeconds * 1000) } }, { upsert: true, returnDocument: "after" });
    }
    catch (e) {
        if ((e as {
            code?: number;
        }).code !== 11000)
            throw e;
        row = await c.rateLimits.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, { returnDocument: "after" });
    }
    assert(row && row.count <= limit, 429, "RATE_LIMITED", "Too many requests. Try again after the rate-limit window.");
}
function rawPassword(v: unknown, name = "password"): string { assert(typeof v === "string" && v.length <= 128, 400, "INVALID_INPUT", `Invalid ${name}.`); return v; }
export async function consumeMfa(user: UserDoc, code: string): Promise<boolean> {
    const c = await collections();
    if (!user.mfaEnabled || !user.mfaSecretSealed)
        return false;
    const recovery = digest(code.trim().toUpperCase());
    if (user.recoveryHashes?.includes(recovery))
        return !!await c.users.findOneAndUpdate({ _id: user._id, recoveryHashes: recovery }, { $pull: { recoveryHashes: recovery } });
    const secret = unseal<string>(user.mfaSecretSealed, `mfa:${user._id}`), step = verifyTotp(secret, code, Date.now(), user.mfaLastStep ?? -1);
    if (step === null)
        return false;
    return !!await c.users.findOneAndUpdate({ _id: user._id, $or: [{ mfaLastStep: { $lt: step } }, { mfaLastStep: { $exists: false } }] }, { $set: { mfaLastStep: step } });
}
export const deviceCookieName = () => process.env.NODE_ENV === "production" ? "__Host-cloudnest_device" : "cloudnest_device";
function readDevice(req:Request):string|null { const part=req.headers.get("cookie")?.split(";").map(x=>x.trim()).find(x=>x.startsWith(`${deviceCookieName()}=`)); const token=part?.slice(deviceCookieName().length+1);return validDeviceToken(token)?token:null; }
function deviceCookie(token:string){return `${deviceCookieName()}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(TRUSTED_DEVICE_TTL_MS/1000)}${process.env.NODE_ENV==="production"?"; Secure":""}`;}
export type LoginResult={user?:ReturnType<typeof actor>;requiresDeviceVerification?:boolean;challengeId?:string;cookies:string[]};
async function startSession(req:Request,user:UserDoc,mfaVerified:boolean,deviceHash?:string):Promise<LoginResult>{
 const token=randomBytes(32).toString("base64url"),now=new Date(),c=await collections(),info=requestInfo(req);
 await transaction(async s=>{
  const current=await c.users.findOne({_id:user._id,accountStatus:"ACTIVE",enrollmentStatus:{$ne:"NOT_ENROLLED"},sessionVersion:user.sessionVersion},{session:s});
  assert(current,401,"SESSION_REVOKED","Your access changed. Sign in again.");
  if(deviceHash){const trust=await c.trustedDevices.findOneAndUpdate({userId:user._id,deviceHash,revokedAt:{$exists:false},expiresAt:{$gt:new Date()}},{$set:{lastUsedAt:now.toISOString()}},{session:s,returnDocument:"after"});assert(trust,401,"DEVICE_REVOKED","Device approval expired or was revoked. Sign in again.");}
  await c.users.updateOne({_id:user._id,sessionVersion:user.sessionVersion},{$set:{lastLoginAt:now.toISOString(),lastSeenAt:now.toISOString(),lastActivityAt:now.toISOString()}},{session:s});
  await c.sessions.insertOne({_id:digest(token),userId:user._id,mfaVerified,version:user.sessionVersion,deviceHash,...info,expiresAt:new Date(now.getTime()+maxAge*1000),idleExpiresAt:new Date(now.getTime()+idleMs),lastInputAt:now,createdAt:now},{session:s});
  await securityEvent(actor(current),"LOGIN",{...info,sessionReference:digest(token).slice(0,12),trustedDevice:!!deviceHash},s);
 });
 return {user:actor(user),cookies:[sessionCookie(token)]};
}
export async function login(req:Request,raw:unknown):Promise<LoginResult>{
 const r=record(raw);onlyKeys(r,["username","password","otp"]);
 const identifier=text(r.username,"Username or special ID",60,true),username=identifier.toLowerCase(),password=rawPassword(r.password),info=requestInfo(req);
 await rateLimit(`login-ip:${info.ip}`,30,900);await rateLimit(`login-user:${username}`,10,900);
 const c=await collections(),user=await c.users.findOne({$or:[{username},{employeeIdNormalized:username},{employeeId:identifier}]});
 const valid=user?await verifyPassword(password,user.passwordHash):!!(await hashPassword(password))&&false;
 assert(valid&&user&&user.accountStatus==="ACTIVE"&&user.enrollmentStatus!=="NOT_ENROLLED",401,"INVALID_CREDENTIALS","Invalid credentials, verification code, or inactive account.");
 if(isManagement(actor(user)))return startSession(req,user,true);
 if(user.mfaEnabled)assert(await consumeMfa(user,text(r.otp,"Verification code",40)),401,"INVALID_CREDENTIALS","Invalid credentials, verification code, or inactive account.");
 const token=readDevice(req)||randomBytes(32).toString("base64url"),deviceHash=blind(`device:${token}`),now=new Date();
 const trusted=await c.trustedDevices.findOne({userId:user._id,deviceHash,expiresAt:{$gt:now},revokedAt:{$exists:false}});
 if(trusted){await c.trustedDevices.updateOne({_id:trusted._id},{$set:{lastUsedAt:now.toISOString(),sessionVersion:user.sessionVersion,expiresAt:new Date(now.getTime()+TRUSTED_DEVICE_TTL_MS)}});const result=await startSession(req,user,user.mfaEnabled,deviceHash);result.cookies.push(deviceCookie(token));return result;}
 await rateLimit(`device-email:${user._id}`,3,900);
 const challengeId=randomBytes(32).toString("base64url"),id=digest(challengeId),code=String(randomInt(0,1000000)).padStart(6,"0");
 await c.deviceChallenges.deleteMany({userId:user._id,deviceHash});
 await c.deviceChallenges.insertOne({_id:id,userId:user._id,deviceHash,codeHash:blind(`device-code:${id}:${code}`),attempts:0,sessionVersion:user.sessionVersion,mfaVerified:user.mfaEnabled,expiresAt:new Date(now.getTime()+DEVICE_CODE_TTL_MS),createdAt:now.toISOString()});
 try{await sendSecurityCode(DEVICE_VERIFICATION_EMAIL,code,user);}catch{await c.deviceChallenges.deleteOne({_id:id});throw new AppError(503,"EMAIL_DELIVERY_FAILED","Security verification could not be delivered. Contact Management.");}
 return {requiresDeviceVerification:true,challengeId,cookies:[deviceCookie(token)]};
}
export async function verifyDevice(req:Request,raw:unknown):Promise<LoginResult>{
 const r=record(raw);onlyKeys(r,["challengeId","code"]);const token=readDevice(req),challenge=text(r.challengeId,"Challenge",100,true),code=text(r.code,"Code",6,true),now=new Date(),c=await collections();
 assert(token&&validDeviceToken(challenge)&&/^\d{6}$/.test(code),401,"INVALID_CODE","Verification failed or expired. Sign in again.");
 await rateLimit(`device-verify:${requestInfo(req).ip}`,30,900);
 const id=digest(challenge),deviceHash=blind(`device:${token}`);
 const item=await c.deviceChallenges.findOneAndUpdate({_id:id,deviceHash,expiresAt:{$gt:now},attempts:{$lt:DEVICE_CODE_ATTEMPTS}},{$inc:{attempts:1}},{returnDocument:"after"});
 assert(item,401,"INVALID_CODE","Verification failed or expired. Sign in again.");
 const user=await c.users.findOne({_id:item.userId});
 if(!user||!verificationAllowed(item,user.sessionVersion)||user.accountStatus!=="ACTIVE"||user.enrollmentStatus==="NOT_ENROLLED"||!sameSecret(item.codeHash,blind(`device-code:${id}:${code}`))){
  if(user)await audit(actor(user),"DEVICE_VERIFICATION_FAILED",{...requestInfo(req),attempt:item.attempts});
  throw new AppError(401,"INVALID_CODE","Verification failed or expired. Sign in again.");
 }
 // Consume atomically before trusting. A replay cannot establish another device/session.
 const consumed=await c.deviceChallenges.findOneAndDelete({_id:id,deviceHash,codeHash:item.codeHash,expiresAt:{$gt:new Date()}});
 assert(consumed,401,"INVALID_CODE","Verification already used or expired.");
 await c.trustedDevices.updateOne({userId:user._id,deviceHash},{$set:{sessionVersion:user.sessionVersion,lastUsedAt:now.toISOString(),expiresAt:new Date(now.getTime()+TRUSTED_DEVICE_TTL_MS),userAgent:requestInfo(req).userAgent},$setOnInsert:{_id:randomBytes(24).toString("hex"),userId:user._id,deviceHash,createdAt:now.toISOString()},$unset:{revokedAt:""}},{upsert:true});
 const result=await startSession(req,user,item.mfaVerified,deviceHash);result.cookies.push(deviceCookie(token));
 await securityEvent(actor(user),"DEVICE_VERIFIED",requestInfo(req));return result;
}
export async function authenticate(req: Request, allowSetup = false): Promise<{
    user: UserDoc;
    session: SessionDoc;
}> {
    const token = cookie(req);
    assert(token && token.length <= 200, 401, "UNAUTHENTICATED", "Sign in to continue.");
    const c = await collections(), now = new Date();
    const session = await c.sessions.findOne({ _id: digest(token), expiresAt: { $gt: now }, idleExpiresAt: { $gt: now } });
    assert(session, 401, "SESSION_EXPIRED", "Your session expired. Sign in again.");
    const user = await c.users.findOne({ _id: session.userId });
    assert(user && user.accountStatus === "ACTIVE" && (user.enrollmentStatus || "ENROLLED") === "ENROLLED" && user.sessionVersion === session.version, 401, "SESSION_REVOKED", "Your access has changed. Sign in again or contact Management.");
    if (!allowSetup) {
        assert(!user.mfaEnabled || isManagement(actor(user)) || session.mfaVerified === true, 403, "MFA_REAUTH_REQUIRED", "MFA is now enabled. Save your recovery codes, then sign out and sign in again with a verification code.");
        assert(!user.mustChangePassword, 403, "PASSWORD_CHANGE_REQUIRED", "Change your temporary password in Security before using the CRM.");
    }
    if (req.headers.get("x-user-activity") === "1") {
        await c.sessions.updateOne({ _id: session._id }, { $set: { lastInputAt: now, idleExpiresAt: new Date(now.getTime() + idleMs) } });
        await c.users.updateOne({ _id: user._id }, { $max: { lastActivityAt: now.toISOString() } });
    }
    return { user, session };
}
export async function logout(req:Request){
 const token=cookie(req);if(token){const c=await collections();await transaction(async s=>{
  const session=await c.sessions.findOneAndDelete({_id:digest(token)},{session:s});
  if(session){const user=await c.users.findOne({_id:session.userId},{session:s});if(user)await securityEvent(actor(user),"LOGOUT",{...requestInfo(req),sessionReference:session._id.slice(0,12)},s);}
 });}return sessionCookie("",true);
}
export async function heartbeat(req: Request, raw: unknown) {
    const { user, session } = await authenticate(req, true), r = record(raw), c = await collections(), now = new Date();
    const ms = Number(r.lastInputAt);
    assert(Number.isFinite(ms) && ms <= now.getTime() + 5000, 400, "INVALID_INPUT", "Invalid activity time.");
    const at = new Date(Math.min(ms, now.getTime()));
    await c.users.updateOne({ _id: user._id }, { $set: { lastSeenAt: now.toISOString(), visible: r.visible === true }, $max: { lastActivityAt: at.toISOString() } });
    if (at > session.lastInputAt && now.getTime() - at.getTime() < idleMs)
        await c.sessions.updateOne({ _id: session._id }, { $max: { lastInputAt: at, idleExpiresAt: new Date(at.getTime() + idleMs) } });
    return { ok: true };
}
export async function changePassword(user: UserDoc, raw: unknown) {
    const r = record(raw), old = rawPassword(r.currentPassword), pw = rawPassword(r.newPassword);
    passwordPolicy(pw);
    assert(await verifyPassword(old, user.passwordHash), 400, "INVALID_PASSWORD", "The current password is incorrect.");
    assert(old !== pw, 400, "UNCHANGED_PASSWORD", "Choose a different password.");
    const c = await collections();
    await c.users.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(pw), mustChangePassword: false, updatedAt: new Date().toISOString() }, $inc: { sessionVersion: 1 } });
    await audit(actor(user), "PASSWORD_CHANGED", {});
    return { ok: true, cookie: sessionCookie("", true) };
}
export async function mfaBegin(user: UserDoc, raw: unknown) {
    const r = record(raw);
    assert(!isManagement(actor(user)), 400, "MFA_NOT_USED", "Admin and Management accounts do not use authenticator codes.");
    assert(!user.mfaEnabled, 409, "MFA_ENABLED", "Two-factor authentication is already enabled.");
    assert(await verifyPassword(rawPassword(r.password), user.passwordHash), 400, "INVALID_PASSWORD", "Incorrect password.");
    const secret = newTotpSecret(), c = await collections();
    await c.users.updateOne({ _id: user._id }, { $set: { mfaPendingSealed: seal(secret, `mfa-pending:${user._id}`), mfaPendingExpiresAt: new Date(Date.now() + 10 * 60000) } });
    return { secret, uri: `otpauth://totp/${encodeURIComponent("CLOUD NEST BPO:" + user.username)}?secret=${secret}&issuer=Cloud%20Nest%20BPO&algorithm=SHA1&digits=6&period=30` };
}
export async function mfaConfirm(user: UserDoc, raw: unknown) {
    const r = record(raw);
    assert(user.mfaPendingSealed && user.mfaPendingExpiresAt && user.mfaPendingExpiresAt > new Date(), 400, "MFA_SETUP_EXPIRED", "Start two-factor setup again.");
    const secret = unseal<string>(user.mfaPendingSealed, `mfa-pending:${user._id}`), step = verifyTotp(secret, text(r.code, "Code", 6, true));
    assert(step !== null, 400, "INVALID_CODE", "The authenticator code is incorrect.");
    const recoveryCodes = Array.from({ length: 8 }, () => randomBytes(8).toString("hex").toUpperCase()), c = await collections();
    const confirmed = await c.users.updateOne({ _id: user._id, mfaEnabled: false, mfaPendingSealed: user.mfaPendingSealed }, { $set: { mfaEnabled: true, mfaSecretSealed: seal(secret, `mfa:${user._id}`), mfaLastStep: step, recoveryHashes: recoveryCodes.map(digest) }, $unset: { mfaPendingSealed: "", mfaPendingExpiresAt: "" } });
    assert(confirmed.modifiedCount, 409, "MFA_SETUP_CHANGED", "MFA setup changed or was already confirmed. Sign in again to verify your settings.");
    await audit(actor(user), "MFA_ENABLED", {});
    return { recoveryCodes };
}
export async function mfaDisable(user: UserDoc, raw: unknown) {
    const r = record(raw);
    assert(await verifyPassword(rawPassword(r.password), user.passwordHash), 400, "INVALID_PASSWORD", "Incorrect password.");
    assert(await consumeMfa(user, text(r.code, "Code", 40, true)), 400, "INVALID_CODE", "Incorrect verification code.");
    const c = await collections();
    await c.users.updateOne({ _id: user._id }, { $set: { mfaEnabled: false }, $unset: { mfaSecretSealed: "", mfaLastStep: "", recoveryHashes: "" }, $inc: { sessionVersion: 1 } });
    await audit(actor(user), "MFA_DISABLED", {});
    return { ok: true };
}
