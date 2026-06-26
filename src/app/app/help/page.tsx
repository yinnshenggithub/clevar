import Link from "next/link";
import { ExternalLink, FileText } from "lucide-react";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteCategory, deleteArticle, togglePublish, createArticle } from "@/lib/actions/help";
import { PageHeader } from "@/components/app/page-header";
import { CategoryForm } from "@/components/app/category-form";
import { ArticleForm } from "@/components/app/article-form";
import { DeleteButton } from "@/components/app/delete-button";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function HelpAdminPage() {
  const ctx = await requireAuth();
  const manage = canManageWorkspace(ctx.role);
  const [categories, articles] = await Promise.all([
    prisma.articleCategory.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { name: "asc" } }),
    prisma.article.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { updatedAt: "desc" } }),
  ]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Help center"
        description="Publish self-serve articles for your customers."
        action={
          <Link href={`/help/${ctx.workspace.slug}`} target="_blank">
            <Button variant="outline" className="gap-2">
              <ExternalLink className="h-4 w-4" /> View public site
            </Button>
          </Link>
        }
      />

      {!manage ? (
        <p className="text-sm text-muted-foreground">Only owners and admins can edit the help center.</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Categories</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <CategoryForm />
              {categories.length > 0 && (
                <ul className="divide-y divide-border">
                  {categories.map((c) => (
                    <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                      <span>{c.name}</span>
                      <form action={deleteCategory.bind(null, c.id)}>
                        <button className="text-muted-foreground hover:text-destructive" type="submit">Delete</button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">New article</CardTitle>
            </CardHeader>
            <CardContent>
              <ArticleForm action={createArticle} categories={categories} submitLabel="Create article" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Articles ({articles.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {articles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No articles yet.</p>
              ) : (
                articles.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                    <div className="min-w-0">
                      <Link href={`/app/help/${a.id}`} className="flex items-center gap-2 font-medium hover:underline">
                        <FileText className="h-4 w-4 text-muted-foreground" /> {a.title}
                      </Link>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {a.categoryId ? catName.get(a.categoryId) : "Uncategorized"}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={a.published ? "success" : "default"}>{a.published ? "Published" : "Draft"}</Badge>
                      <form action={togglePublish.bind(null, a.id)}>
                        <Button type="submit" variant="ghost" size="sm">{a.published ? "Unpublish" : "Publish"}</Button>
                      </form>
                      <DeleteButton action={deleteArticle.bind(null, a.id)} label="" confirmText={`Delete "${a.title}"?`} />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
