import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateArticle, deleteArticle } from "@/lib/actions/help";
import { PageHeader } from "@/components/app/page-header";
import { ArticleForm } from "@/components/app/article-form";
import { DeleteButton } from "@/components/app/delete-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireAuth();
  const [article, categories] = await Promise.all([
    prisma.article.findFirst({ where: { id, workspaceId: ctx.workspaceId } }),
    prisma.articleCategory.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { name: "asc" } }),
  ]);
  if (!article) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Edit article"
        action={
          <div className="flex items-center gap-2">
            {article.published && (
              <Link href={`/help/${ctx.workspace.slug}/${article.slug}`} target="_blank">
                <Button variant="outline" className="gap-2">
                  <ExternalLink className="h-4 w-4" /> View
                </Button>
              </Link>
            )}
            <Link href="/app/help">
              <Button variant="ghost" className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Help center
              </Button>
            </Link>
          </div>
        }
      />
      <Card>
        <CardContent className="pt-6">
          <ArticleForm
            action={updateArticle.bind(null, id)}
            categories={categories}
            defaults={{ title: article.title, body: article.body, categoryId: article.categoryId, published: article.published }}
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>
      <DeleteButton action={deleteArticle.bind(null, id)} label="Delete article" confirmText={`Delete "${article.title}"?`} />
    </div>
  );
}
