import Link from "next/link";
import { ArrowRight, Building2, Users, Workflow, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              C
            </span>
            Clevar
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost">Sign in</Button>
            </Link>
            <Link href="/signup">
              <Button>Get started</Button>
            </Link>
          </nav>
        </div>
      </header>

      <section className="container flex flex-1 flex-col items-center justify-center py-24 text-center">
        <span className="mb-4 inline-flex items-center rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
          Multi-tenant CRM · built to scale
        </span>
        <h1 className="max-w-3xl text-balance text-5xl font-bold tracking-tight sm:text-6xl">
          The CRM that keeps every customer relationship in one place
        </h1>
        <p className="mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
          Contacts, companies, and deals with airtight workspace isolation. Clevar gives your team a
          single source of truth for the entire pipeline.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup">
            <Button size="lg" className="gap-2">
              Start free <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="outline">
              Sign in
            </Button>
          </Link>
        </div>

        <div className="mt-20 grid w-full max-w-4xl grid-cols-1 gap-6 text-left sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Users, title: "Contacts", body: "Every person, with phone numbers normalized worldwide." },
            { icon: Building2, title: "Companies", body: "Accounts linked to the people and deals that matter." },
            { icon: Workflow, title: "Pipelines", body: "Drag deals across stages and watch revenue move." },
            { icon: ShieldCheck, title: "Isolated", body: "Row-level security keeps each tenant's data sealed." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-5">
              <f.icon className="h-6 w-6 text-primary" />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border py-8">
        <div className="container text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} Clevar. All rights reserved.
        </div>
      </footer>
    </main>
  );
}
