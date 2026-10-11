"use client";
import {useState,type InputHTMLAttributes} from 'react';
import {Eye,EyeOff} from 'lucide-react';
export function PasswordInput(props:Omit<InputHTMLAttributes<HTMLInputElement>,'type'>){const [visible,setVisible]=useState(false);return <div className="input-with-button"><input {...props} type={visible?'text':'password'}/><button type="button" className="icon-btn" aria-label={visible?'Hide password':'Show password'} aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={17}/>:<Eye size={17}/>}</button></div>;}
