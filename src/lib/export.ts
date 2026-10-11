import ExcelJS from 'exceljs';
import type {Actor,LeadDoc} from './domain/types.ts';
import {listLeads,patientOf} from './leads.ts';
import {collections,actor} from './db.ts';
import {csvSafe} from './search.ts';
import {audit,eventView} from './audit.ts';
import {assert} from './domain/errors.ts';
import {isManagement,activeActor} from './domain/policy.ts';
import {EXPORT_COLUMNS,exportValues} from './domain/export-fields.ts';
import {unseal} from './crypto.ts';
export async function exportLeads(u:Actor,url:URL){
 assert(activeActor(u)&&isManagement(u),403,'FORBIDDEN','Only enrolled Management/Admin can export lead data.');
 const format=url.searchParams.get('format')||'csv';assert(['csv','xlsx'].includes(format),400,'INVALID_FORMAT','Choose CSV or XLSX.');
 url.searchParams.set('limit',String(Math.min(Number(url.searchParams.get('limit'))||1000,1000)));url.searchParams.set('includeArchived','1');
 const data=await listLeads(u,url,1000),c=await collections(),ids=data.items.map(x=>x._id);
 const docs=await c.leads.find({_id:{$in:ids}}).toArray(),byId=new Map<string,LeadDoc>(docs.map(d=>[d._id,d] as [string,LeadDoc]));
 const userIds=[...new Set(docs.flatMap(d=>[d.createdBy,d.assignedTo,d.completedAgentId].filter(Boolean) as string[]))],people=await c.users.find({_id:{$in:userIds}}).toArray(),users=new Map(people.map(x=>[x._id,actor(x)]));
 const [events,activities,files]=await Promise.all([c.events.find({leadId:{$in:ids}}).limit(10001).toArray(),c.activities.find({leadId:{$in:ids}}).limit(10001).toArray(),c.files.find({leadId:{$in:ids},status:{$nin:['DELETED','PURGED']}}).limit(10001).toArray()]);
 assert(Math.max(events.length,activities.length,files.length)<=10000,413,'EXPORT_DETAIL_LIMIT','This selection has too much history for one request. Export fewer records per page; no records have been silently omitted.');
 const histories=events.map(x=>eventView(x,true)),notes=activities.map(({dataSealed,...x})=>({...x,data:unseal(dataSealed,`activity:${x._id}`)})),attachments=files.map(({key,versionId,scanLeaseToken,scanLeaseUntil,...x})=>x);
 const rows=ids.map(id=>{const l=byId.get(id);assert(l,409,'EXPORT_CHANGED','A record was deleted during export. Retry the request.');return exportValues(l,patientOf(l),users.get(l.createdBy),users.get(l.assignedTo||''));});
 const headers:Record<string,string>={'Cache-Control':'no-store, private','X-Exported-Rows':String(rows.length),'X-Export-Has-More':String(!!data.nextCursor),...(data.nextCursor?{'X-Next-Cursor':data.nextCursor}:{})};
 await audit(u,'LEADS_EXPORTED',{count:rows.length,format,identifiers:'full-authorized',hasMore:!!data.nextCursor});
 if(format==='xlsx'){
  const book=new ExcelJS.Workbook();book.creator='Cloud Nest BPO';
  function add(name:string,cols:string[],values:string[][]){const sheet=book.addWorksheet(name);sheet.addRow(cols);for(const row of values){assert(row.every(x=>x.length<=32767),413,'EXCEL_CELL_LIMIT','A history field exceeds Excel limits. Use CSV instead.');sheet.addRow(row.map(csvSafe));}sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];sheet.columns.forEach(x=>x.width=22);}
  add('Leads',EXPORT_COLUMNS,rows);add('History',['Lead ID','Action','User','Special ID','Designation','Date/time','Details'],histories.map(x=>[x.leadId||'',x.action,x.actorName,x.actorSpecialId||'',x.actorDesignation||'',x.at,JSON.stringify(x.data ?? {})]));
  add('Activities',['Lead ID','Type','User','Date/time','Details'],notes.map(x=>[x.leadId,x.kind,x.actorName,x.at,JSON.stringify(x.data ?? {})]));
  add('Attachments',['Lead ID','Name','Type','Status','Uploaded by','Date/time','File ID'],attachments.map(x=>[x.leadId,x.name,x.type,x.status,x.uploadedByName,x.createdAt,x._id]));
  const b=await book.xlsx.writeBuffer();return new Response(new Uint8Array(b),{headers:{...headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="cloud-nest-bpo-leads.xlsx"'}});
 }
 const cols=[...EXPORT_COLUMNS,'History JSON','Activities JSON','Attachments JSON'];
 const lines=rows.map((row,i)=>[...row,JSON.stringify(histories.filter(x=>x.leadId===ids[i])),JSON.stringify(notes.filter(x=>x.leadId===ids[i])),JSON.stringify(attachments.filter(x=>x.leadId===ids[i]))]);
 const csv=[cols,...lines].map(row=>row.map(x=>'"'+csvSafe(x).replaceAll('"','""')+'"').join(',')).join('\r\n');
 return new Response('\uFEFF'+csv,{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="cloud-nest-bpo-leads.csv"'}});
}
