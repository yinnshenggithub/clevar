import { requireAuth } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { withTenant } from "@/lib/tenant";
import { Sidebar } from "@/components/app/sidebar";
import { MobileNav } from "@/components/app/mobile-nav";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { CommandPalette } from "@/components/app/command-palette";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/utils";
import { LogOut } from "lucide-react";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAuth();
  const [customObjects, favorites] = await Promise.all([
    withTenant(ctx.workspaceId, (tx) =>
      tx.objectDefinition.findMany({ orderBy: { createdAt: "asc" }, select: { slug: true, namePlural: true } }),
    ).catch(() => []),
    withTenant(ctx.workspaceId, (tx) =>
      tx.favorite.findMany({
        where: { userId: ctx.userId },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { label: true, href: true },
      }),
    ).catch(() => []),
  ]);

  return (
    <div className="flex min-h-screen">
      <Sidebar workspaceName={ctx.workspace.name} customObjects={customObjects} favorites={favorites} />
      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-3 border-b border-border bg-card px-4 sm:px-6">
          <div className="flex flex-1 items-center gap-2">
            <MobileNav workspaceName={ctx.workspace.name} customObjects={customObjects} />
            <CommandPalette />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {initials(ctx.user.fullName)}
              </span>
              <span className="hidden sm:inline">{ctx.user.fullName}</span>
            </div>
            <ThemeToggle />
            <form action={logoutAction}>
              <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
                <LogOut className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-secondary/30 p-6">{children}</main>
      </div>
    </div>
  );
}
