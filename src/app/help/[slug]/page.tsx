import Link from "next/link";
import { notFound } from "next/navigation";
import { Search, BookOpen } from "lucide-react";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function HelpPortal({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { slug } = await params;
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace) notFound();

  const [categories, articles] = await Promise.all([
    prisma.articleCategory.findMany({ where: { workspaceId: workspace.id }, orderBy: { position: "asc" } }),
    prisma.article.findMany({
      where: {
        workspaceId: workspace.id,
        published: true,
        ...(query
          ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { body: { contains: query, mode: "insensitive" } }] }
          : {}),
      },
      orderBy: { position: "asc" },
    }),
  ]);

  const byCategory = (cid: string | null) => articles.filter((a) => a.categoryId === cid);

  return (
    <div className="min-h-screen bg-secondary/30">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-3xl px-6 py-12 text-center">
          <div className="mb-3 flex justify-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary font-display text-xl font-bold text-primary-foreground">
              {workspace.name.charAt(0)}
            </span>
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">{workspace.name} Help Center</h1>
          <p className="mt-2 text-muted-foreground">How can we help you today?</p>
          <form className="mx-auto mt-6 flex max-w-md items-center gap-2 rounded-lg border border-border bg-background px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              name="q"
              defaultValue={query}
              placeholder="Search articles…"
              className="h-11 flex-1 bg-transparent text-sm outline-none"
            />
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-6 py-10">
        {articles.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            {query ? "No articles match your search." : "No articles published yet."}
          </p>
        )}

        {query ? (
          <ul className="space-y-2">
            {articles.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/help/${slug}/${a.slug}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
                >
                  <BookOpen className="h-4 w-4 text-primary" />
                  <span className="font-medium">{a.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <>
            {categories.map((c) => {
              const list = byCategory(c.id);
              if (list.length === 0) return null;
              return (
                <section key={c.id}>
                  <h2 className="mb-3 font-display text-lg font-semibold">{c.name}</h2>
                  <ul className="space-y-2">
                    {list.map((a) => (
                      <li key={a.id}>
                        <Link
                          href={`/help/${slug}/${a.slug}`}
                          className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
                        >
                          <BookOpen className="h-4 w-4 text-primary" />
                          <span className="font-medium">{a.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            {byCategory(null).length > 0 && (
              <section>
                <h2 className="mb-3 font-display text-lg font-semibold">Articles</h2>
                <ul className="space-y-2">
                  {byCategory(null).map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/help/${slug}/${a.slug}`}
                        className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
                      >
                        <BookOpen className="h-4 w-4 text-primary" />
                        <span className="font-medium">{a.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
