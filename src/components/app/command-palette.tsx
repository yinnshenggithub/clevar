"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight, Plus } from "lucide-react";
import { globalSearch, type SearchGroup } from "@/lib/actions/search";

type Command = { label: string; href: string; hint?: string; create?: boolean };

const COMMANDS: Command[] = [
  { label: "New contact", href: "/app/contacts/new", create: true },
  { label: "New company", href: "/app/companies/new", create: true },
  { label: "New deal", href: "/app/deals/new", create: true },
  { label: "Go to Tasks", href: "/app/tasks" },
  { label: "Go to Inbox", href: "/app/inbox" },
  { label: "Go to Contacts", href: "/app/contacts" },
  { label: "Go to Companies", href: "/app/companies" },
  { label: "Go to Deals", href: "/app/deals" },
  { label: "Go to Reports", href: "/app/reports" },
  { label: "Go to AI Agents", href: "/app/agents" },
  { label: "Go to Workflows", href: "/app/workflows" },
  { label: "Go to Custom objects", href: "/app/objects" },
  { label: "Go to Settings", href: "/app/settings" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [active, setActive] = useState(0);
  const [, startSearch] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Global ⌘K / Ctrl-K to open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setGroups([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setGroups([]);
      return;
    }
    const t = setTimeout(() => {
      startSearch(async () => {
        try {
          setGroups(await globalSearch(q));
        } catch {
          setGroups([]);
        }
      });
    }, 180);
    return () => clearTimeout(t);
  }, [query, open]);

  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((c) => c.label.toLowerCase().includes(q));
  }, [query]);

  const flat = useMemo(() => {
    const items: { label: string; sub?: string; href: string; kind: string }[] = [];
    filteredCommands.forEach((c) => items.push({ label: c.label, href: c.href, kind: c.create ? "create" : "nav" }));
    groups.forEach((g) => g.hits.forEach((h) => items.push({ label: h.label, sub: h.sub, href: h.href, kind: g.group })));
    return items;
  }, [filteredCommands, groups]);

  useEffect(() => setActive(0), [flat.length]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[active];
      if (item) go(item.href);
    }
  };

  let runningIndex = -1;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent sm:w-64"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="hidden rounded border border-border bg-secondary px-1.5 text-[10px] sm:inline">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Search contacts, companies, deals, conversations…"
                className="h-12 flex-1 bg-transparent text-sm outline-none"
              />
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-2">
              {flat.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {query.trim() ? "No matches." : "Type to search."}
                </p>
              )}

              {!query.trim() && filteredCommands.length > 0 && (
                <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Quick actions
                </div>
              )}
              {filteredCommands.map((c) => {
                runningIndex++;
                const idx = runningIndex;
                return (
                  <button
                    key={c.href}
                    type="button"
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => go(c.href)}
                    className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${active === idx ? "bg-accent" : ""}`}
                  >
                    {c.create ? <Plus className="h-4 w-4 text-primary" /> : <ArrowRight className="h-4 w-4 text-muted-foreground" />}
                    {c.label}
                  </button>
                );
              })}

              {groups.map((g) => (
                <div key={g.group}>
                  <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.group}
                  </div>
                  {g.hits.map((h) => {
                    runningIndex++;
                    const idx = runningIndex;
                    return (
                      <button
                        key={h.href + h.label}
                        type="button"
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => go(h.href)}
                        className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${active === idx ? "bg-accent" : ""}`}
                      >
                        <span className="truncate">{h.label}</span>
                        {h.sub && <span className="shrink-0 text-xs text-muted-foreground">{h.sub}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
