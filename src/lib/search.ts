import { blind } from "./crypto.ts";
import type { Patient, Doctor } from "./domain/types.ts";
export const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export const digits = (s: string) => s.replace(/\D/g, "");
export function duplicateKeys(p: Patient): string[] {
    const keys: string[] = [];
    if (p.identifier)
        keys.push(`identifier:${p.identifierKind}:${normalize(p.identifier)}`);
    if (p.memberId)
        keys.push(`member:${normalize(p.memberId)}`);
    if (p.phone && digits(p.phone).length >= 7)
        keys.push(`phone:${digits(p.phone)}`);
    if (p.firstName && p.lastName && p.dob)
        keys.push(`name-dob:${normalize(p.firstName + p.lastName)}:${p.dob}`);
    if (p.phone && p.dob)
        keys.push(`phone-dob:${digits(p.phone)}:${p.dob}`);
    return [...new Set(keys.map(blind))];
}
export function searchTokens(p: Patient, d: Doctor, code: string, campaign: string, batch: string): string[] {
    const values = [p.firstName, p.lastName, `${p.firstName} ${p.lastName}`, p.phone, p.identifier, p.memberId, p.insuranceName, d.name, d.npi, d.phone, d.fax, code, campaign, batch];
    const tokens = new Set<string>();
    for (const value of values)
        for (const part of [value, ...value.split(/\s+/)]) {
            const n = normalize(part);
            if (n.length < 2)
                continue;
            tokens.add(blind(`search:${n}`));
            for (let i = 2; i <= Math.min(n.length, 32); i++)
                tokens.add(blind(`search:${n.slice(0, i)}`));
        }
    return [...tokens];
}
export function queryToken(s: string) { const n = normalize(s); return n.length >= 2 ? blind(`search:${n}`) : null; }
export function mask(value: string): string { return value ? `****${value.slice(-4)}` : ""; }
export function csvSafe(value: unknown): string { const s = String(value ?? ""); return /^[\s]*[=+@\-\t\r]/.test(s) ? "'" + s : s; }

export function identifierSearchKeys(p:Patient):string[] {return [p.identifier ? blind(`identifier-search:${normalize(p.identifier)}`) : '',p.memberId ? blind(`member-search:${normalize(p.memberId)}`) : ''].filter(Boolean);}
export function userSearchTokens(name:string,username:string,specialId:string):string[]{const out=new Set<string>();for(const value of [name,username,specialId,...name.split(/\s+/)]){const n=normalize(value);for(let i=2;i<=Math.min(n.length,60);i++)out.add(blind(`user-search:${n.slice(0,i)}`));}return [...out];}
