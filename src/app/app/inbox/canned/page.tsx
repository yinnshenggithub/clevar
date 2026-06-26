import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { deleteCanned } from "@/lib/actions/canned";
import { PageHeader } from "@/components/app/page-header";
import { CannedForm } from "@/components/app/canned-form";
import { DeleteButton } from "@/components/app/delete-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function CannedPage() {
  const ctx = await requireAuth();
  const responses = await withTenant(ctx.workspaceId, (tx) =>
    tx.cannedResponse.findMany({ orderBy: { shortcode: "asc" } }),
  );

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Canned responses"
        description="Saved replies your team can insert into any conversation by shortcode."
        action={
          <Link href="/app/inbox">
            <Button variant="ghost" className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Inbox
            </Button>
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New canned response</CardTitle>
        </CardHeader>
        <CardContent>
          <CannedForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your responses ({responses.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {responses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No canned responses yet.</p>
          ) : (
            responses.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">/{r.shortcode}</code>
                    <span className="font-medium">{r.title}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{r.content}</p>
                </div>
                <DeleteButton
                  action={deleteCanned.bind(null, r.id)}
                  label=""
                  confirmText={`Delete the "/${r.shortcode}" response?`}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
