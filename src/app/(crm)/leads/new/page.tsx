"use client";
import { PageTitle, ErrorBox } from "@/components/ui";
import { LeadEditor } from "@/components/lead-editor";
import { useApp } from "@/components/app-provider";
import { inDepartment } from "@/lib/domain/policy";
export default function Page() {
    const { user } = useApp();
    if (!user)
        return null;
    if (!inDepartment(user, "GENERATION"))
        return <ErrorBox error="Only Generation and Management can create Generation leads."/>;
    return <><PageTitle eyebrow="GENERATION DEPARTMENT" title="Create a new lead" description="Drafts autosave. Submission stays disabled until every mandatory field is valid."/><section className="panel"><LeadEditor /></section></>;
}
