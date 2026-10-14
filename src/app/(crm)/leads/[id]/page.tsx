import { Suspense } from "react";
import { LeadDetail } from "@/components/lead-detail";
export default async function Page({ params }: {
    params: Promise<{
        id: string;
    }>;
}) { const { id } = await params; return <Suspense fallback={<div>Loading record...</div>}><LeadDetail id={id}/></Suspense>; }
