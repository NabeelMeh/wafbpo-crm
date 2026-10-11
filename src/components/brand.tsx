"use client";
import {useEffect,useState} from 'react';
import {Cloud} from 'lucide-react';
/** Public response contains only display branding, never security-email settings. */
export function Brand(){
 const [logo,setLogo]=useState<string|null>(null);
 useEffect(()=>{let live=true;const refresh=async()=>{try{const r=await fetch('/api/branding',{cache:'no-store'});if(r.ok){const b=await r.json();if(live)setLogo(b.logoUrl||null);}}catch{}};void refresh();const timer=setInterval(refresh,10000);window.addEventListener('branding-updated',refresh);return()=>{live=false;clearInterval(timer);window.removeEventListener('branding-updated',refresh);};},[]);
 return <>{logo?<img src={logo} alt="Cloud Nest BPO logo" width={40} height={40} style={{objectFit:'contain'}}/>:<span className="brand-mark"><Cloud size={25}/></span>}<span><strong>CLOUD NEST</strong><small>BPO</small></span></>;
}
