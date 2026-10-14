/** Independent acceptance regressions. Synthetic data only; no external services are mocked as passing. */
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { transition } from "../src/lib/domain/workflow.ts";
import { assertCreate, canReadLead, canEditDoctor, canEditPatient, canDelete, actionVisible, claimIsActive, ownsClaim, reopenDestination, isManagement, leadScope } from "../src/lib/domain/policy.ts";
import { EMPTY_PATIENT, EMPTY_DOCTOR } from "../src/lib/domain/types.ts";
import type { Actor, LeadDoc, LeadCore, WorkDepartment, Action } from "../src/lib/domain/types.ts";
import { FILE_TYPES, validateFileMetadata } from "../src/lib/domain/file-policy.ts";
import { inspectFile } from "../src/lib/file-inspection.ts";
import { DEVICE_CODE_ATTEMPTS, DEVICE_CODE_TTL_MS, validDeviceToken, verificationAllowed } from "../src/lib/domain/device-policy.ts";
import { EXPORT_COLUMNS, exportValues } from "../src/lib/domain/export-fields.ts";
import { csvSafe } from "../src/lib/search.ts";
const person = (id: string, dept: WorkDepartment, head=false): Actor => ({ id, name:`Synthetic ${id}`, username:id, employeeId:`ID-${id}`, designation:head?"Head":"Agent", role:"STAFF", memberships:[{department:dept,kind:head?"HEAD":"AGENT"}], enrollmentStatus:"ENROLLED",accountStatus:"ACTIVE",mfaEnabled:false,mustChangePassword:false });
const gen=person("g","GENERATION"), qa=person("q","QA"), other=person("q2","QA"), qh=person("qh","QA",true), ch=person("ch","CHASING",true), pv=person("pv","PV",true);
const admin: Actor={...gen,id:"admin",role:"ADMIN",memberships:[]}, mg:Actor={...admin,id:"manager",role:"MANAGEMENT"};
const make=(p:Partial<LeadCore>={}):LeadCore=>({_id:"synthetic",code:"WAF-2026-000042",department:"GENERATION",status:"DRAFT",origin:"GENERATION",createdBy:gen.id,assignedTo:gen.id,version:1,submissionVersion:0,campaign:"",batch:"",createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z",...p});
const step=(u:Actor,l:LeadCore,action:Action,extra:Record<string,unknown>={})=>transition(u,l,{action,version:l.version,...extra});
const intake=()=>make({department:"QA",status:"QA_REVIEW",assignedTo:null});
const claimed=()=>step(qa,intake(),"CLAIM");

test("R1: Admin and Management may assign directly into PV",()=>{for(const u of [admin,mg]) assert.doesNotThrow(()=>assertCreate(u,"PV"));});
test("R2: approved Chasing lead cannot be reopened into PV",()=>{const l=make({department:"MANAGEMENT",status:"MANAGEMENT_REVIEW",completedSource:"CHASING"});assert.throws(()=>step(admin,l,"REOPEN",{destination:"PV",reason:"Audit check",comment:"Synthetic"}));assert.equal(step(admin,l,"REOPEN",{reason:"Audit check",comment:"Synthetic"}).department,"CHASING");});
test("R3: claimed QA lead remains readable to every authorized QA colleague",()=>{for(const u of [qa,other,qh,admin,mg])assert.equal(canReadLead(u,claimed()),true);});
test("R4: no QA actor can edit unclaimed patient or doctor data",()=>{for(const u of [qa,other,qh,admin,mg]){assert.equal(canEditPatient(u,intake()),false);assert.equal(canEditDoctor(u,intake()),false);}});
test("R5: legacy Generation-head rework resubmits directly to QA",()=>{const l=make({status:"REWORK_REQUIRED",reworkFrom:"GENERATION",submissionVersion:3});const n=step(gen,l,"RESUBMIT");assert.equal(n.department,"QA");assert.equal(n.status,"QA_REVIEW");assert.equal(n.submissionVersion,4);});
for(const outcome of ["COMPLETE","DENY"] as const)test(`Exact route, old queue access lost, immutable lead ID: ${outcome}`,()=>{
 let l=step(gen,make(),"SUBMIT");assert.equal(l.department,"QA");assert.equal(canReadLead(gen,l),false);l=step(qa,l,"CLAIM");l=step(qa,l,"QA_GOOD");assert.equal(l.department,"CHASING");assert.equal(canReadLead(qa,l),false);l=step(ch,l,outcome,{reason:"Synthetic denied result"});
 if(outcome==="DENY"){assert.equal(l.department,"PV");assert.equal(l.chasingDeniedBy,ch.id);assert.equal(canReadLead(ch,l),false);l=step(pv,l,"COMPLETE");assert.equal(canReadLead(pv,l),false);assert.equal(l.completedSource,"PV");}else{assert.equal(l.completedSource,"CHASING");assert.equal(l.chasingDeniedAt,undefined);}
 assert.equal(l.department,"MANAGEMENT");assert.equal(l.code,"WAF-2026-000042");assert.equal(l.claim,null);assert.equal(l.assignedTo,null);
});
test("Only Chasing denial can establish PV provenance",()=>{for(const action of ["COMPLETE","DENY","INCOMPLETE"] as const)assert.equal(actionVisible(pv,make({department:"PV",status:"PV_ACTIVE"}),action),false);});
test("Legacy invalid PV is quarantined for Management, then reopens into Chasing",()=>{const l=make({department:"MANAGEMENT",status:"MIGRATION_REVIEW",legacyRoutingReview:true,origin:"PV"});assert.equal(reopenDestination(l),"CHASING");assert.equal(step(admin,l,"REOPEN",{reason:"Legacy routing",comment:"Review required"}).department,"CHASING");});
test("Legacy manual movement actions are unavailable, including to Admin",()=>{for(const a of ["ROUTE_PV","APPROVE_GENERATION","RETURN_GENERATION"] as const)assert.equal(actionVisible(admin,make({status:"GENERATION_REVIEW"}),a),false);});
test("Only the live claim holder can mutate QA",()=>{const l=claimed();assert.equal(canEditPatient(qa,l),true);for(const u of [other,qh,admin,mg]){assert.equal(canEditPatient(u,l),false);assert.equal(canEditDoctor(u,l),false);assert.throws(()=>step(u,l,"QA_GOOD"));}});
test("Expired claims confer no mutation rights and can be taken over",()=>{const l={...claimed(),claim:{...claimed().claim!,expiresAt:new Date(Date.now()-1).toISOString()}};assert.equal(claimIsActive(l),false);assert.equal(ownsClaim(qa,l),false);assert.equal(canEditPatient(qa,l),false);assert.equal(step(other,l,"CLAIM").claim?.userId,other.id);});
test("Active claims cannot be stolen or silently reassigned",()=>{const l=claimed();for(const u of [other,qh,admin]){assert.throws(()=>step(u,l,"CLAIM"));assert.throws(()=>step(u,l,"ASSIGN",{assigneeId:other.id}));}});
test("Head override release requires a reason",()=>{assert.throws(()=>step(qh,claimed(),"RELEASE"));assert.equal(step(qh,claimed(),"RELEASE",{reason:"Agent unavailable"}).claim,null);assert.throws(()=>step(other,claimed(),"RELEASE",{reason:"Not permitted"}));});
test("Claims are bounded to five minutes",()=>{const now=new Date("2026-10-08T00:00:00Z");const n=transition(qa,intake(),{action:"CLAIM",version:1},now);assert.equal(Date.parse(n.claim!.expiresAt)-now.getTime(),300000);});
test("Workflow rejects stale versions before any mutation",()=>{assert.throws(()=>transition(qa,claimed(),{action:"QA_GOOD",version:999}));});
test("Claim releases on BAD as well as GOOD",()=>{const n=step(qa,claimed(),"QA_BAD",{reason:"Correction",comment:"Synthetic correction"});assert.equal(n.claim,null);assert.equal(n.assignedTo,gen.id);assert.equal(n.department,"GENERATION");});
for(const role of ["STAFF","MANAGEMENT","ADMIN","SUPER_ADMIN"] as const)test(`NOT_ENROLLED blocks record access for ${role}`,()=>{const u={...qa,role,enrollmentStatus:"NOT_ENROLLED" as const};assert.equal(canReadLead(u,intake()),false);assert.equal(canEditDoctor(u,intake()),false);});
test("Shared QA query does not limit access to current assignee",()=>{const scope=JSON.stringify(leadScope(other,"QA"));assert.match(scope,/QA_REVIEW/);});
test("Administrative exports are role-specific, not equivalent to Head access",()=>{assert.equal(isManagement(qh),false);assert.equal(isManagement(qa),false);assert.equal(isManagement(mg),true);assert.equal(isManagement(admin),true);});
test("Delete grants never remove row-level authorization",()=>{assert.equal(canDelete(gen,make()),false);assert.equal(canDelete({...gen,deletionGranted:true},make()),true);assert.equal(canDelete({...gen,deletionGranted:true},intake()),false);assert.equal(canDelete(mg,intake()),true);});
for(const [ext,rule] of Object.entries(FILE_TYPES))test(`File allowlist canonicalizes ${ext} without trusting browser MIME`,()=>{const m=validateFileMetadata(`Synthetic.${ext}`,"",100);assert.equal(m.type,rule.mime);assert.equal(m.kind,rule.kind);assert.throws(()=>validateFileMetadata(`Synthetic.${ext}`,rule.mime,(rule.maxMB*1024*1024)+1));});
for(const name of ["payload.exe","image.svg","macro.docm","sheet.xlsm","../record.pdf","C:\\record.pdf",".hidden.pdf","x\u0000.pdf","x.php"])test(`File metadata rejects unsafe name ${JSON.stringify(name)}`,()=>assert.throws(()=>validateFileMetadata(name,"",100)));
test("File validation rejects MIME mismatch, zero, fractional and unsafe sizes",()=>{assert.throws(()=>validateFileMetadata("x.pdf","audio/mpeg",10));for(const n of [0,-1,1.2,Number.NaN,Number.MAX_VALUE])assert.throws(()=>validateFileMetadata("x.pdf","",n));});
test("Logo intake is raster-only and limited to 2 MB",()=>{assert.throws(()=>validateFileMetadata("x.pdf","",10,true));assert.throws(()=>validateFileMetadata("x.png","",2*1024*1024+1,true));assert.equal(validateFileMetadata("x.png","",100,true).kind,"LOGO");});
test("Text pretending to be a PDF fails content inspection",()=>assert.equal(inspectFile("x.pdf","application/pdf",Buffer.from("MZ this is not a PDF")),false));
test("PDF active content is rejected independently of malware signatures",()=>{assert.equal(inspectFile("x.pdf","",Buffer.from("%PDF-1.7\n/JavaScript alert(1)")),false);assert.equal(inspectFile("x.pdf","",Buffer.from("%PDF-1.7\nSynthetic benign fixture")),true);});
test("UTF-8 business text accepted, null bytes, invalid UTF-8 and HTML rejected",()=>{for(const b of [Buffer.from("name,reference\nSynthetic,TEST-1"),Buffer.from("Plain business note")])assert.equal(inspectFile("x.txt","",b),true);for(const b of [Buffer.from("x\x00y"),Buffer.from([255,255]),Buffer.from("<script>alert(1)</script>")])assert.equal(inspectFile("x.csv","",b),false);});
function office(entries:Record<string,string>,compress=false):Buffer{let offset=0;const locals:Buffer[]=[],central:Buffer[]=[];for(const [name,text]of Object.entries(entries)){const n=Buffer.from(name),b=Buffer.from(text),data=compress?deflateRawSync(b):b,local=Buffer.alloc(30),c=Buffer.alloc(46);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(compress?8:0,8);local.writeUInt32LE(data.length,18);local.writeUInt32LE(b.length,22);local.writeUInt16LE(n.length,26);locals.push(local,n,data);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(compress?8:0,10);c.writeUInt32LE(data.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);offset+=local.length+n.length+data.length;}const cd=Buffer.concat(central),end=Buffer.alloc(22),count=Object.keys(entries).length;end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,cd,end]);}
const doc={"[Content_Types].xml":"<Types/>","word/document.xml":"<document>Synthetic</document>"};
test("OOXML format inspection accepts bounded office packages",()=>{assert.equal(inspectFile("x.docx","",office(doc)),true);assert.equal(inspectFile("x.docx","",office(doc,true)),true);assert.equal(inspectFile("x.xlsx","",office({"[Content_Types].xml":"<Types/>","xl/workbook.xml":"<workbook/>"})),true);});
for(const [label,entries] of Object.entries({traversal:{...doc,"../outside.txt":"bad"},macro:{...doc,"word/vbaProject.bin":"bad"},external:{...doc,"word/_rels/document.xml.rels":'<Relationship TargetMode="External"/>'},entities:{...doc,"word/document.xml":'<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]>'}}))test(`OOXML rejects ${label}`,()=>assert.equal(inspectFile("x.docx","",office(entries)),false));
test("OOXML rejects expansion bombs, truncated data and mismatched content kind",()=>{assert.equal(inspectFile("x.docx","",office({...doc,"word/bomb.xml":"x".repeat(1000000)},true)),false);assert.equal(inspectFile("x.docx","",office(doc).subarray(0,-10)),false);assert.equal(inspectFile("x.xlsx","",office(doc)),false);});
test("OOXML rejects local-directory filename disagreement",()=>{const b=office(doc);b[30]=90;assert.equal(inspectFile("x.docx","",b),false);});
test("Binary extension cannot bypass content checks",()=>{for(const ext of ["png","jpg","webp","mp3","wav","m4a","aac","ogg","webm","doc","xls"])assert.equal(inspectFile(`x.${ext}`,"",Buffer.from("definitely not a valid binary file")),false);});
test("Device cookie accepts 256-bit opaque tokens, not user input identifiers",()=>{assert.equal(validDeviceToken(randomBytes(32).toString("base64url")),true);for(const token of [null,undefined,"", "user-001", "a".repeat(42),"/".repeat(43)])assert.equal(validDeviceToken(token),false);});
test("Device policy uses five-minute TTL and five counted attempts",()=>{assert.equal(DEVICE_CODE_TTL_MS,300000);assert.equal(DEVICE_CODE_ATTEMPTS,5);const c={attempts:5,expiresAt:new Date(1001),sessionVersion:2};assert.equal(verificationAllowed(c,2,1000),true);assert.equal(verificationAllowed({...c,attempts:6},2,1000),false);assert.equal(verificationAllowed(c,2,1001),false);assert.equal(verificationAllowed(c,3,1000),false);});
test("Privileged scalar export contains complete unmasked identifiers and matches its header",()=>{const l:LeadDoc={...make(),doctor:{...EMPTY_DOCTOR,name:"Synthetic doctor"},patientSealed:"never exported ciphertext",searchTokens:[],duplicateKeys:[]};const p={...EMPTY_PATIENT,firstName:"Synthetic",identifier:"TEST-MEDICARE-FULL",memberId:"TEST-MEMBER-FULL"};const values=exportValues(l,p,gen,qa);assert.equal(values.length,EXPORT_COLUMNS.length);assert.equal(values[EXPORT_COLUMNS.indexOf("Medicare/SSN")],p.identifier);assert.equal(values[EXPORT_COLUMNS.indexOf("Member ID")],p.memberId);assert.equal(values[EXPORT_COLUMNS.indexOf("Created by special ID")],gen.employeeId);assert(!values.includes(l.patientSealed));});
for(const text of ["=SUM(A1)","+CMD","-1+2","@SUM(A1)","\t=CMD"])test(`CSV formulas neutralized: ${JSON.stringify(text)}`,()=>assert.notEqual(csvSafe(text),text));

test("Part 4: only Management/Admin pass the bulk-delete and outsourcing gate", () => {
  for (const s of [gen, qa, qh, ch, pv]) assert.equal(isManagement(s), false, `${s.id} must not reach admin tools`);
  assert.equal(isManagement(admin), true); assert.equal(isManagement(mg), true);
});
test("Part 4: staff without explicit grant cannot delete leads, even their own", () => {
  const lead = make() as LeadDoc;
  for (const s of [gen, qa, qh, ch, pv]) assert.equal(canDelete(s, lead), false);
  assert.equal(canDelete(admin, lead), true); assert.equal(canDelete(mg, lead), true);
});
test("Part 4: outsourcing targets are exactly Chasing, PV, and both", async () => {
  const { OUTSOURCE_TARGETS } = await import("../src/lib/domain/types.ts");
  assert.deepEqual([...OUTSOURCE_TARGETS], ["CHASING", "PV", "BOTH"]);
});
