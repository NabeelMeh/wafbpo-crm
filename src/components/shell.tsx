"use client";
import { useState, useEffect } from "react";
import type { ReactNode, FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Users, ShieldCheck, PhoneCall, ClipboardCheck, BriefcaseBusiness, Bell, Search, LogOut, Settings, FileUp, BarChart3, ScrollText, Volume2, VolumeX, Menu, X, ChevronRight } from "lucide-react";
import { DEPARTMENTS, DEPARTMENT_NAMES } from "@/lib/domain/types";
import { isManagement, canSeeTeam, inDepartment } from "@/lib/domain/policy";
import { useApp } from "./app-provider";
import { Loading, Button } from "./ui";
import { request, pretty } from "@/lib/client";
const departmentIcons = { GENERATION: Users, QA: ShieldCheck, CHASING: PhoneCall, PV: ClipboardCheck, MANAGEMENT: BriefcaseBusiness };
export function Shell({ children }: {
    children: ReactNode;
}) {
    const app = useApp(), router = useRouter(), path = usePathname(), [open, setOpen] = useState(false), [q, setQ] = useState("");
    useEffect(() => {
        if (!app.loading && !app.user)
            router.replace("/login");
    }, [app.loading, app.user, router]);
    useEffect(() => setOpen(false), [path]);
    if (app.loading || !app.user)
        return <Loading />;
    const user = app.user;
    const search = (e: FormEvent) => {
        e.preventDefault();
        if (q.trim().length >= 2)
            router.push(`/leads?q=${encodeURIComponent(q.trim())}`);
    };
    async function signOut() {
        try {
            await request("auth/logout", { body: {} });
            await app.refreshUser();
            router.replace("/login");
        }
        catch (e) {
            app.toast("Sign out failed", (e as Error).message);
        }
    }
    return <div className="workspace">{open && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setOpen(false)}/>}<aside className={`sidebar ${open ? "sidebar-open" : ""}`}><Link href="/dashboard" className="brand"><span className="brand-mark">W<span /></span><span><strong>WAFBPO</strong><small>SOLUTIONS</small></span></Link><div className="workspace-label"><span className="status-dot"/> Operations workspace</div><nav><Link className={`nav-item ${path === "/dashboard" ? "nav-active" : ""}`} href="/dashboard"><LayoutDashboard size={18}/>Overview</Link><div className="nav-label">DEPARTMENTS</div>{DEPARTMENTS.map(d => {
            const Icon = departmentIcons[d], allowed = inDepartment(user, d);
            return <Link aria-disabled={!allowed} key={d} onClick={e => {
                    if (!allowed)
                        e.preventDefault();
                }} href={`/leads?department=${d}`} className={`nav-item department-nav ${!allowed ? "nav-disabled" : ""}`}><Icon size={18}/><span>{DEPARTMENT_NAMES[d].replace(" Department", "")}</span><i className={`department-dot dot-${d.toLowerCase()}`}/></Link>;
        })}<div className="nav-label">WORKSPACE</div>{canSeeTeam(user) && <Link className={`nav-item ${path === "/team" ? "nav-active" : ""}`} href="/team"><Users size={18}/>Live team status<span className="tiny-tag">LIVE</span></Link>}<Link className={`nav-item ${path === "/reports" ? "nav-active" : ""}`} href="/reports"><BarChart3 size={18}/>Reports</Link><Link className={`nav-item ${path === "/notifications" ? "nav-active" : ""}`} href="/notifications"><Bell size={18}/>Notifications{app.unread > 0 && <span className="nav-count">{app.unread}</span>}</Link>{isManagement(user) && <><div className="nav-label">ADMINISTRATION</div><Link className={`nav-item ${path === "/users" ? "nav-active" : ""}`} href="/users"><Users size={18}/>User management</Link><Link className={`nav-item ${path === "/imports" ? "nav-active" : ""}`} href="/imports"><FileUp size={18}/>Import datasets</Link><Link className={`nav-item ${path === "/audit" ? "nav-active" : ""}`} href="/audit"><ScrollText size={18}/>Audit trail</Link></>}<Link className={`nav-item ${path === "/settings" ? "nav-active" : ""}`} href="/settings"><Settings size={18}/>Security</Link></nav><div className="sidebar-bottom"><div className="security-note"><ShieldCheck size={17}/><span>Role-scoped workspace<br /><small>Every action is accountable.</small></span></div><div className="sidebar-user"><div className="avatar">{user.name.split(" ").map(x => x[0]).slice(0, 2).join("")}</div><span><strong>{user.name}</strong><small>{user.role === "STAFF" ? user.memberships.map(m => `${pretty(m.department)} ${pretty(m.kind)}`).join(", ") : pretty(user.role)}</small></span><button className="icon-btn" aria-label="Sign out" onClick={() => void signOut()}><LogOut size={17}/></button></div></div></aside><div className="main-wrap"><header className="topbar"><button className="icon-btn menu-toggle" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu size={22}/></button><div className="breadcrumb">Workspace<ChevronRight size={14}/><strong>{pretty(path.split("/")[1] || "Overview")}</strong></div><form className="global-search" onSubmit={search}><Search size={17}/><input aria-label="Search leads" placeholder="Search patient, lead ID or doctor..." value={q} onChange={e => setQ(e.target.value)}/><kbd>Enter</kbd></form><span className="live-indicator"><span className="status-dot"/>{app.connection}</span><button className={`icon-btn ${app.sound ? "sound-on" : ""}`} title={app.sound ? "Mute incoming alerts" : "Enable incoming lead buzzer"} aria-label={app.sound ? "Mute alerts" : "Enable alerts"} onClick={() => void app.enableSound().catch(e => app.toast("Audio unavailable", e.message))}>{app.sound ? <Volume2 size={20}/> : <VolumeX size={20}/>}</button><Link href="/notifications" aria-label={`Notifications: ${app.unread} unread`} className="icon-btn bell-link"><Bell size={20}/>{app.unread > 0 && <i />}</Link><div className="avatar top-avatar">{user.name.slice(0, 1)}</div></header><main className="main-content">{user.mustChangePassword && <div className="notice">Your account has a temporary password. <Link href="/settings">Change it in Security to unlock the CRM.</Link></div>}{!app.sound && <div className="sound-banner"><VolumeX size={15}/><span>Incoming-lead popups are on. Enable the buzzer for this browser session.</span><button onClick={() => void app.enableSound().catch(e => app.toast("Audio unavailable", e.message))}>Enable sound</button></div>}{children}</main><footer className="workspace-footer"><span>WAFBPO SOLUTIONS</span><span>Patient Verification is a separate Management-controlled queue.</span></footer></div></div>;
}
