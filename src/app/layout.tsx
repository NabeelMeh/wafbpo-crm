import type { Metadata } from "next";
import { AppProvider } from "@/components/app-provider";
import "./globals.css";
export const metadata: Metadata = { title: { default: "CLOUD NEST BPO | CRM", template: "%s | CLOUD NEST BPO" }, description: "Department-based lead operations for CLOUD NEST BPO", robots: { index: false, follow: false } };
export default function RootLayout({ children }: {
    children: React.ReactNode;
}) { return <html lang="en"><body><AppProvider>{children}</AppProvider></body></html>; }
