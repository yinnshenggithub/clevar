import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/app/page-header";
import { ChannelForm } from "@/components/app/channel-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function Copyable({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <code className="mt-1 block break-all rounded-md border border-border bg-secondary px-2 py-1.5 text-xs">{value}</code>
    </div>
  );
}

export default async function InboxSettingsPage() {
  const ctx = await requireAuth();
  const [agents, channel] = await Promise.all([
    withTenant(ctx.workspaceId, (tx) =>
      tx.aiAgent.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ),
    prisma.whatsAppChannel.findFirst({ where: { workspaceId: ctx.workspaceId } }),
  ]);

  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const webhookUrl = `${base}/api/whatsapp/webhook`;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "(ask your admin to set WHATSAPP_VERIFY_TOKEN)";

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Connect WhatsApp"
        description="A step-by-step guide — no prior experience needed."
        action={
          <Link href="/app/inbox">
            <Button variant="ghost" className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Inbox
            </Button>
          </Link>
        }
      />

      {channel && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          Connected: <span className="font-medium">{channel.displayName}</span> (phone number ID {channel.phoneNumberId})
          {channel.autoReplyAgentId ? " · AI auto-reply on" : ""}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What you&apos;ll need first</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>WhatsApp connects through Meta&apos;s official &ldquo;WhatsApp Cloud API.&rdquo; To set it up you need:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>A free <span className="font-medium text-foreground">Facebook account</span>.</li>
            <li>
              A <span className="font-medium text-foreground">phone number</span> that is <em>not</em> already in use on
              the normal WhatsApp or WhatsApp Business app. (To just try it out, Meta gives you a free test number — no
              number of your own needed yet.)
            </li>
            <li>About 15 minutes. Steps 1–6 get you testing; step 7 is for going live.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Step-by-step</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          <div>
            <p className="font-medium">1 · Create a Meta developer app</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Go to <span className="font-medium text-foreground">developers.facebook.com</span> and log in with Facebook.</li>
              <li>Top-right menu → <span className="font-medium text-foreground">My Apps</span> → <span className="font-medium text-foreground">Create App</span>.</li>
              <li>For &ldquo;Use case&rdquo; pick <span className="font-medium text-foreground">Other</span> → app type <span className="font-medium text-foreground">Business</span> → name it &ldquo;Clevar WhatsApp&rdquo; → Create.</li>
            </ol>
          </div>

          <div>
            <p className="font-medium">2 · Add the WhatsApp product</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>On the app dashboard, find <span className="font-medium text-foreground">WhatsApp</span> and click <span className="font-medium text-foreground">Set up</span>.</li>
              <li>Meta creates a free <span className="font-medium text-foreground">test phone number</span> you can use right away.</li>
            </ol>
          </div>

          <div>
            <p className="font-medium">3 · Copy your credentials</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Open <span className="font-medium text-foreground">WhatsApp → API Setup</span>.</li>
              <li>Copy the <span className="font-medium text-foreground">Phone number ID</span> (shown under the test number — it&apos;s a long number, not the phone number itself).</li>
              <li>Copy the <span className="font-medium text-foreground">temporary access token</span> at the top (good for 24 hours — fine for testing).</li>
            </ol>
          </div>

          <div>
            <p className="font-medium">4 · Point Meta&apos;s webhook at Clevar</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Open <span className="font-medium text-foreground">WhatsApp → Configuration</span> → next to &ldquo;Webhook&rdquo; click <span className="font-medium text-foreground">Edit</span>.</li>
              <li>Paste these two values, then click <span className="font-medium text-foreground">Verify and save</span>:</li>
            </ol>
            <div className="mt-2 space-y-2 pl-5">
              <Copyable label="Callback URL" value={webhookUrl} />
              <Copyable label="Verify token" value={verifyToken} />
            </div>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground" start={3}>
              <li>Still on Configuration, under <span className="font-medium text-foreground">Webhook fields</span> click <span className="font-medium text-foreground">Manage</span> and subscribe to <span className="font-medium text-foreground">messages</span>.</li>
            </ol>
          </div>

          <div>
            <p className="font-medium">5 · Connect it here</p>
            <p className="mt-1 text-muted-foreground">
              In the form below, paste the <span className="font-medium text-foreground">Phone number ID</span> and{" "}
              <span className="font-medium text-foreground">access token</span> from step 3, then Save. Optionally pick an
              AI agent to auto-reply.
            </p>
          </div>

          <div>
            <p className="font-medium">6 · Send a test message</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>In Meta&apos;s <span className="font-medium text-foreground">API Setup</span>, add your personal WhatsApp number under &ldquo;To&rdquo; (test mode only sends to numbers you add there).</li>
              <li>From your phone, send a WhatsApp message to the test number. It appears in your <span className="font-medium text-foreground">Inbox</span> within seconds — reply right from Clevar.</li>
            </ol>
          </div>

          <div>
            <p className="font-medium">7 · Go live (when you&apos;re ready)</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Add your own number: <span className="font-medium text-foreground">WhatsApp → API Setup → Add phone number</span>, verify by SMS.</li>
              <li>
                Create a permanent token: <span className="font-medium text-foreground">business.facebook.com</span> →
                Business settings → <span className="font-medium text-foreground">System users</span> → add a system user →
                assign your app + WhatsApp account → <span className="font-medium text-foreground">Generate token</span> with
                the <code className="text-xs">whatsapp_business_messaging</code> and{" "}
                <code className="text-xs">whatsapp_business_management</code> permissions. Paste it here (it never expires).
              </li>
              <li>Add a payment method in WhatsApp settings (Meta charges per conversation beyond the free monthly tier).</li>
            </ol>
          </div>

          <p className="rounded-md border border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
            Tip: only text, images, video, voice notes, and documents are supported today. Your messages and contacts stay
            isolated to this workspace.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your WhatsApp connection</CardTitle>
        </CardHeader>
        <CardContent>
          {canManageWorkspace(ctx.role) ? (
            <ChannelForm
              agents={agents}
              defaults={
                channel
                  ? {
                      phoneNumberId: channel.phoneNumberId,
                      displayName: channel.displayName,
                      wabaId: channel.wabaId,
                      autoReplyAgentId: channel.autoReplyAgentId,
                    }
                  : undefined
              }
            />
          ) : (
            <p className="text-sm text-muted-foreground">Only owners and admins can connect channels.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
