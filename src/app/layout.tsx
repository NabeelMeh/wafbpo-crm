import type { Metadata } from "next";
import { AppProvider } from "@/components/app-provider";
import "./globals.css";
export const metadata: Metadata = { title: { default: "WAFBPO SOLUTIONS | CRM", template: "%s | WAFBPO SOLUTIONS" }, description: "Department-based lead operations for WAFBPO SOLUTIONS", robots: { index: false, follow: false } };
export default function RootLayout({ children }: {
    children: React.ReactNode;
}) { return <html lang="en"><body><AppProvider>{children}</AppProvider></body></html>; }
