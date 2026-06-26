"use client";

import { useState, useTransition } from "react";
import { Tag, Plus, X, Check } from "lucide-react";
import {
  addConversationLabel,
  removeConversationLabel,
  createAndApplyLabel,
} from "@/lib/actions/labels";

type Label = { id: string; name: string; color: string };

export function ConversationLabels({
  conversationId,
  applied,
  allLabels,
}: {
  conversationId: string;
  applied: Label[];
  allLabels: Label[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const appliedIds = new Set(applied.map((l) => l.id));

  return (
    <div className="flex flex-wrap items-center gap-1">
      {applied.map((l) => (
        <span
          key={l.id}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
          style={{ backgroundColor: l.color }}
        >
          {l.name}
          <button
            type="button"
            aria-label={`Remove ${l.name}`}
            disabled={pending}
            onClick={() => start(() => void removeConversationLabel(conversationId, l.id))}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
        >
          <Tag className="h-3 w-3" /> Label
        </button>

        {open && (
          <>
            <button className="fixed inset-0 z-10 cursor-default" aria-hidden tabIndex={-1} onClick={() => setOpen(false)} />
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-border bg-card p-2 shadow-card">
              <div className="max-h-48 space-y-0.5 overflow-y-auto">
                {allLabels.length === 0 && (
                  <p className="px-1 py-1 text-xs text-muted-foreground">No labels yet. Create one below.</p>
                )}
                {allLabels.map((l) => {
                  const on = appliedIds.has(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        start(() =>
                          void (on
                            ? removeConversationLabel(conversationId, l.id)
                            : addConversationLabel(conversationId, l.id)),
                        )
                      }
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
                      <span className="flex-1 truncate">{l.name}</span>
                      {on && <Check className="h-3.5 w-3.5 text-primary" />}
                    </button>
                  );
                })}
              </div>
              <form
                className="mt-1 flex items-center gap-1 border-t border-border pt-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = draft.trim();
                  if (!name) return;
                  setDraft("");
                  start(() => void createAndApplyLabel(conversationId, name));
                }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="New label…"
                  maxLength={40}
                  className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="submit"
                  disabled={pending || !draft.trim()}
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
                  aria-label="Create label"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function LabelDots({ labels }: { labels: { id: string; color: string }[] }) {
  if (labels.length === 0) return null;
  return (
    <span className="flex items-center gap-0.5">
      {labels.slice(0, 4).map((l) => (
        <span key={l.id} className="h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} />
      ))}
    </span>
  );
}
