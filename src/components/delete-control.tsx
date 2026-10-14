"use client";
import {useState} from 'react';
import {Button,Field,Modal,ErrorBox} from './ui';
import {request} from '@/lib/client';
export function DeleteControl({endpoint,reference,version,onDeleted}:{endpoint:string;reference:string;version?:number;onDeleted:()=>void}){
 const [open,setOpen]=useState(false),[confirmation,setConfirmation]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
 async function remove(e:React.FormEvent){e.preventDefault();setBusy(true);setError(null);try{await request(endpoint,{method:'DELETE',body:{confirmation,reason,...(version===undefined?{}:{version})},activity:true});onDeleted();setOpen(false);}catch(e){setError(e);}finally{setBusy(false);}}
 return <><Button variant="danger" onClick={()=>setOpen(true)}>Delete</Button>{open&&<Modal title="Confirm permanent deletion" onClose={()=>{if(!busy)setOpen(false);}}><form onSubmit={remove}><p>This removes the record from active access. Audit history is retained. Stored files are queued for permanent removal by the purge worker.</p><ErrorBox error={error}/><Field label={`Type ${reference} to confirm`} required><input required value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off"/></Field><Field label="Deletion reason" required><textarea required minLength={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></Field><div className="form-actions"><Button type="button" variant="secondary" onClick={()=>setOpen(false)}>Cancel</Button><Button variant="danger" type="submit" busy={busy} disabled={confirmation!==reference||reason.trim().length<3}>Permanently delete</Button></div></form></Modal>}</>;
}
