"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Button, Field, ErrorBox } from "@/components/ui";
import { request } from "@/lib/client";
export default function Login() {
    const router = useRouter(), app = useApp(), [username, setUsername] = useState(""), [password, setPassword] = useState(""), [visible, setVisible] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
    useEffect(() => {
        if (app.user)
            router.replace(app.user.mustChangePassword ? "/settings" : "/dashboard");
    }, [app.user, router]);
    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await request("auth/login", { body: { username, password } });
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
    return <div className="login-page"><section className="login-story"><div className="brand"><span className="brand-mark">W<span /></span><span><strong>WAFBPO</strong><small>SOLUTIONS</small></span></div><div className="login-story-content"><span className="login-pill">A WORKSPACE BUILT FOR YOUR TEAM</span><h1>Every lead.<br />One accountable<br /><em>workflow.</em></h1><p>From the first conversation to the final review, keep the right work in the right hands.</p><div className="login-pipeline">Generation <ArrowRight size={15}/> Q/A <ArrowRight size={15}/> Chasing <ArrowRight size={15}/> Management</div><div className="login-features"><span><CheckCircle2 size={18}/> Dedicated department queues</span><span><CheckCircle2 size={18}/> Live incoming-lead alerts</span><span><CheckCircle2 size={18}/> Complete record history</span></div></div><div className="login-story-footer">WAFBPO SOLUTIONS <span>OPERATIONS CRM</span></div></section><section className="login-form-wrap"><div className="login-form"><span className="login-lock"><ShieldCheck size={24}/></span><div className="eyebrow">YOUR WORKSPACE, CONNECTED</div><h2>Welcome back.</h2><p>Sign in with the account provided by Management.</p><ErrorBox error={error || app.sessionError}/><form onSubmit={submit}><Field label="Username" required><input autoComplete="username" autoFocus required value={username} onChange={e => setUsername(e.target.value)} placeholder="Your username"/></Field><Field label="Password" required><div className="input-with-button"><input autoComplete="current-password" type={visible ? "text" : "password"} required value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password"/><button type="button" className="icon-btn" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></Field><Button className="login-submit" type="submit" busy={busy}>Sign in to workspace<ArrowRight size={18}/></Button></form><div className="login-help">Need an account or a password reset?<br /><strong>Contact your department head or Management.</strong></div><small className="login-disclaimer">Authorized personnel only. Workspace activity is audited.</small></div></section></div>;
}
