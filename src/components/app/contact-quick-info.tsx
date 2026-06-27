"use client";

import { useState } from "react";
import { Mail, Copy, Check, MessageCircle } from "lucide-react";

/** Label-free contact channels for the identity card: email (mailto + copy) and phone (WhatsApp). */
export function ContactQuickInfo({ email, phone }: { email?: string | null; phone?: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!email && !phone) {
    return <p className="border-t border-border pt-3 text-sm text-muted-foreground">No email or phone yet.</p>;
  }

  const waDigits = phone ? phone.replace(/\D/g, "") : "";

  return (
    <div className="space-y-2 border-t border-border pt-3 text-sm">
      {email && (
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
          <a
            href={`mailto:${email}`}
            className="min-w-0 flex-1 truncate font-medium text-primary hover:underline"
            title={`Email ${email}`}
          >
            {email}
          </a>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(email);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Copy email"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      )}
      {phone && (
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
          <a
            href={`https://wa.me/${waDigits}`}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate font-medium text-primary hover:underline"
            title={`WhatsApp ${phone}`}
          >
            {phone}
          </a>
        </div>
      )}
    </div>
  );
}
