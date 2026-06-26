import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { isCsvObject, CSV_LABEL, CSV_HEADERS } from "@/lib/csv";
import { PageHeader } from "@/components/app/page-header";
import { ImportForm } from "@/components/app/import-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ object: string }>;
}) {
  const { object } = await params;
  await requireAuth();
  if (!isCsvObject(object)) notFound();

  return (
    <div>
      <PageHeader
        title={`Import ${CSV_LABEL[object]}`}
        description="Upload a CSV. New records are created; rows matching an existing record are skipped."
        action={
          <Link href={`/app/${object}`}>
            <Button variant="ghost" className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          </Link>
        }
      />
      <Card className="max-w-2xl">
        <CardContent className="space-y-5 pt-6">
          <div className="rounded-md border border-border bg-secondary/40 p-4 text-sm">
            <p className="mb-2 font-medium">Expected columns</p>
            <code className="text-xs text-muted-foreground">{CSV_HEADERS[object].join(", ")}</code>
            <div className="mt-3">
              <a href={`/api/template?object=${object}`}>
                <Button variant="outline" size="sm" className="gap-2">
                  <Download className="h-4 w-4" /> Download template
                </Button>
              </a>
            </div>
          </div>
          <ImportForm object={object} />
        </CardContent>
      </Card>
    </div>
  );
}
