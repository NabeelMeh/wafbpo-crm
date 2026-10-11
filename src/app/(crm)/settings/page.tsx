"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { PageTitle, Field, Button, ErrorBox } from "@/components/ui";
import { request } from "@/lib/client";
export default function Settings() {
    const app = useApp(), router = useRouter(), [current, setCurrent] = useState(""), [next, setNext] = useState(""), [confirm, setConfirm] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
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
    return <><PageTitle eyebrow="ACCOUNT SECURITY" title="Keep your account protected" description="Sessions expire after 30 minutes of inactivity or eight hours at most. Access changes revoke existing sessions."/><ErrorBox error={error}/><div className="settings-grid"><section className="panel settings-card"><span className="settings-icon"><KeyRound size={24}/></span><h2>Change password</h2><p className="muted">Use a unique passphrase of at least 14 characters.</p><form onSubmit={change}><Field label="Current password" required><input type="password" required autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)}/></Field><Field label="New password" required><input type="password" required minLength={14} maxLength={128} autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)}/></Field><Field label="Confirm new password" required><input type="password" required minLength={14} maxLength={128} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)}/></Field><Button busy={busy} type="submit">Change password &amp; sign out</Button></form></section></div></>;
}
