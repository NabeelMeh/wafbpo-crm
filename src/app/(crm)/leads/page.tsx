import { Suspense } from "react";
import { LeadsList } from "@/components/leads-list";
export default function Page() { return <Suspense fallback={<div>Loading leads...</div>}><LeadsList /></Suspense>; }
