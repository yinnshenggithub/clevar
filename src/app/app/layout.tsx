import { requireAuth } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { Sidebar } from "@/components/app/sidebar";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/utils";
import { LogOut } from "lucide-react";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAuth();

  return (
    <div className="flex min-h-screen">
      <Sidebar workspaceName={ctx.workspace.name} />
      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
          <div className="text-sm text-muted-foreground">
            {ctx.workspace.name} · {ctx.role.toLowerCase()}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {initials(ctx.user.fullName)}
              </span>
              <span className="hidden sm:inline">{ctx.user.fullName}</span>
            </div>
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
