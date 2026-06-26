import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function PublicArticlePage({
  params,
}: {
  params: Promise<{ slug: string; article: string }>;
}) {
  const { slug, article } = await params;
  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace) notFound();
  const doc = await prisma.article.findFirst({
    where: { workspaceId: workspace.id, slug: article, published: true },
    include: { category: true },
  });
  if (!doc) notFound();

  return (
    <div className="min-h-screen bg-secondary/30">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-2xl px-6 py-4">
          <Link href={`/help/${slug}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> {workspace.name} Help Center
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-10">
        {doc.category && (
          <div className="mb-2 text-sm font-medium text-primary">{doc.category.name}</div>
        )}
        <h1 className="font-display text-3xl font-bold tracking-tight">{doc.title}</h1>
        <article className="mt-6 whitespace-pre-wrap text-[15px] leading-7 text-foreground/90">{doc.body}</article>
      </main>
    </div>
  );
}
