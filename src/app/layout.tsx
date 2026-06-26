import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clevar — CRM that works the way you do",
  description:
    "Clevar is a multi-tenant CRM platform: contacts, companies, and deals with secure workspace isolation.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-foreground">
        {children}
      </body>
    </html>
  );
}
