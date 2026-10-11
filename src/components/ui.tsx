"use client";
import { useEffect, useRef } from "react";
import type { ReactNode, ButtonHTMLAttributes } from "react";
import { X, Inbox, LoaderCircle, AlertCircle } from "lucide-react";
import { pretty } from "@/lib/client";
export function Button({ children, variant = "primary", busy = false, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "danger" | "ghost";
    busy?: boolean;
}) { return <button {...props} type={props.type || "button"} disabled={props.disabled || busy} className={`btn btn-${variant} ${className}`}>{busy && <LoaderCircle size={16} className="spin"/>}{children}</button>; }
export function Badge({ value }: {
    value: string;
}) { return <span className={`badge badge-${value.toLowerCase()}`}>{pretty(value)}</span>; }
export function Empty({ title = "No records yet", description, action }: {
    title?: string;
    description?: string;
    action?: ReactNode;
}) { return <div className="empty"><span className="empty-icon"><Inbox size={27}/></span><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>; }
export function ErrorBox({ error }: {
    error: unknown;
}) {
    if (!error)
        return null;
    return <div className="error-box" role="alert"><AlertCircle size={18}/><span>{error instanceof Error ? error.message : String(error)}</span></div>;
}
export function Loading() { return <div className="loading"><LoaderCircle className="spin" size={22}/><span>Loading your workspace...</span></div>; }
export function PageTitle({ eyebrow, title, description, actions }: {
    eyebrow?: string;
    title: string;
    description?: string;
    actions?: ReactNode;
}) { return <div className="page-title"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div><div className="page-actions">{actions}</div></div>; }
export function Modal({ title, onClose, children }: {
    title: string;
    onClose: () => void;
    children: ReactNode;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => { const d = dialog.current; d?.showModal(); return () => d?.close(); }, []);
    return <dialog ref={dialog} className="modal" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => {
            if (e.target === e.currentTarget)
                onClose();
        }}><div className="modal-head"><h2>{title}</h2><button type="button" className="icon-btn" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div><div className="modal-body">{children}</div></dialog>;
}
export function Field({ label, required, children, error, hint }: {
    label: string;
    required?: boolean;
    children: ReactNode;
    error?: string;
    hint?: string;
}) { return <label className={`field ${error ? "field-error" : ""}`}><span className="field-label">{label}{required && <b aria-label="required"> *</b>}</span>{children}{error ? <small className="field-error-text">{error}</small> : hint ? <small>{hint}</small> : null}</label>; }
