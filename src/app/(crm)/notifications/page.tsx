"use client";
import Link from "next/link";
import { Bell, ArrowUpRight, Check } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { PageTitle, Button, Empty } from "@/components/ui";
import { dateTime } from "@/lib/client";
export default function Notifications() {
    const app = useApp();
    async function ack(ids: string[]) {
        try {
            await app.acknowledge(ids);
            app.toast("Notifications acknowledged");
        }
        catch (e) {
            app.toast("Could not acknowledge", (e as Error).message);
        }
    }
    return <><PageTitle eyebrow="YOUR INBOX" title="Notifications" description="Lead handoffs, assignments, and authorized team-status changes. Showing the latest 100 notifications." actions={<Button variant="secondary" disabled={!app.notifications.some(n => !n.acknowledgedAt)} onClick={() => void ack(app.notifications.filter(n => !n.acknowledgedAt).map(n => n._id))}><Check size={16}/>Acknowledge visible</Button>}/><section className="panel">{!app.notifications.length ? <Empty title="You're all caught up" description="Incoming work will appear here and in the popup alert."/> : <div className="notification-list">{app.notifications.map(n => <article className={n.acknowledgedAt ? "note-read" : "note-unread"} key={n._id}><div className="notification-symbol"><Bell size={20}/></div><div><strong>{n.title}</strong><p>{n.body}</p><small>{dateTime(n.createdAt)}</small></div><div className="row-actions">{n.leadId ? <Link className="btn btn-secondary" href={`/leads/${n.leadId}`}>View lead<ArrowUpRight size={15}/></Link> : <Link className="btn btn-secondary" href="/leads">Open queues</Link>}{!n.acknowledgedAt && <Button variant="ghost" onClick={() => void ack([n._id])}>Acknowledge</Button>}</div></article>)}</div>}</section></>;
}
