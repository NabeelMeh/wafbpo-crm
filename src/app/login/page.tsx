"use client";
import { Brand } from "@/components/brand";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Button, Field, ErrorBox } from "@/components/ui";
import { request } from "@/lib/client";
export default function Login() {
    const router = useRouter(), app = useApp(), [username, setUsername] = useState(""), [password, setPassword] = useState(""), [otp, setOtp] = useState(""), [needOtp, setNeedOtp] = useState(false), [visible, setVisible] = useState(false), [challenge,setChallenge]=useState<string|null>(null), [deviceCode,setDeviceCode]=useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
    useEffect(() => {
        if (app.user)
            router.replace("/dashboard");
    }, [app.user, router]);
    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const result=await request<{requiresOtp?:boolean;requiresDeviceVerification?:boolean;challengeId?:string}>(challenge?"auth/verify-device":"auth/login", { body: challenge?{challengeId:challenge,code:deviceCode}:{ username, password, ...(needOtp ? { otp } : {}) } });
            if(result.requiresOtp){setNeedOtp(true);return;}
            if(result.requiresDeviceVerification&&result.challengeId){setChallenge(result.challengeId);setPassword("");return;}
            await app.refreshUser();
            router.replace("/dashboard");
        }
        catch (e) {
            setError(e);
        }
        finally {
            setBusy(false);
        }
    }
    return <div className="login-page"><section className="login-story"><div className="brand"><Brand/></div><div className="login-story-content"><span className="login-pill">A WORKSPACE BUILT FOR YOUR TEAM</span><h1>Every lead.<br />One accountable<br /><em>workflow.</em></h1><p>From the first conversation to the final review, keep the right work in the right hands.</p><div className="login-pipeline">Generation <ArrowRight size={15}/> Q/A <ArrowRight size={15}/> Chasing <ArrowRight size={15}/> Management / Patient Verification</div><div className="login-features"><span><CheckCircle2 size={18}/> Dedicated department queues</span><span><CheckCircle2 size={18}/> Live incoming-lead alerts</span><span><CheckCircle2 size={18}/> Complete record history</span></div></div><div className="login-story-footer">CLOUD NEST BPO <span>OPERATIONS CRM</span></div></section><section className="login-form-wrap"><div className="login-form"><span className="login-lock"><ShieldCheck size={24}/></span><div className="eyebrow">YOUR WORKSPACE, CONNECTED</div><h2>Welcome back.</h2><p>Sign in with the account provided by Management.</p><ErrorBox error={error || app.sessionError}/><form onSubmit={submit}>{challenge ? <><div className="notice">This device needs approval. Ask Management for the verification code. It expires in five minutes.</div><Field label="Device verification code" required><input required autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={deviceCode} onChange={e=>setDeviceCode(e.target.value)}/></Field><Button type="button" variant="ghost" onClick={()=>{setChallenge(null);setDeviceCode("");}}>Back to sign in</Button></> : <><Field label="Username or special ID" required><input autoComplete="username" autoFocus required value={username} onChange={e => setUsername(e.target.value)} placeholder="Your username"/></Field><Field label="Password" required><div className="input-with-button"><input autoComplete="current-password" type={visible ? "text" : "password"} required value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password"/><button type="button" className="icon-btn" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></Field>{needOtp && <Field label="Authenticator or recovery code" required hint="Your account has two-factor authentication enabled."><input required autoFocus autoComplete="one-time-code" value={otp} onChange={e => setOtp(e.target.value)} placeholder="6-digit code or recovery code"/></Field>}</>}<Button className="login-submit" type="submit" busy={busy}>{challenge?"Verify this device":"Sign in to workspace"}<ArrowRight size={18}/></Button></form><div className="login-help">Need an account or a password reset?<br /><strong>Contact your department head or Management.</strong></div><small className="login-disclaimer">Authorized personnel only. Workspace activity is audited.</small></div></section></div>;
}
