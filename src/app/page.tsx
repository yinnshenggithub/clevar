import Link from "next/link";
import {
  ArrowRight,
  Users,
  MessageSquare,
  Bot,
  Workflow,
  BarChart3,
  BookOpen,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const FEATURES = [
  { icon: Users, title: "CRM that scales", body: "Contacts, companies, deals, custom objects, and associations — one source of truth for the whole pipeline." },
  { icon: MessageSquare, title: "Omnichannel inbox", body: "WhatsApp and a website chat widget land in one shared inbox with assignment, priority, labels, and internal notes." },
  { icon: Bot, title: "AI agents", body: "Per-workspace assistants grounded in your knowledge base, metered by credits, ready to auto-reply." },
  { icon: Workflow, title: "Visual automation", body: "Trigger → condition → action workflows, plus one-click macros and canned responses for your team." },
  { icon: BarChart3, title: "Live reporting", body: "Pipeline value, first-response time, message volume, and team activity — computed in real time." },
  { icon: BookOpen, title: "Help center", body: "Publish a branded self-serve knowledge base your customers can search, in minutes." },
];

const PILLARS = ["Tasks & activity timeline", "⌘K global search", "Role-based workspaces", "Tenant-isolated data"];

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2 font-display text-xl font-bold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-display text-primary-foreground shadow-soft">
              C
            </span>
            Clevar
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost">Sign in</Button>
            </Link>
            <Link href="/signup">
              <Button className="gap-2">
                Get started <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: "radial-gradient(60% 60% at 50% 0%, hsl(var(--primary) / 0.10), transparent 70%)" }}
        />
        <div className="container flex flex-col items-center py-24 text-center">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            CRM + customer messaging + AI, in one workspace
          </span>
          <h1 className="max-w-4xl text-balance font-display text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Win customers and keep them — without juggling five tools
          </h1>
          <p className="mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
            Clevar unifies your CRM, every customer conversation, and AI assistance in one place. Track
            the pipeline, reply across channels, and automate the busywork — all tenant-isolated and built to scale.
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
          <p className="mt-4 text-xs text-muted-foreground">No credit card required · 1,000 AI credits included</p>
        </div>
      </section>

      {/* Feature grid */}
      <section className="container pb-8">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-6 shadow-card transition-transform hover:-translate-y-0.5">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-display text-lg font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pillars strip */}
      <section className="container py-10">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {PILLARS.map((p) => (
            <span key={p} className="inline-flex items-center gap-2 text-sm font-medium text-foreground/80">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              {p}
            </span>
          ))}
        </div>
      </section>

      {/* CTA band */}
      <section className="container py-16">
        <div className="overflow-hidden rounded-2xl border border-border bg-card px-8 py-14 text-center shadow-card">
          <h2 className="font-display text-3xl font-bold tracking-tight">Your whole front office, one login</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Set up your workspace in minutes and bring sales, support, and AI together today.
          </p>
          <div className="mt-7 flex justify-center">
            <Link href="/signup">
              <Button size="lg" className="gap-2">
                Create your workspace <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8">
        <div className="container flex flex-col items-center justify-between gap-3 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-primary text-xs font-bold text-primary-foreground">C</span>
            Clevar
          </div>
          <span>© {new Date().getFullYear()} Clevar. All rights reserved.</span>
        </div>
      </footer>
    </main>
  );
}
