"use client";
import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, CheckCircle2, BellRing } from "lucide-react";
import type { Actor, NotificationView } from "@/lib/domain/types";
import { request, ApiError } from "@/lib/client";
type Toast = {
    id: string;
    title: string;
    message?: string;
    href?: string;
    noteIds?: string[];
};
type AppContextValue = {
    user: Actor | null;
    loading: boolean;
    sessionError: unknown;
    revision: number;
    notifications: NotificationView[];
    unread: number;
    sound: boolean;
    realtimeEnabled: boolean;
    connection: string;
    refresh: () => void;
    refreshUser: () => Promise<void>;
    toast: (title: string, message?: string) => void;
    enableSound: () => Promise<void>;
    acknowledge: (ids: string[]) => Promise<void>;
};
const Context = createContext<AppContextValue | null>(null);
export function useApp() {
    const value = useContext(Context);
    if (!value)
        throw new Error("App provider missing");
    return value;
}
export function AppProvider({ children }: {
    children: ReactNode;
}) {
    const [user, setUser] = useState<Actor | null>(null), [loading, setLoading] = useState(true), [sessionError, setSessionError] = useState<unknown>(null), [revision, setRevision] = useState(0);
    const [notifications, setNotifications] = useState<NotificationView[]>([]), [unread, setUnread] = useState(0), [sound, setSound] = useState(false), [realtimeEnabled, setRealtimeEnabled] = useState(false), [connection, setConnection] = useState("Polling");
    const [toasts, setToasts] = useState<Toast[]>([]);
    const soundRef = useRef<AudioContext | null>(null), lastInput = useRef(Date.now()), pathname = usePathname();
    const refresh = useCallback(() => setRevision(v => v + 1), []);
    const push = useCallback((t: Omit<Toast, "id">) => { const id = crypto.randomUUID(); setToasts(v => [...v.slice(-3), { ...t, id }]); setTimeout(() => setToasts(v => v.filter(x => x.id !== id)), t.noteIds ? 20000 : 6500); }, []);
    const toast = useCallback((title: string, message?: string) => push({ title, message }), [push]);
    const refreshUser = useCallback(async () => {
        try {
            const data = await request<{
                user: Actor;
                realtimeEnabled: boolean;
            }>("auth/me");
            setUser(data.user);
            setRealtimeEnabled(data.realtimeEnabled);
            setSessionError(null);
        }
        catch (e) {
            setUser(null);
            if (!(e instanceof ApiError && e.status === 401))
                setSessionError(e);
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { void refreshUser(); }, [refreshUser]);
    useEffect(() => {
        const onInput = () => { lastInput.current = Date.now(); };
        for (const e of ["pointerdown", "keydown", "scroll"])
            window.addEventListener(e, onInput, { passive: true });
        return () => {
            for (const e of ["pointerdown", "keydown", "scroll"])
                window.removeEventListener(e, onInput);
        };
    }, []);
    const beep = useCallback(() => {
        const ctx = soundRef.current;
        if (!ctx || ctx.state !== "running")
            return;
        for (const offset of [0, 0.17]) {
            const oscillator = ctx.createOscillator(), gain = ctx.createGain();
            oscillator.connect(gain);
            gain.connect(ctx.destination);
            oscillator.frequency.value = offset ? 880 : 660;
            gain.gain.setValueAtTime(0, ctx.currentTime + offset);
            gain.gain.linearRampToValueAtTime(0.11, ctx.currentTime + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.13);
            oscillator.start(ctx.currentTime + offset);
            oscillator.stop(ctx.currentTime + offset + 0.15);
        }
    }, []);
    const enableSound = useCallback(async () => {
        if (sound) {
            setSound(false);
            await soundRef.current?.suspend();
            return;
        }
        if (!soundRef.current)
            soundRef.current = new AudioContext();
        await soundRef.current.resume();
        setSound(true);
        beep();
    }, [sound, beep]);
    const acknowledge = useCallback(async (ids: string[]) => { await Promise.all(ids.map(id => request(`notifications/${id}/acknowledge`, { body: {}, activity: true }))); setToasts(v => v.filter(t => !t.noteIds?.some(id => ids.includes(id)))); refresh(); }, [refresh]);
    useEffect(() => {
        if (!user || pathname === "/login")
            return;
        let stopped = false, running = false, pending = false, timer: ReturnType<typeof setTimeout>, heartbeatAt = 0, lastRefresh = 0, failures = 0;
        const poll = async () => {
            if (stopped)
                return;
            if (running) {
                pending = true;
                return;
            }
            running = true;
            clearTimeout(timer);
            let delay = 10000;
            try {
                if (document.visibilityState !== "visible") {
                    delay = 30000;
                    return;
                }
                if (Date.now() - heartbeatAt > 30000) {
                    await request("presence", { body: { lastInputAt: lastInput.current, visible: true } });
                    heartbeatAt = Date.now();
                }
                if (user.mustChangePassword)
                    return;
                const data = await request<{
                    items: NotificationView[];
                    unread: number;
                }>("notifications");
                if (stopped)
                    return;
                setNotifications(data.items);
                setUnread(data.unread);
                failures = 0;
                const fresh = data.items.filter(n => !n.deliveredAt && !n.acknowledgedAt).slice(0, 20), claimed: NotificationView[] = [];
                for (const note of fresh) {
                    const res = await request<{
                        claimed: boolean;
                    }>(`notifications/${note._id}/claim`, { body: {} });
                    if (res.claimed)
                        claimed.push(note);
                }
                if (claimed.length) {
                    const single = claimed.length === 1 ? claimed[0] : null;
                    push({ title: single?.title || `${claimed.reduce((s, n) => s + n.count, 0)} incoming updates`, message: single?.body || "Open notifications to review the new items in your queues.", href: single?.leadId ? `/leads/${single.leadId}` : "/notifications", noteIds: claimed.map(n => n._id) });
                    if (sound)
                        beep();
                    refresh();
                }
                if (Date.now() - lastRefresh > 20000) {
                    refresh();
                    lastRefresh = Date.now();
                }
            }
            catch (e) {
                failures++;
                delay = Math.min(60000, 10000 * 2 ** Math.min(failures, 3));
                if (e instanceof ApiError && e.status === 401) {
                    setUser(null);
                    return;
                }
            }
            finally {
                running = false;
                if (!stopped) {
                    timer = setTimeout(poll, pending ? 0 : delay);
                    pending = false;
                }
            }
        };
        const wake = () => { clearTimeout(timer); void poll(); };
        window.addEventListener("waf:notification-hint", wake);
        document.addEventListener("visibilitychange", wake);
        void poll();
        return () => { stopped = true; clearTimeout(timer); window.removeEventListener("waf:notification-hint", wake); document.removeEventListener("visibilitychange", wake); };
    }, [user?.id, user?.mustChangePassword, pathname, sound, beep, push, refresh]);
    useEffect(() => {
        if (!user || !realtimeEnabled || user.mustChangePassword)
            return;
        let stopped = false, close: (() => void) | undefined;
        void import("ably").then(Ably => {
            if (stopped)
                return;
            const client = new Ably.Realtime({ authUrl: "/api/realtime/token", authMethod: "GET", clientId: user.id });
            client.connection.on("connected", () => setConnection("Live"));
            client.connection.on("disconnected", () => setConnection("Polling fallback"));
            client.connection.on("failed", () => setConnection("Polling fallback"));
            void client.channels.get(`waf:user:${user.id}`).subscribe("invalidate", () => { refresh(); window.dispatchEvent(new Event("waf:notification-hint")); });
            close = () => client.close();
        }).catch(() => setConnection("Polling fallback"));
        return () => { stopped = true; close?.(); };
    }, [user?.id, user?.mustChangePassword, realtimeEnabled, refresh]);
    return <Context.Provider value={{ user, loading, sessionError, revision, notifications, unread, sound, realtimeEnabled, connection, refresh, refreshUser, toast, enableSound, acknowledge }}>{children}<div className="toast-stack" aria-live="polite">{toasts.map(t => <div key={t.id} className="toast"><div className="toast-symbol">{t.noteIds ? <BellRing size={20}/> : <CheckCircle2 size={20}/>}</div><div className="toast-content"><strong>{t.title}</strong>{t.message && <p>{t.message}</p>}<div className="toast-actions">{t.href && <Link href={t.href}>View {t.noteIds?.length === 1 ? "lead" : "updates"}</Link>}{t.noteIds && <button onClick={() => void acknowledge(t.noteIds!).catch(e => toast("Could not acknowledge", e.message))}>Acknowledge</button>}</div></div><button className="icon-btn" aria-label="Dismiss notification" onClick={() => setToasts(v => v.filter(x => x.id !== t.id))}><X size={16}/></button></div>)}</div></Context.Provider>;
}
export function useLoad<T>(path: string | null, live = false) {
    const { revision } = useApp(), [data, setData] = useState<T | null>(null), [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(true), [count, setCount] = useState(0);
    const refetch = useCallback(() => setCount(x => x + 1), []);
    useEffect(() => {
        if (!path) {
            setLoading(false);
            return;
        }
        const controller = new AbortController();
        setLoading(true);
        request<T>(path, { signal: controller.signal }).then(v => { setData(v); setError(null); }).catch(e => {
            if (e.name !== "AbortError")
                setError(e);
        }).finally(() => {
            if (!controller.signal.aborted)
                setLoading(false);
        });
        return () => controller.abort();
    }, [path, count, live ? revision : 0]);
    return { data, error, loading, refetch, setData };
}
