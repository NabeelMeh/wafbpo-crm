"use client";
import { PasswordInput } from "@/components/password-input";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, KeyRound, LockKeyhole, Copy } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { PageTitle, Field, Button, ErrorBox, Badge } from "@/components/ui";
import { request } from "@/lib/client";
export default function Settings() {
    const app = useApp(), router = useRouter(), [current, setCurrent] = useState(""), [next, setNext] = useState(""), [confirm, setConfirm] = useState(""), [mfaPassword, setMfaPassword] = useState(""), [code, setCode] = useState(""), [setup, setSetup] = useState<{
        secret: string;
        uri: string;
    } | null>(null), [recovery, setRecovery] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
    async function change(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        if (next !== confirm) {
            setError(new Error("The new passwords do not match."));
            return;
        }
        setBusy(true);
        try {
            await request("auth/password", { body: { currentPassword: current, newPassword: next }, activity: true });
            await app.refreshUser();
            app.toast("Password changed", "Sign in again with your new password.");
            router.replace("/login");
        }
        catch (e) {
            setError(e);
        }
        finally {
            setBusy(false);
        }
    }
    async function begin(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
            setSetup(await request("auth/mfa/begin", { body: { password: mfaPassword }, activity: true }));
        }
        catch (e) {
            setError(e);
        }
        finally {
            setBusy(false);
        }
    }
    async function complete(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
            const result = await request<{
                recoveryCodes: string[];
            }>("auth/mfa/confirm", { body: { code }, activity: true });
            setRecovery(result.recoveryCodes);
            setSetup(null);
            setCode("");
            setMfaPassword("");
            await app.refreshUser();
            app.toast("Two-factor authentication enabled", "Save your recovery codes, then sign out and sign in again.");
        }
        catch (e) {
            setError(e);
        }
        finally {
            setBusy(false);
        }
    }
    async function disable(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
            await request("auth/mfa/disable", { body: { password: mfaPassword, code }, activity: true });
            await app.refreshUser();
            router.replace("/login");
        }
        catch (e) {
            setError(e);
        }
        finally {
            setBusy(false);
        }
    }
    return <><PageTitle eyebrow="ACCOUNT SECURITY" title="Keep your account protected" description="Sessions expire after 30 minutes of inactivity or eight hours at most. Access changes revoke existing sessions."/><ErrorBox error={error}/><div className="settings-grid"><section className="panel settings-card"><span className="settings-icon"><KeyRound size={24}/></span><h2>Change password</h2><p className="muted">Use a unique passphrase of at least 10 characters.</p><form onSubmit={change}><Field label="Current password" required><input type="password" required autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)}/></Field><Field label="New password" required><input type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)}/></Field><Field label="Confirm new password" required><input type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)}/></Field><Button busy={busy} type="submit">Change password &amp; sign out</Button></form></section><section className="panel settings-card"><span className="settings-icon"><ShieldCheck size={24}/></span><div className="inline-heading"><h2>Two-factor authentication</h2><Badge value={app.user?.mfaEnabled ? "ENABLED" : "NOT_ENABLED"}/></div><p className="muted">Use an authenticator app that supports time-based verification codes. Setup secrets expire after 10 minutes.</p>{recovery.length > 0 && <div className="recovery-box"><strong>Save these recovery codes now</strong><p>Each code works once. They will not be displayed again after you leave this page.</p><pre>{recovery.join("\n")}</pre><Button variant="secondary" onClick={() => { void navigator.clipboard.writeText(recovery.join("\n")).then(() => app.toast("Recovery codes copied")).catch(() => app.toast("Clipboard unavailable")); }}><Copy size={15}/>Copy recovery codes</Button><Button onClick={() => { void request("auth/logout", { body: {} }).then(() => app.refreshUser()).then(() => router.replace("/login")).catch(setError); }}>I saved my codes - sign out</Button></div>}{setup ? <form onSubmit={complete}><div className="notice">Add a new time-based account in your authenticator using this manual setup key.</div><Field label="Secret key"><input className="mono" readOnly value={setup.secret}/></Field><details className="advanced"><summary>Provisioning URI</summary><p className="break-all">{setup.uri}</p></details><Field label="6-digit verification code" required><input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)}/></Field><Button busy={busy} type="submit">Verify &amp; enable MFA</Button></form> : app.user?.mfaEnabled ? <form onSubmit={disable}><Field label="Current password" required><input required type="password" autoComplete="current-password" value={mfaPassword} onChange={e => setMfaPassword(e.target.value)}/></Field><Field label="Authenticator or recovery code" required><input required autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)}/></Field><Button variant="danger" busy={busy} type="submit">Disable MFA &amp; revoke sessions</Button></form> : <form onSubmit={begin}><Field label="Confirm your current password" required><input type="password" required autoComplete="current-password" value={mfaPassword} onChange={e => setMfaPassword(e.target.value)}/></Field><Button busy={busy} type="submit"><LockKeyhole size={16}/>Set up two-factor authentication</Button></form>}</section></div></>;
}
